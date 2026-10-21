import type { SourceState, StoryCategory, StoryRecord, StoredArticle } from "../shared/types.js";

const slovenianTime = new Intl.DateTimeFormat("sl-SI", {
  timeZone: "Europe/Ljubljana", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
});
const slovenianDate = new Intl.DateTimeFormat("sl-SI", {
  timeZone: "Europe/Ljubljana", day: "numeric", month: "long", year: "numeric",
});
const slovenianClock = new Intl.DateTimeFormat("sl-SI", {
  timeZone: "Europe/Ljubljana", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

export const categoryLabels: Record<StoryCategory, string> = {
  politics: "Politika",
  "public-safety": "Varnost",
  economy: "Gospodarstvo",
  society: "Družba",
  world: "Svet",
  environment: "Okolje",
  culture: "Kultura",
  sport: "Šport",
  technology: "Tehnologija",
  other: "Drugo",
};

export function formatDateTime(value: string | null): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "čas ni naveden";
  return slovenianTime.format(new Date(value));
}

export function formatObservedTime(article: Pick<StoredArticle, "publishedAt" | "sourceUpdatedAt" | "observedAt">): string {
  const sourceUpdated = article.sourceUpdatedAt &&
    (!article.publishedAt || Date.parse(article.sourceUpdatedAt) > Date.parse(article.publishedAt));
  if (article.publishedAt && sourceUpdated) {
    return `objavljeno ${formatDateTime(article.publishedAt)} · vir posodobil ${formatDateTime(article.sourceUpdatedAt)}`;
  }
  if (article.publishedAt) return `objavljeno ${formatDateTime(article.publishedAt)}`;
  if (sourceUpdated) return `čas objave ni naveden · vir posodobil ${formatDateTime(article.sourceUpdatedAt)}`;
  return `čas objave ni naveden · zajeto ${formatDateTime(article.observedAt)}`;
}

export function formatDate(value: string): string {
  return Number.isFinite(Date.parse(value)) ? slovenianDate.format(new Date(value)) : "danes";
}

export function formatClock(value: string): string {
  return Number.isFinite(Date.parse(value)) ? slovenianClock.format(new Date(value)) : "--:--";
}

export function relativeTime(value: string | null, now: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "brez podatka o času";
  const elapsed = Math.max(0, Date.parse(now) - Date.parse(value));
  if (elapsed < 60_000) return "pravkar";
  if (elapsed < 60 * 60_000) return `pred ${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < 24 * 60 * 60_000) return `pred ${Math.floor(elapsed / (60 * 60_000))} h`;
  return formatDateTime(value);
}

export function sourceStateLabel(state: SourceState): string {
  switch (state) {
    case "online": return "dosegljiv";
    case "degraded": return "zadnji pregled ni uspel";
    case "stale": return "zastarel";
    case "offline": return "nedosegljiv";
    case "waiting": return "čaka na preverjanje";
  }
}

export function significantText(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("sl-SI");
}

export function sourceCount(story: StoryRecord): number {
  return new Set(story.articles.map((article) => article.sourceId)).size;
}

export function sourceCountLabel(count: number): string {
  const noun = count === 1 ? "vir" : count === 2 ? "vira" : count === 3 || count === 4 ? "viri" : "virov";
  return `${count} ${noun}`;
}

export function publicSourceCountLabel(count: number): string {
  if (count === 1) return "1 javni vir";
  if (count === 2) return "2 javna vira";
  if (count === 3 || count === 4) return `${count} javni viri`;
  return `${count} javnih virov`;
}

export interface NewsroomSignal {
  id: "new" | "source-update" | "revision" | "capture" | "multi-source" | "difference" | "contradiction";
  label: string;
}

export function newsroomSignals(story: StoryRecord, now: string): NewsroomSignal[] {
  const signals: NewsroomSignal[] = [];
  const nowMs = Date.parse(now);
  const cutoff = nowMs - 30 * 60_000;
  const isRecent = (value: string | null): boolean => {
    if (!value) return false;
    const time = Date.parse(value);
    return Number.isFinite(time) && time >= cutoff && time <= nowMs;
  };
  const recentlyPublished = story.articles.some((article) => isRecent(article.publishedAt));
  const recentlyUpdatedBySource = story.articles.some((article) =>
    isRecent(article.sourceUpdatedAt) && (!article.publishedAt || Date.parse(article.sourceUpdatedAt!) > Date.parse(article.publishedAt)));
  const recentlyRevised = story.articles.some((article) => article.revisions.some((revision) => isRecent(revision.observedAt)));
  const recentlyCapturedOlderArticle = story.articles.some((article) =>
    isRecent(article.observedAt) && !isRecent(article.publishedAt) &&
    !isRecent(article.sourceUpdatedAt) && !article.revisions.some((revision) => isRecent(revision.observedAt)));

  if (recentlyPublished) signals.push({ id: "new", label: "NOVO POROČANJE" });
  if (recentlyUpdatedBySource) signals.push({ id: "source-update", label: "VIR JE POSODOBIL" });
  if (recentlyRevised) signals.push({ id: "revision", label: "SPREMEMBA ZAJETA" });
  if (!recentlyPublished && !recentlyUpdatedBySource && !recentlyRevised && recentlyCapturedOlderArticle) {
    signals.push({ id: "capture", label: "PRVIČ ZAJETO" });
  }
  if (sourceCount(story) > 1) signals.push({ id: "multi-source", label: "VEČ VIROV" });
  if (story.analysis?.comparisons.some((item) => item.kind === "contradiction")) {
    signals.push({ id: "contradiction", label: "MOŽNO NESKLADJE" });
  } else if (story.analysis?.comparisons.some((item) => item.kind === "difference")) {
    signals.push({ id: "difference", label: "RAZLIČEN POUDAR" });
  }
  return signals;
}

export function isDevelopingStory(story: StoryRecord, now: string): boolean {
  return newsroomSignals(story, now).some((signal) => ["new", "source-update", "revision"].includes(signal.id));
}

function developingStoryRank(story: StoryRecord, now: string): number {
  if (!isDevelopingStory(story, now)) return Number.POSITIVE_INFINITY;
  if (story.analysis?.comparisons.some((item) => item.kind === "contradiction")) return 0;
  if (newsroomSignals(story, now).some((signal) => signal.id === "source-update" || signal.id === "revision")) return 1;
  if (story.analysis?.comparisons.some((item) => item.kind === "difference")) return 2;
  if (newsroomSignals(story, now).some((signal) => signal.id === "multi-source")) return 3;
  return 4;
}

export function compareDevelopingStories(left: StoryRecord, right: StoryRecord, now: string): number {
  const rankDifference = developingStoryRank(left, now) - developingStoryRank(right, now);
  return rankDifference || latestStoryActivity(right) - latestStoryActivity(left);
}

export function latestStoryActivity(story: StoryRecord): number {
  const activityTimes = [story.updatedAt, ...story.articles.flatMap((article) => [
    article.observedAt,
    article.sourceUpdatedAt ?? "",
    ...article.revisions.map((revision) => revision.observedAt),
  ])].map(Date.parse).filter(Number.isFinite);
  return Math.max(...activityTimes, Number.NEGATIVE_INFINITY);
}
