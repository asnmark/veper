import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { fetchFeedXml } from "../src/server/feeds/fetch-feed.js";

const server = createServer((request, response) => {
  if (request.url === "/redirect-away") {
    response.writeHead(302, { location: "https://example.invalid/news.xml" }).end();
    return;
  }
  if (request.url === "/too-large") {
    response.writeHead(200, { "content-type": "application/rss+xml", "content-length": 1_100_000 });
    response.end("x".repeat(1_100_000));
    return;
  }
  response.writeHead(200, { "content-type": "application/rss+xml; charset=utf-8" });
  response.end("<rss><channel><item><title>Novica</title></item></channel></rss>");
});

let feedUrl: string;

afterEach(async () => {
  if (server.listening) {
    server.close();
    await once(server, "close");
  }
});

async function serve(): Promise<void> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  feedUrl = `http://127.0.0.1:${address.port}`;
}

describe("fetchFeedXml", () => {
  it("fetches a bounded feed over HTTP and returns its XML", async () => {
    await serve();

    const result = await fetchFeedXml({
      id: "test", name: "Test", region: "si", language: "sl", homepage: feedUrl, feedUrl: `${feedUrl}/feed`,
    });

    expect(result.xml).toContain("<title>Novica</title>");
    expect(result.status).toBe(200);
  });

  it("rejects cross-host redirects before requesting the target", async () => {
    await serve();

    await expect(fetchFeedXml({
      id: "test", name: "Test", region: "si", language: "sl", homepage: feedUrl, feedUrl: `${feedUrl}/redirect-away`,
    })).rejects.toThrow(/preusmeritev/i);
  });

  it("rejects oversized feed responses before parsing", async () => {
    await serve();

    await expect(fetchFeedXml({
      id: "test", name: "Test", region: "si", language: "sl", homepage: feedUrl, feedUrl: `${feedUrl}/too-large`,
    })).rejects.toThrow(/velikost/i);
  });
});
