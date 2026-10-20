import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createNewsroomApp } from "./app.js";
import { GeminiAnalyzer } from "./intelligence/gemini.js";

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value || !/^\d+$/.test(value)) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function start(): Promise<void> {
  const host = process.env["HOST"]?.trim() || "127.0.0.1";
  const port = positiveInteger(process.env["PORT"], 4179);
  const pollIntervalMs = positiveInteger(process.env["POLL_INTERVAL_MS"], 90_000);
  const databasePath = process.env["DATABASE_PATH"]?.trim() || ".data/veper.sqlite";
  if (databasePath !== ":memory:") mkdirSync(dirname(resolve(databasePath)), { recursive: true });

  const apiKey = process.env["GEMINI_API_KEY"]?.trim();
  const newsroomApp = await createNewsroomApp({
    databasePath,
    pollIntervalMs,
    analyzer: apiKey ? new GeminiAnalyzer(apiKey) : null,
    serveClient: process.env["NODE_ENV"] === "production",
    logger: process.env["NODE_ENV"] === "production",
  });

  const server = await newsroomApp.app.listen({ host, port });
  console.log(`Veper posluša na ${server} · Gemini ${apiKey ? "vključen" : "ni nastavljen"}`);

  let stopping = false;
  let activeRefresh: Promise<unknown> | null = null;
  const refresh = () => {
    if (activeRefresh) return;
    activeRefresh = newsroomApp.newsroom.refreshSources()
      .catch(() => { console.error("Osvežitev javnih virov ni uspela; shranjeni podatki ostajajo na voljo."); })
      .finally(() => { activeRefresh = null; });
  };
  let poller: NodeJS.Timeout | undefined;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    if (poller) clearInterval(poller);
    console.log(`Ustavljam Veper (${signal}).`);
    try {
      await activeRefresh;
      await newsroomApp.app.close();
    } finally {
      newsroomApp.store.close();
    }
  };
  process.once("SIGINT", () => { void shutdown("SIGINT"); });
  process.once("SIGTERM", () => { void shutdown("SIGTERM"); });
  if (process.env["VEPER_DISABLE_POLLING"] !== "1") {
    refresh();
    poller = setInterval(refresh, pollIntervalMs);
    poller.unref();
  }
}

void start().catch(() => {
  console.error("Veperja ni bilo mogoče zagnati. Preverite konfiguracijo in vrata.");
  process.exitCode = 1;
});
