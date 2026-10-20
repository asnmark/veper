import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { resolve } from "node:path";
import type { FeedSource } from "../shared/types.js";
import { PUBLIC_SOURCES } from "./feeds/catalog.js";
import { NewsStore } from "./db.js";
import { NewsroomService, type NewsroomOptions } from "./newsroom.js";
import type { StoryAnalyzer } from "./intelligence/types.js";

export interface CreateAppOptions extends Omit<NewsroomOptions, "sources" | "store" | "analyzer"> {
  store?: NewsStore;
  sources?: FeedSource[];
  analyzer?: StoryAnalyzer | null;
  serveClient?: boolean;
  databasePath?: string;
  logger?: FastifyServerOptions["logger"];
}

export interface NewsroomApp {
  app: FastifyInstance;
  newsroom: NewsroomService;
  store: NewsStore;
}

export async function createNewsroomApp(options: CreateAppOptions = {}): Promise<NewsroomApp> {
  const store = options.store ?? new NewsStore(options.databasePath);
  const sources = options.sources ?? PUBLIC_SOURCES;
  const newsroom = new NewsroomService({
    store,
    sources,
    analyzer: options.analyzer ?? null,
    ...(options.pollIntervalMs === undefined ? {} : { pollIntervalMs: options.pollIntervalMs }),
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 32_000 });

  app.get("/api/health", async () => ({ ok: true }));
  app.get("/api/desk", async () => newsroom.getDesk());
  app.post("/api/refresh", async () => newsroom.refreshSources());
  app.put<{ Params: { storyId: string }; Body: { saved: boolean } }>("/api/stories/:storyId/saved", {
    schema: {
      params: {
        type: "object",
        required: ["storyId"],
        properties: { storyId: { type: "string", minLength: 1, maxLength: 100 } },
        additionalProperties: false,
      },
      body: {
        type: "object",
        required: ["saved"],
        properties: { saved: { type: "boolean" } },
        additionalProperties: false,
      },
    },
  }, async (request, reply) => {
    const found = store.setSaved(request.params.storyId, request.body.saved);
    if (!found) return reply.code(404).send({ error: "Zgodba ni več na voljo." });
    return { storyId: request.params.storyId, saved: request.body.saved };
  });
  app.get("/api/events", async (_request, reply) => {
    reply.hijack();
    let closed = false;
    const unsubscribe = newsroom.onUpdate(() => reply.raw.write(`event: desk-updated\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`));
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 20_000);
    const cleanup = () => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    reply.raw.once("close", cleanup);
    reply.raw.once("error", cleanup);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    reply.raw.write("event: connected\ndata: {}\n\n");
  });

  if (options.serveClient) {
    await app.register(fastifyStatic, { root: resolve(process.cwd(), "dist/client"), prefix: "/" });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && request.headers.accept?.includes("text/html")) {
        return reply.sendFile("index.html");
      }
      return reply.code(404).send({ error: "Pot ni najdena." });
    });
  }

  return { app, newsroom, store };
}
