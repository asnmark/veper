import { expect, test, type Page } from "@playwright/test";
import type { DeskStatus, EvidenceCitation, StoryRecord, StoredArticle } from "../src/shared/types.js";

const quoteA = "Občina je potrdila, da bo most zaprt do petka.";
const quoteB = "N1 poroča, da bo zapora trajala do nedelje.";

function evidence(article: StoredArticle, quote: string): EvidenceCitation {
  return {
    articleId: article.id, sourceId: article.sourceId, publisher: article.sourceName,
    title: article.title, url: article.url, publishedAt: article.publishedAt, quote,
    quoteHash: `test-${article.id}`,
  };
}

function article(id: string, sourceId: string, sourceName: string, title: string, summary: string, url: string): StoredArticle {
  return {
    id, sourceId, sourceName, region: "si", language: "sl", externalId: id,
    storyId: "story-bridge", title, summary, url, canonicalUrl: url,
    publishedAt: "2026-10-20T07:00:00.000Z", sourceUpdatedAt: null, observedAt: "2026-10-20T07:15:00.000Z",
    lastSeenAt: "2026-10-20T07:15:00.000Z", contentHash: `hash-${id}`, revisions: [],
  };
}

const reportA = {
  ...article("a", "rtvslo", "RTV Slovenija", "Občina Vrhnika do petka zapira stari most", quoteA, "https://rtvslo.invalid/most"),
  observedAt: "2026-10-20T07:16:00.000Z",
  lastSeenAt: "2026-10-20T07:16:00.000Z",
  revisions: [{ id: "a-old", observedAt: "2026-10-20T07:15:00.000Z", title: "Občina Vrhnika zapira stari most", summary: "Občina bo most zaprla do četrtka.", contentHash: "old-hash" }],
};
const reportB: StoredArticle = {
  ...article("b", "n1", "N1 Slovenija", "Občina Vrhnika do nedelje zapira stari most", quoteB, "https://n1.invalid/most"),
  sourceUpdatedAt: "2026-10-20T07:15:30.000Z",
};
const bridge: StoryRecord = {
  id: "story-bridge", title: "Občina Vrhnika do nedelje zapira stari most",
  category: "public-safety", createdAt: "2026-10-20T07:00:00.000Z", updatedAt: "2026-10-20T07:16:00.000Z",
  saved: false,
  analysis: {
    category: "public-safety",
    briefing: [{ text: "Dve redakciji navajata različen konec zapore.", evidence: [evidence(reportA, quoteA), evidence(reportB, quoteB)] }],
    development: { text: "Drugi vir navaja nedeljski rok.", evidence: [evidence(reportB, quoteB)] },
    comparisons: [{
      kind: "contradiction", note: "Navedbi se razhajata glede datuma zaključka.",
      left: evidence(reportA, quoteA), right: evidence(reportB, quoteB),
    }],
    leads: [{
      question: "Kdaj bo zapora dejansko odpravljena?", rationale: "Objavljena roka se razlikujeta.",
      evidence: [evidence(reportA, quoteA), evidence(reportB, quoteB)],
    }],
  },
  analysisAt: "2026-10-20T07:15:30.000Z", articles: [reportB, reportA],
};
const policyArticle: StoredArticle = {
  ...article("c", "rtvslo", "RTV Slovenija", "Državni zbor potrdil predlog proračuna", "Poslanci so glasovali o državnem proračunu.", "https://rtvslo.invalid/proracun"),
  id: "c", storyId: "story-budget", observedAt: "2026-10-20T06:20:00.000Z", lastSeenAt: "2026-10-20T06:20:00.000Z",
};
const policy: StoryRecord = {
  id: "story-budget", title: policyArticle.title, category: "politics",
  createdAt: "2026-10-20T06:20:00.000Z", updatedAt: "2026-10-20T06:20:00.000Z",
  saved: false, analysis: null, analysisAt: null, articles: [policyArticle],
};

const desk: DeskStatus = {
  generatedAt: "2026-10-20T07:16:00.000Z", lastRefreshAt: "2026-10-20T07:15:00.000Z",
  nextRefreshAt: "2026-10-20T07:16:30.000Z", pollIntervalMs: 90_000, refreshing: false,
  ai: { state: "ready", model: "gemini-flash-latest", message: "Primerjava je vezana na izvirne navedke.", pendingStories: 0 },
  stats: { activeStories: 2, freshArticles: 3, crossSourceStories: 1, storiesWithDiscrepancies: 1 },
  stories: [bridge, policy],
  sources: [
    { id: "rtvslo", name: "RTV Slovenija", region: "si", homepage: "https://rtvslo.invalid", state: "online", lastCheckedAt: "2026-10-20T07:15:00.000Z", lastSuccessAt: "2026-10-20T07:15:00.000Z", lastHttpStatus: 200, lastError: null, articlesIn24h: 2 },
    { id: "n1", name: "N1 Slovenija", region: "si", homepage: "https://n1.invalid", state: "online", lastCheckedAt: "2026-10-20T07:15:00.000Z", lastSuccessAt: "2026-10-20T07:15:00.000Z", lastHttpStatus: 200, lastError: null, articlesIn24h: 1 },
    { id: "bbc-world", name: "BBC News · World", region: "world", homepage: "https://www.bbc.com/news/world", state: "waiting", lastCheckedAt: null, lastSuccessAt: null, lastHttpStatus: null, lastError: null, articlesIn24h: 0 },
  ],
};

async function installApiRoutes(page: Page): Promise<void> {
  await page.route("**/api/events", (route) => route.abort());
  await page.route("**/api/desk", (route) => route.fulfill({ json: desk }));
  await page.route("**/api/refresh", (route) => route.fulfill({ json: { inserted: 0, updated: 0, sourceCount: 5, failedSourceCount: 0 } }));
  await page.route("**/api/stories/*/saved", (route) => route.fulfill({ json: { saved: true } }));
  await page.goto("/");
}

test("opens a source-grounded discrepancy dossier", async ({ page }) => {
  await installApiRoutes(page);

  await expect(page.getByRole("heading", { name: "Uredniški pregled" })).toBeVisible();
  await expect(page.getByText("2", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Filter: možna neskladja" }).click();
  await expect(page.getByRole("button", { name: /Občina Vrhnika do nedelje/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Primerjava poročanja" })).toBeVisible();
  const dossier = page.getByRole("region", { name: "Dosje zgodbe" });
  const comparison = page.getByRole("region", { name: "Primerjava virov" });
  await expect(dossier.getByText("AI PREDLOG · PREGLED PODPORE")).toBeVisible();
  await expect(dossier.getByText(/To ni neodvisna potrditev/)).toBeVisible();
  await expect(comparison.getByText(quoteA)).toBeVisible();
  await expect(comparison.getByText(quoteB)).toBeVisible();
  await expect(comparison.getByRole("link", { name: "Odpri izvirnik: RTV Slovenija" })).toHaveAttribute("href", "https://rtvslo.invalid/most");
  await expect(dossier.getByText(/posodobitev zajeta ·/)).toBeVisible();
  await expect(dossier.getByText(/vir posodobil ·/)).toBeVisible();
  await expect(dossier.getByText("PREJŠNJI IZSEK")).toBeVisible();
  const titleBox = await dossier.getByRole("heading", { name: bridge.title, level: 2 }).boundingBox();
  const saveBox = await dossier.getByRole("button", { name: "Shrani zgodbo" }).boundingBox();
  expect(titleBox && saveBox && (
    titleBox.x + titleBox.width <= saveBox.x || saveBox.x + saveBox.width <= titleBox.x ||
    titleBox.y + titleBox.height <= saveBox.y || saveBox.y + saveBox.height <= titleBox.y
  )).toBe(true);
  await page.screenshot({ path: "test-results/veper-desk-desktop.png", fullPage: true });
});

test("searches, saves a story, and requests a feed refresh", async ({ page }) => {
  await installApiRoutes(page);

  const search = page.getByRole("searchbox", { name: "Išči zgodbe" });
  await search.fill("proračuna");
  await expect(page.getByRole("button", { name: /Državni zbor potrdil/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Občina Vrhnika/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Državni zbor potrdil/ }).click();
  await page.getByRole("button", { name: "Shrani zgodbo" }).click();
  await expect(page.getByRole("button", { name: "Odstrani iz shranjenih" })).toBeVisible();
  await page.getByRole("button", { name: "Osveži vire" }).click();
  await expect(page.getByText(/virov uspešno osveženih/)).toBeVisible();
});

test("surfaces concrete newsroom signals and filters stories in development", async ({ page }) => {
  await installApiRoutes(page);

  await expect(page.getByText("NOVO POROČANJE").first()).toBeVisible();
  await expect(page.getByText("VEČ VIROV").first()).toBeVisible();
  await expect(page.getByText("POSODOBLJENA OBJAVA").first()).toBeVisible();
  await expect(page.getByText("MOŽNO NESKLADJE").first()).toBeVisible();
  await page.getByRole("button", { name: "Filter: v razvoju" }).click();
  await expect(page.getByRole("button", { name: /Občina Vrhnika do nedelje/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Državni zbor potrdil/ })).toHaveCount(0);
});

test("keeps filters and the selected story reachable on a narrow screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installApiRoutes(page);

  const rail = page.locator(".source-rail");
  await expect(rail).toHaveAttribute("aria-hidden", "true");
  await expect.poll(() => rail.evaluate((element) => (element as HTMLElement).inert)).toBe(true);
  const menu = page.getByRole("button", { name: "Odpri filtre" });
  await menu.click();
  await expect(rail).toHaveAttribute("aria-hidden", "false");
  await expect.poll(() => rail.evaluate((element) => (element as HTMLElement).inert)).toBe(false);
  await expect(page.getByRole("button", { name: "Filter: možna neskladja" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("button", { name: "Filter: možna neskladja" }).click();
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("heading", { name: "Primerjava poročanja" })).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Išči zgodbe" });
  await search.focus();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeFocused();
  await expect(page.getByRole("region", { name: "Primerjava virov" }).getByRole("link", { name: "Odpri izvirnik: N1 Slovenija" })).toBeVisible();
  await expect.poll(() => page.locator(".source-rail").evaluate((rail) => rail.getBoundingClientRect().right <= 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: "test-results/veper-desk-mobile.png", fullPage: true });
});

test("states unavailable feeds and disabled intelligence without implying live coverage", async ({ page }) => {
  const offlineDesk: DeskStatus = {
    ...desk,
    ai: { state: "disabled", model: null, message: "Gemini ni nastavljen; prikazani so samo podatki iz virov.", pendingStories: 0 },
    sources: desk.sources.map((source) => ({
      ...source, state: "offline", lastCheckedAt: desk.generatedAt, lastSuccessAt: null,
      lastHttpStatus: 403, lastError: "Vir ni dosegljiv.",
    })),
  };
  await page.route("**/api/events", (route) => route.abort());
  await page.route("**/api/desk", (route) => route.fulfill({ json: offlineDesk }));
  await page.goto("/");

  await expect(page.getByText("0/3 VIROV DOSEGLJIVIH")).toBeVisible();
  await expect(page.getByText("Gemini ni nastavljen; prikazani so samo podatki iz virov.")).toBeVisible();
  await expect(page.getByText("VIRNI PREGLED")).toBeVisible();
  await expect(page.locator(".health-error").first()).toContainText("Vir ni dosegljiv.");
});
