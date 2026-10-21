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

export interface NewsroomSignal {
  id: "new" | "revision" | "multi-source" | "difference" | "contradiction";
  label: string;
}

export function newsroomSignals(story: StoryRecord, now: string): NewsroomSignal[] {
  const signals: NewsroomSignal[] = [];
  const nowMs = Date.parse(now);
  const cutoff = nowMs - 30 * 60_000;
  const activityTimes = story.articles.flatMap((article) => [
    article.observedAt,
    article.sourceUpdatedAt,
    ...article.revisions.map((revision) => revision.observedAt),
  ]).filter((value): value is string => Boolean(value)).map(Date.parse).filter((time) => Number.isFinite(time) && time <= nowMs);
  const latestActivity = Math.max(...activityTimes, Number.NEGATIVE_INFINITY);
  if (latestActivity >= cutoff) signals.push({ id: "new", label: "NOVO POROČANJE" });
  if (story.articles.some((article) => article.revisions.length > 0)) {
    signals.push({ id: "revision", label: "POSODOBLJENA OBJAVA" });
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
  return newsroomSignals(story, now).length > 0;
}

export function latestStoryActivity(story: StoryRecord): number {
  const activityTimes = [story.updatedAt, ...story.articles.flatMap((article) => [
    article.observedAt,
    article.sourceUpdatedAt ?? "",
    ...article.revisions.map((revision) => revision.observedAt),
  ])].map(Date.parse).filter(Number.isFinite);
  return Math.max(...activityTimes, Number.NEGATIVE_INFINITY);
}
