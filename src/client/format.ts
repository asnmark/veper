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

export function formatObservedTime(article: Pick<StoredArticle, "publishedAt" | "observedAt">): string {
  if (article.publishedAt) return `objavljeno ${formatDateTime(article.publishedAt)}`;
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
