import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createNewsroomApp } from "../src/server/app.js";
import { NewsStore } from "../src/server/db.js";
import type { FeedSource } from "../src/shared/types.js";

const feedA = `<rss version="2.0"><channel><item>
  <guid>rtv-test-1</guid><title>Občina Vrhnika zapira stari most do petka</title>
  <link>https://rtvslo.invalid/most</link><pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate>
  <description>Občina je sporočila, da bo most zaprt do petka.</description>
</item></channel></rss>`;
const feedB = `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
  <id>n1-test-1</id><title>Občina Vrhnika do nedelje zapira stari most</title>
  <link rel="alternate" href="https://n1.invalid/most"/><published>2026-10-20T07:04:00Z</published>
  <summary>Po podatkih občine bo zapora trajala do nedelje.</summary>
</entry></feed>`;

const httpServer = createServer((request, response) => {
  response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
  const body = request.url === "/n1.xml"
    ? feedB
    : request.url === "/unsupported.xml"
      ? "<response><status>temporary error</status></response>"
      : request.url === "/empty.xml"
        ? "<rss><channel/></rss>"
        : feedA;
  response.end(body);
});
let app: FastifyInstance | undefined;
let store: NewsStore | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
  store?.close();
  store = undefined;
  if (httpServer.listening) {
    httpServer.close();
    await once(httpServer, "close");
  }
});

async function startFeedServer(): Promise<string> {
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  return `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
}

describe("newsroom API integration", () => {
  it("ingests two public-feed reports into a source-linked story dossier", async () => {
    const base = await startFeedServer();
    const sources: FeedSource[] = [
      { id: "rtvslo", name: "RTV test", region: "si", language: "sl", feedUrl: `${base}/rtvslo.xml`, homepage: "https://rtvslo.invalid" },
      { id: "n1", name: "N1 test", region: "si", language: "sl", feedUrl: `${base}/n1.xml`, homepage: "https://n1.invalid" },
    ];
    store = new NewsStore(":memory:");
    app = (await createNewsroomApp({ store, sources, analyzer: null, pollIntervalMs: 0 })).app;

    const refresh = await app.inject({ method: "POST", url: "/api/refresh" });
    expect(refresh.statusCode, refresh.body).toBe(200);
    expect(refresh.json()).toMatchObject({ inserted: 2, sourceCount: 2 });

    const desk = await app.inject({ method: "GET", url: "/api/desk" });
    expect(desk.statusCode).toBe(200);
    expect(desk.json()).toMatchObject({
      ai: { state: "disabled" },
      stories: [{ articles: [{ sourceName: expect.any(String) }, { sourceName: expect.any(String) }] }],
      sources: [
        { id: "n1", state: "online", lastHttpStatus: 200 },
        { id: "rtvslo", state: "online", lastHttpStatus: 200 },
      ],
    });
    expect(desk.json().stories[0].articles.map((article: { sourceId: string }) => article.sourceId).sort())
      .toEqual(["n1", "rtvslo"]);
  });

  it("rejects malformed save state and keeps the desk API scoped to known stories", async () => {
    store = new NewsStore(":memory:");
    app = (await createNewsroomApp({ store, sources: [], analyzer: null, pollIntervalMs: 0 })).app;

    const invalidSave = await app.inject({ method: "PUT", url: "/api/stories/unknown/saved", payload: { saved: "yes" } });
    const missingStory = await app.inject({ method: "PUT", url: "/api/stories/unknown/saved", payload: { saved: true } });

    expect(invalidSave.statusCode).toBe(400);
    expect(missingStory.statusCode).toBe(404);
  });

  it("marks unsupported XML offline while accepting a supported empty feed", async () => {
    const base = await startFeedServer();
    const sources: FeedSource[] = [
      { id: "unsupported", name: "Nepodprt", region: "si", language: "sl", feedUrl: `${base}/unsupported.xml`, homepage: "https://unsupported.invalid" },
      { id: "empty", name: "Prazen vir", region: "si", language: "sl", feedUrl: `${base}/empty.xml`, homepage: "https://empty.invalid" },
    ];
    store = new NewsStore(":memory:");
    app = (await createNewsroomApp({ store, sources, analyzer: null, pollIntervalMs: 0 })).app;

    const refresh = await app.inject({ method: "POST", url: "/api/refresh" });
    expect(refresh.json()).toMatchObject({ sourceCount: 1, failedSourceCount: 1, inserted: 0 });

    const desk = await app.inject({ method: "GET", url: "/api/desk" });
    expect(desk.json().sources).toMatchObject([
      { id: "unsupported", state: "offline", lastHttpStatus: null, lastError: expect.stringContaining("Format vira ni podprt") },
      { id: "empty", state: "online", lastHttpStatus: 200, articlesIn24h: 0 },
    ]);
  });
});
