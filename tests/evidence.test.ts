import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { applySupportReview, validateAnalysis } from "../src/server/intelligence/evidence.js";
import type { StoredArticle } from "../src/shared/types.js";

function item(id: string, sourceId: string, publisher: string, summary: string): StoredArticle {
  return {
    id, sourceId, sourceName: publisher, region: "si", language: "sl", externalId: id,
    storyId: "story-1", title: "Most v Vrhniki bo zaprt", summary,
    url: `https://${sourceId}.example/most`, canonicalUrl: `https://${sourceId}.example/most`,
    publishedAt: "2026-10-20T07:00:00.000Z", observedAt: "2026-10-20T07:10:00.000Z",
    lastSeenAt: "2026-10-20T07:10:00.000Z", contentHash: `hash-${id}`, revisions: [],
  };
}

const quoteA = "Občina je potrdila, da bo most zaprt do petka.";
const quoteB = "Po podatkih občine bo zapora trajala do nedelje.";
const analysis = {
  category: "public-safety",
  briefing: [{ text: "Vira navajata različen čas zaključka zapore.", citations: [
    { articleId: "a", quote: quoteA }, { articleId: "b", quote: quoteB },
  ] }],
  development: null,
  comparisons: [{
    kind: "contradiction", note: "Izseka navajata različna datuma zaključka.",
    left: { articleId: "a", quote: quoteA }, right: { articleId: "b", quote: quoteB },
  }],
  leads: [{
    question: "Kdaj bo zapora dejansko odpravljena?",
    rationale: "Objavljeni navedbi se razlikujeta glede zaključka.",
    citations: [{ articleId: "a", quote: quoteA }, { articleId: "b", quote: quoteB }],
  }],
};

describe("source evidence validation", () => {
  it("binds accepted analysis to exact excerpts and immutable source metadata", () => {
    const articles = [item("a", "rtvslo", "RTV Slovenija", quoteA), item("b", "n1", "N1 Slovenija", quoteB)];
    const validated = validateAnalysis(articles, analysis);

    expect(validated.briefing[0]?.evidence.map((citation) => citation.quote)).toEqual([quoteA, quoteB]);
    expect(validated.briefing[0]?.evidence[0]).toMatchObject({
      articleId: "a", sourceId: "rtvslo", publisher: "RTV Slovenija",
      url: "https://rtvslo.example/most", title: "Most v Vrhniki bo zaprt", quote: quoteA,
      quoteHash: createHash("sha256").update(quoteA).digest("hex"),
    });
    expect(validated.comparisons).toHaveLength(1);
    expect(validated.leads).toHaveLength(1);
  });

  it("discards fabricated quotes and references to unknown articles", () => {
    const unsupported = {
      ...analysis,
      briefing: [
        { text: "Unsupported fact.", citations: [{ articleId: "a", quote: "To besedilo ni bilo objavljeno." }] },
        { text: "Unknown source.", citations: [{ articleId: "not-in-feed", quote: quoteA }] },
      ],
      comparisons: [{
        kind: "contradiction", note: "Unverified", left: { articleId: "a", quote: "Izmišljen navedek." },
        right: { articleId: "b", quote: quoteB },
      }],
      leads: [{ question: "Kaj se je zgodilo?", rationale: "Nepodprto.", citations: [] }],
    };
    const validated = validateAnalysis([item("a", "rtvslo", "RTV Slovenija", quoteA), item("b", "n1", "N1 Slovenija", quoteB)], unsupported);

    expect(validated.briefing).toEqual([]);
    expect(validated.comparisons).toEqual([]);
    expect(validated.leads).toEqual([]);
  });

  it("does not label one publisher's two articles as cross-source disagreement", () => {
    const samePublisher = [item("a", "rtvslo", "RTV Slovenija", quoteA), item("b", "rtvslo", "RTV Slovenija", quoteB)];
    const validated = validateAnalysis(samePublisher, analysis);

    expect(validated.comparisons).toEqual([]);
    expect(validated.briefing).toHaveLength(1);
  });

  it("fails closed on malformed model output without losing raw reporting", () => {
    const validated = validateAnalysis([item("a", "rtvslo", "RTV Slovenija", quoteA)], null);

    expect(validated).toEqual({ category: "other", briefing: [], development: null, comparisons: [], leads: [] });
  });

  it("keeps only claims explicitly supported by the separate evidence review", () => {
    const candidate = validateAnalysis([item("a", "rtvslo", "RTV Slovenija", quoteA), item("b", "n1", "N1 Slovenija", quoteB)], analysis);
    const reviewed = applySupportReview(candidate, { supportedClaimIds: ["briefing:0", "lead:0"] });

    expect(reviewed.briefing).toHaveLength(1);
    expect(reviewed.comparisons).toEqual([]);
    expect(reviewed.leads).toHaveLength(1);
  });

  it("drops all narrative claims when the evidence review is malformed", () => {
    const candidate = validateAnalysis([item("a", "rtvslo", "RTV Slovenija", quoteA), item("b", "n1", "N1 Slovenija", quoteB)], analysis);
    const reviewed = applySupportReview(candidate, { supportedClaimIds: "briefing:0" });

    expect(reviewed).toMatchObject({ category: "public-safety", briefing: [], development: null, comparisons: [], leads: [] });
  });
});
