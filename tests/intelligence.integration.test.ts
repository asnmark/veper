import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { GeminiAnalyzer } from "../src/server/intelligence/gemini.js";
import { createNewsroomApp } from "../src/server/app.js";
import { NewsStore } from "../src/server/db.js";
import type { FeedSource } from "../src/shared/types.js";

const sources: FeedSource[] = [
  { id: "rtvslo", name: "RTV Slovenija", region: "si", language: "sl", feedUrl: "", homepage: "https://rtvslo.invalid" },
  { id: "n1", name: "N1 Slovenija", region: "si", language: "sl", feedUrl: "", homepage: "https://n1.invalid" },
];
const quoteA = "Občina je sporočila, da bo most zaprt do petka.";
const quoteB = "Po podatkih občine bo zapora trajala do nedelje.";
const feedA = `<rss><channel><item><guid>rtv-1</guid><title>Občina Vrhnika do petka zapira stari most</title>
  <link>https://rtvslo.invalid/most</link><description>${quoteA}</description></item></channel></rss>`;
const feedB = `<rss><channel><item><guid>n1-1</guid><title>Občina Vrhnika do nedelje zapira stari most</title>
  <link>https://n1.invalid/most</link><description>${quoteB}</description></item></channel></rss>`;

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

describe("editorial comparison workflow", () => {
  it("keeps both source accounts, validates the contradiction, and does not re-spend on unchanged evidence", async () => {
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
      response.end(request.url === "/n1.xml" ? feedB : feedA);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const testSources = sources.map((source) => ({
      ...source,
      feedUrl: `${base}/${source.id === "n1" ? "n1" : "rtvslo"}.xml`,
    }));

    let modelCalls = 0;
    const client = {
      models: {
        generateContent: async (request: { contents: string }) => {
          modelCalls += 1;
          if (request.contents.includes("CLAIMS_TO_REVIEW_JSON")) {
            const marker = "CLAIMS_TO_REVIEW_JSON\n";
            const data = JSON.parse(request.contents.slice(request.contents.indexOf(marker) + marker.length)) as {
              claims: Array<{ id: string }>;
            };
            return { text: JSON.stringify({ supportedClaimIds: data.claims.map((claim) => claim.id) }) };
          }
          const marker = "SOURCE_EVIDENCE_JSON\n";
          const data = JSON.parse(request.contents.slice(request.contents.indexOf(marker) + marker.length)) as {
            stories: Array<{ id: string; articles: Array<{ id: string; sourceId: string; excerpt: string }> }>;
          };
          const story = data.stories[0];
          const left = story?.articles.find((article) => article.sourceId === "rtvslo");
          const right = story?.articles.find((article) => article.sourceId === "n1");
          if (!story || !left || !right) throw new Error("The two fixture reports did not reach the comparison model.");
          return { text: JSON.stringify({ stories: [{
            storyId: story.id,
            category: "public-safety",
            briefing: [{
              text: "Vira navajata različna končna datuma zapore.",
              citations: [
                { articleId: left.id, quote: left.excerpt },
                { articleId: right.id, quote: right.excerpt },
              ],
            }],
            development: null,
            comparisons: [{
              kind: "contradiction", note: "Navedbi se razlikujeta glede zaključka zapore.",
              left: { articleId: left.id, quote: left.excerpt }, right: { articleId: right.id, quote: right.excerpt },
            }],
            leads: [{
              question: "Kdaj bo zapora dejansko odpravljena?",
              rationale: "Objavljena roka se razlikujeta.",
              citations: [
                { articleId: left.id, quote: left.excerpt },
                { articleId: right.id, quote: right.excerpt },
              ],
            }],
          }] }) };
        },
      },
    };
    store = new NewsStore(":memory:");
    const analyzer = new GeminiAnalyzer("test-key", client as never);
    app = (await createNewsroomApp({ store, sources: testSources, analyzer, pollIntervalMs: 0 })).app;

    await app.inject({ method: "POST", url: "/api/refresh" });
    const first = (await app.inject({ method: "GET", url: "/api/desk" })).json();
    const dossier = first.stories[0];

    expect(first.stats).toMatchObject({ activeStories: 1, crossSourceStories: 1, storiesWithDiscrepancies: 1 });
    expect(dossier.articles.map((article: { sourceId: string }) => article.sourceId).sort()).toEqual(["n1", "rtvslo"]);
    expect(dossier.analysis.comparisons[0]).toMatchObject({
      kind: "contradiction",
      left: { sourceId: "rtvslo", publisher: "RTV Slovenija", quote: quoteA },
      right: { sourceId: "n1", publisher: "N1 Slovenija", quote: quoteB },
    });
    expect(dossier.analysis.leads[0].question).toBe("Kdaj bo zapora dejansko odpravljena?");
    expect(modelCalls).toBe(2);

    await app.inject({ method: "POST", url: "/api/refresh" });
    expect(modelCalls).toBe(2);
  });
});
