import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import type {
  ArticleRevision,
  FeedItem,
  FeedSource,
  SourceHealth,
  StoryAnalysis,
  StoryCategory,
  StoryRecord,
  StoredArticle,
} from "../shared/types.js";
import { STORY_CATEGORIES } from "../shared/types.js";
import { findStoryMatch } from "./stories.js";

const STORY_MATCH_WINDOW_MS = 36 * 60 * 60 * 1_000;
const ANALYSIS_POLICY_VERSION = "claim-support-review-v2";

interface StoryRow {
  id: string;
  title: string;
  category: string | null;
  created_at: string;
  updated_at: string;
  saved: number;
  analysis_fingerprint: string | null;
  analysis_json: string | null;
  analysis_at: string | null;
}

interface ArticleRow extends FeedItem {
  id: string;
  storyId: string;
  canonicalUrl: string;
  contentHash: string;
  lastSeenAt: string;
}

interface RevisionRow extends ArticleRevision {
  articleId: string;
}

interface SourceRow extends FeedSource {
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
}

export interface IngestResult {
  inserted: number;
  updated: number;
  unchanged: number;
  newStories: number;
  storyIds: string[];
  changedStoryIds: string[];
}

export interface PendingStory {
  id: string;
  title: string;
  fingerprint: string;
  previousAnalysis: StoryAnalysis | null;
  articles: StoredArticle[];
}

export interface SourceCheck {
  sourceId: string;
  checkedAt: string;
  succeeded: boolean;
  httpStatus: number | null;
  error: string | null;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function contentHash(item: FeedItem): string {
  return digest(JSON.stringify([item.title, item.summary, item.url, item.publishedAt]));
}

export function canonicalizeUrl(raw: string): string {
  const url = new URL(raw);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^utm_/i.test(key) || ["fbclid", "gclid", "mc_cid", "mc_eid"].includes(key.toLowerCase())) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function validCategory(value: string | null): StoryCategory | null {
  return value && STORY_CATEGORIES.includes(value as StoryCategory) ? value as StoryCategory : null;
}

function parseAnalysis(value: string | null): StoryAnalysis | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as StoryAnalysis;
  } catch {
    return null;
  }
}

export class NewsStore {
  private readonly database: Database.Database;

  constructor(path = ".data/veper.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.database = new Database(path);
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    if (path !== ":memory:") this.database.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS feed_sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        region TEXT NOT NULL,
        language TEXT NOT NULL,
        feed_url TEXT NOT NULL,
        homepage TEXT NOT NULL,
        last_checked_at TEXT,
        last_success_at TEXT,
        last_http_status INTEGER,
        last_error TEXT
      );
      CREATE TABLE IF NOT EXISTS stories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        saved INTEGER NOT NULL DEFAULT 0,
        analysis_fingerprint TEXT,
        analysis_json TEXT,
        analysis_at TEXT
      );
      CREATE TABLE IF NOT EXISTS articles (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL REFERENCES feed_sources(id),
        external_id TEXT NOT NULL,
        story_id TEXT NOT NULL REFERENCES stories(id),
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        url TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        published_at TEXT,
        source_updated_at TEXT,
        observed_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        UNIQUE(source_id, external_id)
      );
      CREATE INDEX IF NOT EXISTS articles_story_time ON articles(story_id, published_at, observed_at);
      CREATE INDEX IF NOT EXISTS articles_canonical_url ON articles(canonical_url);
      CREATE INDEX IF NOT EXISTS stories_updated ON stories(updated_at DESC);
      CREATE TABLE IF NOT EXISTS article_revisions (
        id TEXT PRIMARY KEY,
        article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
        observed_at TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        UNIQUE(article_id, content_hash)
      );
    `);
    const articleColumns = this.database.pragma("table_info(articles)") as Array<{ name: string }>;
    if (!articleColumns.some((column) => column.name === "source_updated_at")) {
      this.database.exec("ALTER TABLE articles ADD COLUMN source_updated_at TEXT");
    }
  }

  close(): void {
    this.database.close();
  }

  saveSources(sources: FeedSource[]): void {
    const save = this.database.prepare(`
      INSERT INTO feed_sources (id, name, region, language, feed_url, homepage)
      VALUES (@id, @name, @region, @language, @feedUrl, @homepage)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name, region=excluded.region,
        language=excluded.language, feed_url=excluded.feed_url, homepage=excluded.homepage
    `);
    const transaction = this.database.transaction((items: FeedSource[]) => {
      for (const item of items) save.run(item);
    });
    transaction(sources);
  }

  upsertItems(source: FeedSource, items: FeedItem[]): IngestResult {
    const insertStory = this.database.prepare(`
      INSERT INTO stories (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)
    `);
    const findExisting = this.database.prepare(`
      SELECT id, story_id FROM articles
      WHERE source_id=? AND (external_id=? OR canonical_url=?)
      ORDER BY CASE WHEN external_id=? THEN 0 ELSE 1 END LIMIT 1
    `);
    const findCanonicalStory = this.database.prepare("SELECT story_id FROM articles WHERE canonical_url=? LIMIT 1");
    const findCandidates = this.database.prepare(`
      SELECT id, title FROM stories WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 500
    `);
    const insertArticle = this.database.prepare(`
      INSERT INTO articles
        (id, source_id, external_id, story_id, title, summary, url, canonical_url,
         published_at, source_updated_at, observed_at, last_seen_at, content_hash)
      VALUES (@id, @sourceId, @externalId, @storyId, @title, @summary, @url, @canonicalUrl,
              @publishedAt, @sourceUpdatedAt, @observedAt, @observedAt, @contentHash)
    `);
    const findArticleById = this.database.prepare(`
      SELECT title, summary, observed_at, content_hash FROM articles WHERE id=?
    `);
    const insertRevision = this.database.prepare(`
      INSERT OR IGNORE INTO article_revisions (id, article_id, observed_at, title, summary, content_hash)
      VALUES (@id, @articleId, @observedAt, @title, @summary, @contentHash)
    `);
    const updateArticle = this.database.prepare(`
      UPDATE articles SET external_id=@externalId, title=@title, summary=@summary, url=@url,
        canonical_url=@canonicalUrl, published_at=@publishedAt,
        source_updated_at=COALESCE(@sourceUpdatedAt, source_updated_at), observed_at=@observedAt,
        last_seen_at=MAX(last_seen_at, @observedAt), content_hash=@contentHash
      WHERE id=@id
    `);
    const touchArticle = this.database.prepare(`
      UPDATE articles SET last_seen_at=MAX(last_seen_at, ?), source_updated_at=COALESCE(?, source_updated_at)
      WHERE id=?
    `);
    const updateStory = this.database.prepare(`
      UPDATE stories SET updated_at=MAX(updated_at, ?)
      WHERE id=?
    `);
    const updateStoryTitle = this.database.prepare(`
      UPDATE stories SET title=? WHERE id=? AND ? >= COALESCE(
        (SELECT MAX(COALESCE(published_at, observed_at)) FROM articles WHERE story_id=?), created_at)
    `);
    const findArticleId = this.database.prepare(`
      SELECT id FROM articles WHERE source_id=? AND (external_id=? OR canonical_url=?) LIMIT 1
    `);

    const transaction = this.database.transaction((feedItems: FeedItem[]) => {
      let inserted = 0;
      let updated = 0;
      let unchanged = 0;
      let newStories = 0;
      const storyIds = new Set<string>();
      const changedStoryIds = new Set<string>();

      for (const item of feedItems) {
        if (item.sourceId !== source.id) throw new Error("Članek pripada drugemu viru.");
        const canonicalUrl = canonicalizeUrl(item.url);
        const hash = contentHash(item);
        const current = findExisting.get(source.id, item.externalId, canonicalUrl, item.externalId) as
          | { id: string; story_id: string }
          | undefined;

        if (current) {
          const previous = findArticleById.get(current.id) as
            | { title: string; summary: string; observed_at: string; content_hash: string }
            | undefined;
          if (previous && previous.content_hash !== hash) {
            insertRevision.run({
              id: `${current.id}_${previous.content_hash.slice(0, 16)}`,
              articleId: current.id,
              observedAt: previous.observed_at,
              title: previous.title,
              summary: previous.summary,
              contentHash: previous.content_hash,
            });
            updateArticle.run({ ...item, id: current.id, canonicalUrl, contentHash: hash });
            updateStory.run(item.observedAt, current.story_id);
            updateStoryTitle.run(item.title, current.story_id, item.publishedAt ?? item.observedAt, current.story_id);
            updated += 1;
            changedStoryIds.add(current.story_id);
          } else {
            touchArticle.run(item.observedAt, item.sourceUpdatedAt, current.id);
            unchanged += 1;
          }
          storyIds.add(current.story_id);
          continue;
        }

        const articleId = digest(`${source.id}\u0000${item.externalId}`).slice(0, 32);
        const eventAt = item.publishedAt ?? item.observedAt;
        const exactLink = findCanonicalStory.get(canonicalUrl) as { story_id: string } | undefined;
        let storyId = exactLink?.story_id;

        if (!storyId) {
          const eventMs = Date.parse(eventAt);
          const cutoff = new Date(eventMs - STORY_MATCH_WINDOW_MS).toISOString();
          const candidates = findCandidates.all(cutoff) as Array<{ id: string; title: string }>;
          storyId = findStoryMatch(item.title, candidates)?.id;
        }

        if (!storyId) {
          storyId = `story_${articleId.slice(0, 20)}`;
          insertStory.run(storyId, item.title, eventAt, eventAt);
          newStories += 1;
        }

        insertArticle.run({ ...item, id: articleId, storyId, canonicalUrl, contentHash: hash });
        updateStory.run(eventAt, storyId);
        updateStoryTitle.run(item.title, storyId, item.publishedAt ?? item.observedAt, storyId);
        const storedId = findArticleId.get(source.id, item.externalId, canonicalUrl) as { id: string } | undefined;
        if (!storedId) throw new Error("Shranjevanje članka ni uspelo.");
        inserted += 1;
        storyIds.add(storyId);
        changedStoryIds.add(storyId);
      }

      return {
        inserted, updated, unchanged, newStories,
        storyIds: [...storyIds], changedStoryIds: [...changedStoryIds],
      };
    });

    return transaction(items);
  }

  recordSourceCheck(check: SourceCheck): void {
    this.database.prepare(`
      UPDATE feed_sources SET last_checked_at=@checkedAt,
        last_success_at=CASE WHEN @succeeded THEN @checkedAt ELSE last_success_at END,
        last_http_status=@httpStatus, last_error=@error
      WHERE id=@sourceId
    `).run({ ...check, succeeded: check.succeeded ? 1 : 0 });
  }

  getSourceHealth(now = new Date().toISOString()): SourceHealth[] {
    const rows = this.database.prepare(`
      SELECT f.id, f.name, f.region, f.homepage, f.last_checked_at, f.last_success_at,
        f.last_http_status, f.last_error,
        (SELECT COUNT(*) FROM articles a WHERE a.source_id=f.id AND a.observed_at>=?) AS articles_in_24h
      FROM feed_sources f ORDER BY CASE f.region WHEN 'si' THEN 0 ELSE 1 END, f.name
    `).all(new Date(Date.parse(now) - 86_400_000).toISOString()) as Array<{
      id: string; name: string; region: "si" | "world"; homepage: string;
      last_checked_at: string | null; last_success_at: string | null;
      last_http_status: number | null; last_error: string | null; articles_in_24h: number;
    }>;

    return rows.map((row) => {
      const age = row.last_success_at ? Date.parse(now) - Date.parse(row.last_success_at) : Infinity;
      const state = !row.last_checked_at ? "waiting" : !row.last_success_at ? "offline" : age > 15 * 60_000 ? "stale" : "online";
      return {
        id: row.id, name: row.name, region: row.region, homepage: row.homepage,
        state, lastCheckedAt: row.last_checked_at, lastSuccessAt: row.last_success_at,
        lastHttpStatus: row.last_http_status, lastError: row.last_error,
        articlesIn24h: row.articles_in_24h,
      };
    });
  }

  getDesk(now = new Date().toISOString()): StoryRecord[] {
    const cutoff = new Date(Date.parse(now) - 72 * 60 * 60 * 1_000).toISOString();
    const stories = this.database.prepare(`
      SELECT id, title, category, created_at, updated_at, saved,
        analysis_fingerprint, analysis_json, analysis_at
      FROM stories WHERE (updated_at >= ? AND updated_at <= ?) OR saved=1 ORDER BY updated_at DESC, id
    `).all(cutoff, now) as StoryRow[];

    return stories.map((story) => {
      const articles = this.getArticles(story.id);
      const currentFingerprint = this.fingerprint(articles);
      const analysisIsCurrent = currentFingerprint === story.analysis_fingerprint;
      return {
        id: story.id,
        title: story.title,
        category: analysisIsCurrent ? validCategory(story.category) : null,
        createdAt: story.created_at,
        updatedAt: story.updated_at,
        saved: story.saved === 1,
        analysis: analysisIsCurrent ? parseAnalysis(story.analysis_json) : null,
        analysisAt: analysisIsCurrent ? story.analysis_at : null,
        articles,
      };
    });
  }

  getPendingStories(limit = 8, now = new Date().toISOString()): PendingStory[] {
    const cutoff = Date.parse(now) - 72 * 60 * 60 * 1_000;
    return this.getDesk(now)
      .filter((story) => Date.parse(story.updatedAt) >= cutoff)
      .map((story) => ({
        story,
        fingerprint: this.fingerprint(story.articles),
      }))
      .filter(({ story, fingerprint }) => !story.analysisAt || fingerprint !== this.storedFingerprint(story.id))
      .slice(0, limit)
      .map(({ story, fingerprint }) => ({
        id: story.id,
        title: story.title,
        fingerprint,
        previousAnalysis: this.getStoredAnalysis(story.id),
        articles: story.articles,
      }));
  }

  saveAnalysis(storyId: string, fingerprint: string, analysis: StoryAnalysis, generatedAt: string): void {
    this.database.prepare(`
      UPDATE stories SET category=?, analysis_fingerprint=?, analysis_json=?, analysis_at=? WHERE id=?
    `).run(analysis.category, fingerprint, JSON.stringify(analysis), generatedAt, storyId);
  }

  setSaved(storyId: string, saved: boolean): boolean {
    return this.database.prepare("UPDATE stories SET saved=? WHERE id=?").run(saved ? 1 : 0, storyId).changes > 0;
  }

  private storedFingerprint(storyId: string): string | null {
    const row = this.database.prepare("SELECT analysis_fingerprint FROM stories WHERE id=?").get(storyId) as
      | { analysis_fingerprint: string | null }
      | undefined;
    return row?.analysis_fingerprint ?? null;
  }

  private getStoredAnalysis(storyId: string): StoryAnalysis | null {
    const row = this.database.prepare("SELECT analysis_json FROM stories WHERE id=?").get(storyId) as
      | { analysis_json: string | null }
      | undefined;
    return parseAnalysis(row?.analysis_json ?? null);
  }

  private fingerprint(articles: StoredArticle[]): string {
    return digest(`${ANALYSIS_POLICY_VERSION}\n${articles.map((article) => `${article.id}:${article.contentHash}`).sort().join("\n")}`);
  }

  private getArticles(storyId: string): StoredArticle[] {
    const rows = this.database.prepare(`
      SELECT a.id, a.source_id AS sourceId, f.name AS sourceName, f.region, f.language,
        a.external_id AS externalId, a.story_id AS storyId, a.title, a.summary, a.url,
        a.canonical_url AS canonicalUrl, a.published_at AS publishedAt,
        a.source_updated_at AS sourceUpdatedAt,
        a.observed_at AS observedAt, a.last_seen_at AS lastSeenAt, a.content_hash AS contentHash
      FROM articles a JOIN feed_sources f ON f.id=a.source_id
      WHERE a.story_id=?
      ORDER BY CASE WHEN EXISTS (SELECT 1 FROM article_revisions r WHERE r.article_id=a.id)
        THEN a.observed_at ELSE COALESCE(a.published_at, a.observed_at) END DESC, a.source_id
    `).all(storyId) as ArticleRow[];
    const revisions = this.database.prepare(`
      SELECT id, article_id AS articleId, observed_at AS observedAt,
        title, summary, content_hash AS contentHash
      FROM article_revisions WHERE article_id=? ORDER BY observed_at DESC
    `);

    return rows.map((row) => ({ ...row, revisions: revisions.all(row.id) as RevisionRow[] }));
  }
}
