import { describe, expect, it } from "vitest";
import {
  compareDevelopingStories, isDevelopingStory, newsroomSignals,
} from "../src/client/format.js";
import type { ArticleRevision, StoryAnalysis, StoryRecord, StoredArticle } from "../src/shared/types.js";

const now = "2026-10-21T10:30:00.000Z";
const oldPublishedAt = "2026-10-21T08:00:00.000Z";

function article(id: string, options: {
  sourceId?: string;
  publishedAt?: string | null;
  sourceUpdatedAt?: string | null;
  observedAt?: string;
  revisions?: ArticleRevision[];
} = {}): StoredArticle {
  const sourceId = options.sourceId ?? "rtvslo";
  return {
    id, sourceId, sourceName: sourceId === "n1" ? "N1 Slovenija" : "RTV Slovenija",
    region: "si", language: "sl", externalId: id, storyId: "story", title: `Naslov ${id}`,
    summary: `Izsek ${id}`, url: `https://${sourceId}.example/novica`, canonicalUrl: `https://${sourceId}.example/novica`,
    publishedAt: options.publishedAt === undefined ? oldPublishedAt : options.publishedAt,
    sourceUpdatedAt: options.sourceUpdatedAt ?? null,
    observedAt: options.observedAt ?? oldPublishedAt,
    lastSeenAt: now, contentHash: `hash-${id}`, revisions: options.revisions ?? [],
  };
}

function citation(item: StoredArticle) {
  return {
    articleId: item.id, sourceId: item.sourceId, publisher: item.sourceName,
    title: item.title, url: item.url, publishedAt: item.publishedAt,
    quote: item.summary, quoteHash: `quote-${item.id}`,
  };
}

function story(articles: StoredArticle[], analysis: StoryAnalysis | null = null): StoryRecord {
  return {
    id: "story", title: "Skupni naslov", category: analysis?.category ?? null,
    createdAt: oldPublishedAt,
    updatedAt: articles.reduce((latest, item) => item.observedAt > latest ? item.observedAt : latest, oldPublishedAt),
    saved: false, analysis, analysisAt: analysis ? now : null, articles,
  };
}

describe("editorial freshness signals", () => {
  it("labels an older article first captured now without calling it new reporting", () => {
    const item = article("late", { publishedAt: oldPublishedAt, observedAt: "2026-10-21T10:28:00.000Z" });
    const itemStory = story([item]);

    expect(newsroomSignals(itemStory, now)).toContainEqual({ id: "capture", label: "PRVIČ ZAJETO" });
    expect(newsroomSignals(itemStory, now)).not.toContainEqual({ id: "new", label: "NOVO POROČANJE" });
    expect(isDevelopingStory(itemStory, now)).toBe(false);
  });

  it("marks a publisher-timed new article as new reporting", () => {
    const itemStory = story([article("new", { publishedAt: "2026-10-21T10:29:00.000Z", observedAt: "2026-10-21T10:29:00.000Z" })]);

    expect(newsroomSignals(itemStory, now)).toContainEqual({ id: "new", label: "NOVO POROČANJE" });
    expect(isDevelopingStory(itemStory, now)).toBe(true);
  });

  it("marks a publisher-provided update independently from first publication", () => {
    const itemStory = story([article("updated", {
      publishedAt: oldPublishedAt, sourceUpdatedAt: "2026-10-21T10:28:00.000Z", observedAt: oldPublishedAt,
    })]);

    expect(newsroomSignals(itemStory, now)).toContainEqual({ id: "source-update", label: "VIR JE POSODOBIL" });
    expect(isDevelopingStory(itemStory, now)).toBe(true);
  });

  it("marks a recently observed content revision as story development", () => {
    const revision: ArticleRevision = {
      id: "old-version", observedAt: "2026-10-21T10:28:00.000Z", title: "Prejšnji naslov",
      summary: "Prejšnji izsek", contentHash: "old-hash",
    };
    const itemStory = story([article("revision", { publishedAt: oldPublishedAt, observedAt: "2026-10-21T10:28:00.000Z", revisions: [revision] })]);

    expect(newsroomSignals(itemStory, now)).toContainEqual({ id: "revision", label: "SPREMEMBA ZAJETA" });
    expect(isDevelopingStory(itemStory, now)).toBe(true);
  });

  it("does not call static multi-source coverage a developing story", () => {
    const left = article("left", { publishedAt: oldPublishedAt, observedAt: oldPublishedAt });
    const right = article("right", { sourceId: "n1", publishedAt: oldPublishedAt, observedAt: oldPublishedAt });
    const analysis: StoryAnalysis = {
      category: "society", briefing: [], development: null,
      comparisons: [{
        kind: "contradiction", note: "Datuma se ne ujemata.", left: citation(left), right: citation(right),
      }],
      leads: [],
    };
    const itemStory = story([left, right], analysis);

    expect(newsroomSignals(itemStory, now)).toContainEqual({ id: "contradiction", label: "MOŽNO NESKLADJE" });
    expect(isDevelopingStory(itemStory, now)).toBe(false);
  });

  it("puts an active possible contradiction ahead of newer uncorroborated coverage", () => {
    const conflictLeft = article("conflict-left", { publishedAt: "2026-10-21T10:20:00.000Z", observedAt: "2026-10-21T10:20:00.000Z" });
    const conflictRight = article("conflict-right", { sourceId: "n1", publishedAt: "2026-10-21T10:21:00.000Z", observedAt: "2026-10-21T10:21:00.000Z" });
    const conflictAnalysis: StoryAnalysis = {
      category: "society", briefing: [], development: null,
      comparisons: [{ kind: "contradiction", note: "Datuma se ne ujemata.", left: citation(conflictLeft), right: citation(conflictRight) }],
      leads: [],
    };
    const conflict = story([conflictLeft, conflictRight], conflictAnalysis);
    const newer = story([article("just-published", { publishedAt: "2026-10-21T10:29:00.000Z", observedAt: "2026-10-21T10:29:00.000Z" })]);

    expect(compareDevelopingStories(conflict, newer, now)).toBeLessThan(0);
  });
});
