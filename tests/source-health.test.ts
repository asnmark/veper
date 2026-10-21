import { afterEach, describe, expect, it } from "vitest";
import { NewsStore } from "../src/server/db.js";
import type { FeedSource } from "../src/shared/types.js";

const source: FeedSource = {
  id: "rtvslo", name: "RTV Slovenija", region: "si", language: "sl",
  feedUrl: "https://img.rtvslo.si/feeds/novice.xml", homepage: "https://www.rtvslo.si",
};

describe("feed health", () => {
  let store: NewsStore | undefined;

  afterEach(() => {
    store?.close();
    store = undefined;
  });

  it("does not call a source online after its latest check failed", () => {
    store = new NewsStore(":memory:");
    store.saveSources([source]);
    store.recordSourceCheck({
      sourceId: source.id, checkedAt: "2026-10-21T10:00:00.000Z", succeeded: true, httpStatus: 200, error: null,
    });
    store.recordSourceCheck({
      sourceId: source.id, checkedAt: "2026-10-21T10:02:00.000Z", succeeded: false, httpStatus: 503, error: "Vir je vrnil HTTP 503.",
    });

    expect(store.getSourceHealth("2026-10-21T10:03:00.000Z")[0]).toMatchObject({
      state: "degraded", lastSuccessAt: "2026-10-21T10:00:00.000Z", lastError: "Vir je vrnil HTTP 503.",
    });
  });

  it("distinguishes first failure, fresh success, and an aged success", () => {
    store = new NewsStore(":memory:");
    store.saveSources([source]);
    expect(store.getSourceHealth("2026-10-21T10:00:00.000Z")[0]?.state).toBe("waiting");

    store.recordSourceCheck({
      sourceId: source.id, checkedAt: "2026-10-21T10:00:00.000Z", succeeded: false, httpStatus: 503, error: "Vir je vrnil HTTP 503.",
    });
    expect(store.getSourceHealth("2026-10-21T10:01:00.000Z")[0]?.state).toBe("offline");

    store.recordSourceCheck({
      sourceId: source.id, checkedAt: "2026-10-21T10:02:00.000Z", succeeded: true, httpStatus: 200, error: null,
    });
    expect(store.getSourceHealth("2026-10-21T10:03:00.000Z")[0]?.state).toBe("online");
    expect(store.getSourceHealth("2026-10-21T10:18:00.001Z")[0]?.state).toBe("stale");
  });
});
