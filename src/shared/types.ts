export type NewsRegion = "si" | "world";

export interface FeedSource {
  id: string;
  name: string;
  region: NewsRegion;
  language: string;
  feedUrl: string;
  homepage: string;
}

export interface FeedItem {
  externalId: string;
  sourceId: string;
  sourceName: string;
  region: NewsRegion;
  language: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string | null;
  observedAt: string;
}

export const STORY_CATEGORIES = [
  "politics", "public-safety", "economy", "society", "world", "environment", "culture", "sport", "technology", "other",
] as const;

export type StoryCategory = (typeof STORY_CATEGORIES)[number];
export type ComparisonKind = "agreement" | "difference" | "contradiction";

export interface EvidenceCitation {
  articleId: string;
  sourceId: string;
  publisher: string;
  title: string;
  url: string;
  publishedAt: string | null;
  quote: string;
  quoteHash: string;
}

export interface BriefingPoint {
  text: string;
  evidence: EvidenceCitation[];
}

export interface SourceComparison {
  kind: ComparisonKind;
  note: string;
  left: EvidenceCitation;
  right: EvidenceCitation;
}

export interface FollowUpLead {
  question: string;
  rationale: string;
  evidence: EvidenceCitation[];
}

export interface StoryAnalysis {
  category: StoryCategory;
  briefing: BriefingPoint[];
  development: BriefingPoint | null;
  comparisons: SourceComparison[];
  leads: FollowUpLead[];
}

export interface ArticleRevision {
  id: string;
  observedAt: string;
  title: string;
  summary: string;
  contentHash: string;
}

export interface StoredArticle extends FeedItem {
  id: string;
  storyId: string;
  canonicalUrl: string;
  contentHash: string;
  lastSeenAt: string;
  revisions: ArticleRevision[];
}

export interface StoryRecord {
  id: string;
  title: string;
  category: StoryCategory | null;
  createdAt: string;
  updatedAt: string;
  saved: boolean;
  analysis: StoryAnalysis | null;
  analysisAt: string | null;
  articles: StoredArticle[];
}

export type SourceState = "waiting" | "online" | "stale" | "offline";

export interface SourceHealth {
  id: string;
  name: string;
  region: NewsRegion;
  homepage: string;
  state: SourceState;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
  articlesIn24h: number;
}

export type AIState = "disabled" | "idle" | "processing" | "ready" | "error";

export interface DeskStatus {
  generatedAt: string;
  lastRefreshAt: string | null;
  nextRefreshAt: string | null;
  pollIntervalMs: number;
  refreshing: boolean;
  ai: {
    state: AIState;
    model: string | null;
    message: string;
    pendingStories: number;
  };
  stats: {
    activeStories: number;
    freshArticles: number;
    crossSourceStories: number;
    storiesWithDiscrepancies: number;
  };
  stories: StoryRecord[];
  sources: SourceHealth[];
}
