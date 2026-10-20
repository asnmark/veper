import type { PendingStory } from "../db.js";
import type { StoryAnalysis } from "../../shared/types.js";

export interface AnalyzedStory {
  storyId: string;
  analysis: StoryAnalysis;
}

export interface StoryAnalyzer {
  readonly model: string;
  analyzeStories(stories: PendingStory[]): Promise<AnalyzedStory[]>;
}
