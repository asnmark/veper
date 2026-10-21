import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { NewsStore } from "../src/server/db.js";
import type { FeedItem, FeedSource } from "../src/shared/types.js";

const rtvslo: FeedSource = {
  id: "rtvslo", name: "RTV SLO", region: "si", language: "sl",
  feedUrl: "https://img.rtvslo.si/feeds/novice.xml", homepage: "https://www.rtvslo.si",
};
const n1: FeedSource = {
  id: "n1", name: "N1 Slovenija", region: "si", language: "sl",
  feedUrl: "https://n1info.si/feed/", homepage: "https://n1info.si",
};

function article(source: FeedSource, overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    externalId: `${source.id}-42`, sourceId: source.id, sourceName: source.name,
    region: source.region, language: source.language,
    title: "Občina Vrhnika do petka zapira stari most",
    summary: "Občina je potrdila, da bo most zaprt do petka.",
    url: `${source.homepage}/novice/most`, publishedAt: "2026-10-20T07:00:00.000Z", sourceUpdatedAt: null,
    observedAt: "2026-10-20T07:15:00.000Z", ...overrides,
  };
}

describe("NewsStore", () => {
  let store: NewsStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("deduplicates repeated feed entries and groups cross-source reports", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo, n1]);

    const first = store.upsertItems(rtvslo, [article(rtvslo)]);
    const second = store.upsertItems(n1, [article(n1, {
      title: "Vrhnika do petka zapira stari most",
      url: "https://n1info.si/novice/most?utm_source=feed",
    })]);
    const replay = store.upsertItems(rtvslo, [article(rtvslo)]);

    expect(first).toMatchObject({ inserted: 1, updated: 0, unchanged: 0 });
    expect(second).toMatchObject({ inserted: 1, newStories: 0 });
    expect(replay).toMatchObject({ inserted: 0, unchanged: 1 });
    expect(store.getDesk()).toHaveLength(1);
    expect(store.getDesk()[0]?.articles.map((item) => item.sourceId).sort()).toEqual(["n1", "rtvslo"]);
  });

  it("records a source revision when an existing item changes", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo]);
    store.upsertItems(rtvslo, [article(rtvslo)]);

    const result = store.upsertItems(rtvslo, [article(rtvslo, {
      summary: "Občina je potrdila, da bo most zaprt do nedelje.",
      observedAt: "2026-10-20T07:45:00.000Z",
    })]);

    expect(result).toMatchObject({ inserted: 0, updated: 1 });
    expect(store.getDesk()[0]?.articles[0]?.summary).toContain("nedelje");
    expect(store.getDesk()[0]?.articles[0]?.revisions).toHaveLength(1);
    expect(store.getDesk()[0]?.articles[0]?.revisions[0]?.summary).toContain("petka");
  });

  it("keeps publisher update time separate from publication time", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo]);
    store.upsertItems(rtvslo, [article(rtvslo, {
      sourceUpdatedAt: "2026-10-20T07:30:00.000Z",
    })]);

    const stored = store.getDesk()[0]?.articles[0];

    expect(stored).toMatchObject({
      publishedAt: "2026-10-20T07:00:00.000Z",
      sourceUpdatedAt: "2026-10-20T07:30:00.000Z",
    });
  });

  it("keeps unrelated reports separate even when they share a common phrase", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo, n1]);
    store.upsertItems(rtvslo, [article(rtvslo, {
      title: "Občina Vrhnika do petka zapira stari most",
    })]);
    store.upsertItems(n1, [article(n1, {
      title: "Vlada je sprejela nov zakon",
      summary: "Vlada je danes sprejela zakon o javnem prometu.",
      url: "https://n1info.si/novice/vlada",
    })]);

    expect(store.getDesk()).toHaveLength(2);
  });

  it("orders a feed backfill by publisher time, not the time it was first captured", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo]);
    const observedAt = "2026-10-20T10:00:00.000Z";
    const older = article(rtvslo, {
      externalId: "older", title: "Vlada danes predstavi letni proračun",
      publishedAt: "2026-10-20T05:00:00.000Z", observedAt, url: "https://www.rtvslo.si/novice/proracun",
    });
    const newer = article(rtvslo, {
      externalId: "newer", title: "Orkan dosegel obalo v bližini Kopra",
      publishedAt: "2026-10-20T09:45:00.000Z", observedAt, url: "https://www.rtvslo.si/novice/orkan",
    });

    store.upsertItems(rtvslo, [older, newer]);
    const stories = store.getDesk();

    expect(stories[0]?.title).toBe(newer.title);
    expect(stories[0]?.updatedAt).toBe(newer.publishedAt);
  });

  it("keeps the live desk focused on the last 72 hours", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo]);
    const now = "2026-10-20T10:00:00.000Z";
    store.upsertItems(rtvslo, [article(rtvslo, {
      externalId: "old", title: "Staro poročilo o lokalnem dogodku",
      publishedAt: "2026-10-16T10:00:00.000Z", observedAt: "2026-10-16T10:02:00.000Z",
      url: "https://www.rtvslo.si/novice/staro",
    })]);
    store.upsertItems(rtvslo, [article(rtvslo, {
      externalId: "recent", title: "Nova ureditev železniške postaje",
      publishedAt: "2026-10-20T08:00:00.000Z", observedAt: "2026-10-20T08:02:00.000Z",
      url: "https://www.rtvslo.si/novice/postaja",
    })]);

    expect(store.getDesk(now).map((story) => story.title)).toEqual(["Nova ureditev železniške postaje"]);
  });

  it("keeps old saved stories available without sending them back for analysis", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo]);
    const now = "2026-10-20T10:00:00.000Z";
    const inserted = store.upsertItems(rtvslo, [article(rtvslo, {
      externalId: "saved-old", title: "Arhivirana zgodba ostane shranjena",
      publishedAt: "2026-10-15T10:00:00.000Z", observedAt: "2026-10-15T10:02:00.000Z",
      url: "https://www.rtvslo.si/novice/shranjena",
    })]);
    const storyId = inserted.storyIds[0];
    expect(storyId).toBeDefined();
    expect(store.setSaved(storyId!, true)).toBe(true);

    expect(store.getDesk(now).map((story) => story.saved)).toEqual([true]);
    expect(store.getPendingStories(8, now)).toEqual([]);
  });

  it("invalidates analyses written before the claim-support review policy", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo]);
    const now = "2026-10-20T10:00:00.000Z";
    store.upsertItems(rtvslo, [article(rtvslo)]);
    const story = store.getDesk(now)[0]!;
    const sourceArticle = story.articles[0]!;
    const legacyFingerprint = createHash("sha256")
      .update(`${sourceArticle.id}:${sourceArticle.contentHash}`)
      .digest("hex");
    store.saveAnalysis(story.id, legacyFingerprint, {
      category: "public-safety", briefing: [{
        text: "Predhodni povzetek brez pregleda podpore.",
        evidence: [],
      }], development: null, comparisons: [], leads: [],
    }, now);

    expect(store.getDesk(now)[0]?.analysis).toBeNull();
    expect(store.getPendingStories(8, now)).toHaveLength(1);
  });

  it("does not treat future-dated publisher posts as current live stories", () => {
    store = new NewsStore(":memory:");
    store.saveSources([rtvslo]);
    const now = "2026-10-20T10:00:00.000Z";
    store.upsertItems(rtvslo, [article(rtvslo, {
      externalId: "future", title: "Napovedana objava v prihodnosti",
      publishedAt: "2026-10-25T10:00:00.000Z", observedAt: now,
      url: "https://www.rtvslo.si/novice/prihodnost",
    })]);

    expect(store.getDesk(now)).toEqual([]);
    expect(store.getPendingStories(8, now)).toEqual([]);
  });
});
