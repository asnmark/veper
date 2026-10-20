import { createHash } from "node:crypto";
import type {
  BriefingPoint,
  EvidenceCitation,
  FollowUpLead,
  SourceComparison,
  StoredArticle,
  StoryAnalysis,
} from "../../shared/types.js";
import { STORY_CATEGORIES } from "../../shared/types.js";

const MAX_TEXT_LENGTH = 600;
const MAX_QUOTE_LENGTH = 700;
const MIN_QUOTE_LENGTH = 18;
const MAX_CITATIONS = 3;
const EMPTY_ANALYSIS: StoryAnalysis = {
  category: "other",
  briefing: [],
  development: null,
  comparisons: [],
  leads: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function plainText(value: unknown, max = MAX_TEXT_LENGTH): string {
  if (typeof value !== "string") return "";
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function citationOf(value: unknown, articles: Map<string, StoredArticle>): EvidenceCitation | null {
  if (!isRecord(value) || typeof value["articleId"] !== "string" || typeof value["quote"] !== "string") return null;
  const article = articles.get(value["articleId"]);
  const quote = value["quote"].trim();
  if (!article || quote.length < MIN_QUOTE_LENGTH || quote.length > MAX_QUOTE_LENGTH) return null;
  if (!`${article.title}\n${article.summary}`.includes(quote)) return null;

  return {
    articleId: article.id,
    sourceId: article.sourceId,
    publisher: article.sourceName,
    title: article.title,
    url: article.url,
    publishedAt: article.publishedAt,
    quote,
    quoteHash: createHash("sha256").update(quote).digest("hex"),
  };
}

function citationsOf(value: unknown, articles: Map<string, StoredArticle>): EvidenceCitation[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CITATIONS) return null;
  const citations = value.map((citation) => citationOf(citation, articles));
  if (citations.some((citation) => citation === null)) return null;
  const unique = new Map((citations as EvidenceCitation[]).map((citation) => [citation.articleId, citation]));
  return [...unique.values()];
}

function briefingPoint(value: unknown, articles: Map<string, StoredArticle>): BriefingPoint | null {
  if (!isRecord(value)) return null;
  const text = plainText(value["text"]);
  const evidence = citationsOf(value["citations"], articles);
  return text && evidence ? { text, evidence } : null;
}

function comparisonOf(value: unknown, articles: Map<string, StoredArticle>): SourceComparison | null {
  if (!isRecord(value)) return null;
  const kind = value["kind"];
  if (kind !== "agreement" && kind !== "difference" && kind !== "contradiction") return null;
  const note = plainText(value["note"]);
  const left = citationOf(value["left"], articles);
  const right = citationOf(value["right"], articles);
  if (!note || !left || !right || left.articleId === right.articleId || left.sourceId === right.sourceId) return null;
  return { kind, note, left, right };
}

function leadOf(value: unknown, articles: Map<string, StoredArticle>): FollowUpLead | null {
  if (!isRecord(value)) return null;
  const question = plainText(value["question"]);
  const rationale = plainText(value["rationale"]);
  const evidence = citationsOf(value["citations"], articles);
  if (!question.endsWith("?") || !rationale || !evidence) return null;
  return { question, rationale, evidence };
}

export function validateAnalysis(articlesInput: StoredArticle[], modelOutput: unknown): StoryAnalysis {
  if (!isRecord(modelOutput)) return { ...EMPTY_ANALYSIS };
  const articles = new Map(articlesInput.map((article) => [article.id, article]));
  const category = typeof modelOutput["category"] === "string" &&
    STORY_CATEGORIES.includes(modelOutput["category"] as (typeof STORY_CATEGORIES)[number])
    ? modelOutput["category"] as StoryAnalysis["category"]
    : "other";

  const briefing = Array.isArray(modelOutput["briefing"])
    ? modelOutput["briefing"].slice(0, 4).map((item) => briefingPoint(item, articles)).filter((item): item is BriefingPoint => !!item)
    : [];
  const development = briefingPoint(modelOutput["development"], articles);
  const comparisons = Array.isArray(modelOutput["comparisons"])
    ? modelOutput["comparisons"].slice(0, 4).map((item) => comparisonOf(item, articles)).filter((item): item is SourceComparison => !!item)
    : [];
  const leads = Array.isArray(modelOutput["leads"])
    ? modelOutput["leads"].slice(0, 3).map((item) => leadOf(item, articles)).filter((item): item is FollowUpLead => !!item)
    : [];

  return { category, briefing, development, comparisons, leads };
}

export function applySupportReview(analysis: StoryAnalysis, modelOutput: unknown): StoryAnalysis {
  if (!isRecord(modelOutput) || !Array.isArray(modelOutput["supportedClaimIds"])) {
    return { ...analysis, briefing: [], development: null, comparisons: [], leads: [] };
  }
  const supported = new Set(modelOutput["supportedClaimIds"].filter((id): id is string => typeof id === "string"));
  return {
    category: analysis.category,
    briefing: analysis.briefing.filter((_, index) => supported.has(`briefing:${index}`)),
    development: analysis.development && supported.has("development") ? analysis.development : null,
    comparisons: analysis.comparisons.filter((_, index) => supported.has(`comparison:${index}`)),
    leads: analysis.leads.filter((_, index) => supported.has(`lead:${index}`)),
  };
}
