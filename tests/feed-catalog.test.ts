import { describe, expect, it } from "vitest";
import { PUBLIC_SOURCES } from "../src/server/feeds/catalog.js";

describe("public newsroom feeds", () => {
  it("uses current RSS endpoints and includes a second Slovenian daily", () => {
    expect(PUBLIC_SOURCES.map((source) => source.id)).toEqual([
      "rtvslo", "n1", "siol", "delo", "bbc-world", "guardian-world",
    ]);
    expect(PUBLIC_SOURCES.map((source) => source.feedUrl)).toEqual([
      "https://img.rtvslo.si/feeds/novice.xml",
      "https://n1info.si/feed/",
      "https://siol.net/feeds/section/novice",
      "https://www.delo.si/rss",
      "https://feeds.bbci.co.uk/news/world/rss.xml",
      "https://www.theguardian.com/world/rss",
    ]);
  });
});
