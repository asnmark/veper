import { EventEmitter } from "node:events";
import type { DeskStatus, FeedSource } from "../shared/types.js";
import type { NewsStore, SourceCheck } from "./db.js";
import { fetchFeedXml, FeedFetchError } from "./feeds/fetch-feed.js";
import { FeedParseError, parseFeed } from "./feeds/parse-feed.js";
import type { StoryAnalyzer } from "./intelligence/types.js";

const DEFAULT_POLL_INTERVAL_MS = 90_000;
const MAX_STORIES_PER_ANALYSIS = 8;

function sourceError(error: unknown): string {
  if (error instanceof FeedFetchError) return error.message;
  if (error instanceof FeedParseError) return error.message;
  if (error instanceof DOMException && error.name === "TimeoutError") return "Vir se v 7 sekundah ni odzval.";
  return "Vira trenutno ni mogoče doseči ali razčleniti.";
}

export interface NewsroomOptions {
  store: NewsStore;
  sources: FeedSource[];
  analyzer: StoryAnalyzer | null;
  pollIntervalMs?: number;
  now?: () => string;
}

export interface RefreshResult {
  inserted: number;
  updated: number;
  unchanged: number;
  sourceCount: number;
  failedSourceCount: number;
}

export class NewsroomService {
  readonly sources: FeedSource[];
  private readonly store: NewsStore;
  private readonly analyzer: StoryAnalyzer | null;
  private readonly pollIntervalMs: number;
  private readonly now: () => string;
  private readonly events = new EventEmitter();
  private refreshInFlight: Promise<RefreshResult> | null = null;
  private refreshing = false;
  private lastRefreshAt: string | null = null;
  private aiState: DeskStatus["ai"]["state"];
  private aiMessage: string;
  private analysisFailureCount = 0;
  private retryAnalysisAt = 0;

  constructor(options: NewsroomOptions) {
    this.store = options.store;
    this.sources = options.sources;
    this.analyzer = options.analyzer;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = options.now ?? (() => new Date().toISOString());
    this.store.saveSources(this.sources);
    this.aiState = this.analyzer ? "idle" : "disabled";
    this.aiMessage = this.analyzer
      ? "Analiza čaka na nove objave."
      : "Gemini ni nastavljen; prikazani so samo podatki iz virov.";
  }

  onUpdate(listener: () => void): () => void {
    this.events.on("desk-updated", listener);
    return () => this.events.off("desk-updated", listener);
  }

  async refreshSources(): Promise<RefreshResult> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.runRefresh().finally(() => {
      this.refreshInFlight = null;
      this.refreshing = false;
    });
    return this.refreshInFlight;
  }

  getDesk(): DeskStatus {
    const generatedAt = this.now();
    const stories = this.store.getDesk(generatedAt);
    const activeCutoff = Date.parse(generatedAt) - 72 * 60 * 60_000;
    const activeStories = stories.filter((story) => Date.parse(story.updatedAt) >= activeCutoff && Date.parse(story.updatedAt) <= Date.parse(generatedAt));
    const sources = this.store.getSourceHealth(generatedAt);
    const pendingStories = this.store.getPendingStories(1_000, generatedAt).length;
    const freshnessCutoff = Date.parse(generatedAt) - 30 * 60_000;
    return {
      generatedAt,
      lastRefreshAt: this.lastRefreshAt,
      nextRefreshAt: this.lastRefreshAt
        ? new Date(Date.parse(this.lastRefreshAt) + this.pollIntervalMs).toISOString()
        : null,
      pollIntervalMs: this.pollIntervalMs,
      refreshing: this.refreshing,
      ai: {
        state: this.aiState,
        model: this.analyzer?.model ?? null,
        message: this.aiMessage,
        pendingStories,
      },
      stats: {
        activeStories: activeStories.length,
        freshArticles: stories.flatMap((story) => story.articles)
          .filter((article) => Date.parse(article.observedAt) >= freshnessCutoff && Date.parse(article.observedAt) <= Date.parse(generatedAt)).length,
        crossSourceStories: activeStories.filter((story) => new Set(story.articles.map((article) => article.sourceId)).size > 1).length,
        storiesWithDiscrepancies: activeStories.filter((story) => story.analysis?.comparisons.some((item) => item.kind !== "agreement")).length,
      },
      stories,
      sources,
    };
  }

  private async runRefresh(): Promise<RefreshResult> {
    this.refreshing = true;
    const results = await Promise.all(this.sources.map(async (source) => {
      const checkedAt = this.now();
      let check: SourceCheck;
      try {
        const response = await fetchFeedXml(source);
        const items = parseFeed(response.xml, source, checkedAt);
        const result = this.store.upsertItems(source, items);
        check = { sourceId: source.id, checkedAt: this.now(), succeeded: true, httpStatus: response.status, error: null };
        this.store.recordSourceCheck(check);
        return { ...result, succeeded: true };
      } catch (error) {
        check = {
          sourceId: source.id,
          checkedAt: this.now(),
          succeeded: false,
          httpStatus: error instanceof FeedFetchError ? error.status ?? null : null,
          error: sourceError(error),
        };
        this.store.recordSourceCheck(check);
        return { inserted: 0, updated: 0, unchanged: 0, newStories: 0, storyIds: [], changedStoryIds: [], succeeded: false };
      }
    }));

    const report: RefreshResult = {
      inserted: results.reduce((sum, item) => sum + item.inserted, 0),
      updated: results.reduce((sum, item) => sum + item.updated, 0),
      unchanged: results.reduce((sum, item) => sum + item.unchanged, 0),
      sourceCount: results.filter((item) => item.succeeded).length,
      failedSourceCount: results.filter((item) => !item.succeeded).length,
    };

    this.lastRefreshAt = this.now();
    await this.analyzePendingStories();
    this.events.emit("desk-updated");
    return report;
  }

  private async analyzePendingStories(): Promise<void> {
    if (!this.analyzer) return;
    const pending = this.store.getPendingStories(MAX_STORIES_PER_ANALYSIS, this.now());
    if (!pending.length) {
      this.aiState = "ready";
      this.aiMessage = "Primerjava zajema vse trenutno objavljene vire.";
      return;
    }
    if (Date.now() < this.retryAnalysisAt) return;

    this.aiState = "processing";
    this.aiMessage = "Primerjam nove objave, navedke in podporo posameznih trditev.";
    try {
      const results = await this.analyzer.analyzeStories(pending);
      const allowed = new Map(pending.map((story) => [story.id, story]));
      const generatedAt = this.now();
      let saved = 0;
      for (const result of results) {
        const story = allowed.get(result.storyId);
        if (!story) continue;
        this.store.saveAnalysis(story.id, story.fingerprint, result.analysis, generatedAt);
        saved += 1;
      }
      this.analysisFailureCount = 0;
      this.retryAnalysisAt = 0;
      this.aiState = saved > 0 ? "ready" : "idle";
      this.aiMessage = saved > 0
        ? "Ujemanje navedkov in ločen AI pregled podpore sta zaključena; preverite izvirnik."
        : "Za nove objave ni dovolj citatov, ki bi prestali pregled podpore.";
      if (saved) this.events.emit("desk-updated");
    } catch {
      this.analysisFailureCount += 1;
      this.retryAnalysisAt = Date.now() + Math.min(30 * 60_000, 60_000 * 2 ** (this.analysisFailureCount - 1));
      this.aiState = "error";
      this.aiMessage = "Analiza trenutno ni dosegljiva; izvirni viri ostajajo na voljo.";
    }
  }
}
