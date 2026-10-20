import { describe, expect, it } from "vitest";
import { createNewsroomApp } from "../src/server/app.js";
import { NewsStore } from "../src/server/db.js";

describe("server-sent newsroom updates", () => {
  it("keeps its listener alive after the request has been read", async () => {
    const store = new NewsStore(":memory:");
    const { app, newsroom } = await createNewsroomApp({ store, sources: [], analyzer: null });
    let markRequestComplete: (() => void) | undefined;
    app.addHook("onRequest", async (request) => {
      markRequestComplete = () => request.raw.emit("close");
    });
    const baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const response = await fetch(new URL("/api/events", baseUrl));
      expect(response.status).toBe(200);
      expect(response.body).not.toBeNull();
      reader = response.body!.getReader();
      const decoder = new TextDecoder();
      expect(decoder.decode((await reader.read()).value)).toContain("event: connected");

      // A completed GET request is not the same as a disconnected SSE response.
      markRequestComplete?.();

      const event = new Promise<string>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("SSE naročnina ni prejela dogodka.")), 1_500);
        void reader!.read().then(({ value }) => {
          clearTimeout(timeout);
          resolve(decoder.decode(value));
        }, reject);
      });
      const refresh = await fetch(new URL("/api/refresh", baseUrl), { method: "POST" });
      expect(refresh.status).toBe(200);
      expect(await event).toContain("event: desk-updated");
      expect(newsroom.getDesk().lastRefreshAt).not.toBeNull();
    } finally {
      await reader?.cancel();
      await app.close();
      store.close();
    }
  });
});
