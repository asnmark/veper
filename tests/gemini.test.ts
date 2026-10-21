import { describe, expect, it } from "vitest";
import { GeminiAnalyzer } from "../src/server/intelligence/gemini.js";
import type { PendingStory } from "../src/server/db.js";

const quote = "Policija je potrdila, da bo cesta zaprta do petka.";
const pending: PendingStory = {
  id: "story_1", title: "Zapora ceste v Vrhniki", fingerprint: "fingerprint-1", previousAnalysis: null,
  articles: [{
    id: "article_1", storyId: "story_1", sourceId: "rtvslo", sourceName: "RTV Slovenija",
    region: "si", language: "sl", externalId: "rtv-1", title: "Zapora ceste v Vrhniki",
    summary: quote, url: "https://publisher.example/article", canonicalUrl: "https://publisher.example/article",
    publishedAt: "2026-10-20T07:00:00.000Z", sourceUpdatedAt: null, observedAt: "2026-10-20T07:10:00.000Z",
    lastSeenAt: "2026-10-20T07:10:00.000Z", contentHash: "hash-1", revisions: [],
  }],
};

describe("GeminiAnalyzer", () => {
  it("uses bounded structured requests and validates generated citations", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const client = {
      models: {
        generateContent: async (value: Record<string, unknown>) => {
          requests.push(value);
          const prompt = String(value["contents"]);
          if (prompt.includes("CLAIMS_TO_REVIEW_JSON")) {
            return { text: JSON.stringify({ supportedClaimIds: ["story_1/briefing:0"] }) };
          }
          const data = JSON.parse(prompt.slice(prompt.indexOf("\n{", prompt.indexOf("SOURCE_EVIDENCE_JSON")) + 1)) as {
            stories: Array<{ id: string; articles: Array<{ id: string }> }>;
          };
          const input = data.stories[0];
          return { text: JSON.stringify({ stories: [{
            storyId: input?.id,
            category: "public-safety",
            briefing: [{ text: "Policija napoveduje zaporo.", citations: [{ articleId: input?.articles[0]?.id, quote }] }],
            development: null, comparisons: [], leads: [],
          }] }) };
        },
      },
    };
    const analyzer = new GeminiAnalyzer("test-key", client as never);

    const result = await analyzer.analyzeStories([pending]);
    const config = requests[0]?.["config"] as Record<string, unknown>;

    expect(result).toHaveLength(1);
    expect(result[0]?.analysis.briefing[0]?.evidence[0]?.quote).toBe(quote);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.["model"]).toBe("gemini-flash-latest");
    expect(config["responseMimeType"]).toBe("application/json");
    expect(config["responseJsonSchema"]).toBeDefined();
    expect(String(requests[0]?.["contents"])).not.toContain("https://publisher.example/article");
    expect(String(requests[1]?.["contents"])).toContain("CLAIMS_TO_REVIEW_JSON");
    expect(String(requests[1]?.["contents"])).not.toContain("https://publisher.example/article");
  });

  it("drops exact but semantically unsupported quotations when the review rejects them", async () => {
    let calls = 0;
    const client = {
      models: {
        generateContent: async () => {
          calls += 1;
          return calls === 1
            ? { text: JSON.stringify({ stories: [{
              storyId: "story_1", category: "public-safety",
              briefing: [{ text: "Davek se bo zvišal.", citations: [{ articleId: "article_1", quote }] }],
              development: null, comparisons: [], leads: [],
            }] }) }
            : { text: JSON.stringify({ supportedClaimIds: [] }) };
        },
      },
    };
    const analyzer = new GeminiAnalyzer("test-key", client as never);

    const result = await analyzer.analyzeStories([pending]);

    expect(result[0]?.analysis.briefing).toEqual([]);
  });

  it("completes omitted stories with an empty analysis so the queue can move on", async () => {
    const second: PendingStory = {
      ...pending,
      id: "story_2",
      title: "Premalo dokazov za drugi naslov",
      articles: pending.articles.map((article) => ({ ...article, id: "article_2", storyId: "story_2" })),
    };
    const client = {
      models: {
        generateContent: async () => ({ text: JSON.stringify({ stories: [{
          storyId: "story_1", category: "public-safety", briefing: [], development: null, comparisons: [], leads: [],
        }] }) }),
      },
    };
    const analyzer = new GeminiAnalyzer("test-key", client as never);

    const result = await analyzer.analyzeStories([pending, second]);

    expect(result.map((item) => item.storyId)).toEqual(["story_1", "story_2"]);
    expect(result[1]?.analysis).toMatchObject({ category: "other", briefing: [], development: null, comparisons: [], leads: [] });
  });

  it("does not call Google for an empty batch", async () => {
    let calls = 0;
    const client = { models: { generateContent: async () => { calls += 1; return { text: "{}" }; } } };
    const analyzer = new GeminiAnalyzer("test-key", client as never);

    expect(await analyzer.analyzeStories([])).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects malformed provider output so the caller can preserve source data", async () => {
    const client = { models: { generateContent: async () => ({ text: "not JSON" }) } };
    const analyzer = new GeminiAnalyzer("test-key", client as never);

    await expect(analyzer.analyzeStories([pending])).rejects.toThrow(/JSON/i);
  });
});
