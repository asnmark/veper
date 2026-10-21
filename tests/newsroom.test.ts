import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createNewsroomApp } from "../src/server/app.js";
import { NewsStore } from "../src/server/db.js";
import type { StoryAnalyzer } from "../src/server/intelligence/types.js";
import type { FeedSource, StoryAnalysis } from "../src/shared/types.js";

const source: FeedSource = {
  id: "rtvslo", name: "RTV test", region: "si", language: "sl",
  feedUrl: "", homepage: "https://rtvslo.invalid",
};
const headlines = [
  "Občina Koper odpira nov most čez Rižano",
  "Astronomi odkrili komet Nacre",
  "Maribor se uvrstil v finale pokala",
  "Tovarna Celin ustavlja proizvodnjo pri Jesenicah",
  "Potres pri Tolmeču poškodoval staro knjižnico",
  "Policija išče pričo tatvine slik v Kopru",
];
const emptyAnalysis: StoryAnalysis = {
  category: "other", briefing: [], development: null, comparisons: [], leads: [],
};

let app: Awaited<ReturnType<typeof createNewsroomApp>>["app"] | undefined;
let store: NewsStore | undefined;
let server: ReturnType<typeof createServer> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  store?.close();
  store = undefined;
  if (server?.listening) {
    server.close();
    await once(server, "close");
  }
  server = undefined;
});

async function startFeed(): Promise<string> {
  const entries = headlines.map((title, index) => `<item>
    <guid>story-${index}</guid><title>${title}</title>
    <link>https://rtvslo.invalid/story-${index}</link>
    <pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate>
    <description>Vir poroča o dogodku številka ${index}.</description>
  </item>`).join("");
  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
    response.end(`<rss><channel>${entries}</channel></rss>`);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/feed.xml`;
}

describe("AI queue status", () => {
  it("shows stories left in the queue after a partial analysis batch", async () => {
    const feedUrl = await startFeed();
    store = new NewsStore(":memory:");
    const analyzer: StoryAnalyzer = {
      model: "test-model",
      analyzeStories: async (stories) => stories.slice(0, 2).map((story) => ({
        storyId: story.id,
        analysis: emptyAnalysis,
      })),
    };
    app = (await createNewsroomApp({ store, sources: [{ ...source, feedUrl }], analyzer, pollIntervalMs: 0 })).app;

    const refresh = await app.inject({ method: "POST", url: "/api/refresh" });
    const desk = (await app.inject({ method: "GET", url: "/api/desk" })).json();

    expect(refresh.statusCode).toBe(200);
    expect(desk.ai).toMatchObject({ state: "queued", pendingStories: 4 });
    expect(desk.ai.message).toMatch(/2.*4/);
  });

  it("does not report completion when the analyzer returns no results", async () => {
    const feedUrl = await startFeed();
    store = new NewsStore(":memory:");
    const analyzer: StoryAnalyzer = {
      model: "test-model",
      analyzeStories: async () => [],
    };
    app = (await createNewsroomApp({ store, sources: [{ ...source, feedUrl }], analyzer, pollIntervalMs: 0 })).app;

    await app.inject({ method: "POST", url: "/api/refresh" });
    const desk = (await app.inject({ method: "GET", url: "/api/desk" })).json();

    expect(desk.ai).toMatchObject({ state: "queued", pendingStories: 6 });
    expect(desk.ai.message).not.toMatch(/zaključen/i);
  });
});
