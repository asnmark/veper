import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/server/feeds/parse-feed.js";
import type { FeedSource } from "../src/shared/types.js";

const source: FeedSource = {
  id: "rtvslo",
  name: "RTV SLO",
  region: "si",
  language: "sl",
  feedUrl: "https://img.rtvslo.si/feeds/novice.xml",
  homepage: "https://www.rtvslo.si",
};
const observedAt = "2026-10-20T07:15:00.000Z";

describe("parseFeed", () => {
  it("parses RSS links, publisher time, and a clean bounded excerpt", () => {
    const items = parseFeed(
      `<?xml version="1.0"?><rss version="2.0"><channel><item>
        <guid>rtvslo-42</guid>
        <title>Zapora mostu v Vrhniki</title>
        <link>https://www.rtvslo.si/novice/slovenija/most-vrhniki</link>
        <pubDate>Tue, 20 Oct 2026 07:00:00 GMT</pubDate>
        <description><![CDATA[Občina je sporočila, da bo most zaprt do petka. <script>nevarno()</script><b>Obvoz</b> je urejen.]]></description>
      </item></channel></rss>`,
      source,
      observedAt,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "rtvslo-42",
      title: "Zapora mostu v Vrhniki",
      url: "https://www.rtvslo.si/novice/slovenija/most-vrhniki",
      publishedAt: "2026-10-20T07:00:00.000Z",
      observedAt,
      summary: "Občina je sporočila, da bo most zaprt do petka. Obvoz je urejen.",
    });
  });

  it("parses Atom entry links and keeps capture time when publisher time is invalid", () => {
    const items = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom">
        <entry><id>tag:n1info.si,2026:abc</id><title>Razvoj dogodka</title>
          <link rel="alternate" href="https://n1info.si/novice/slovenija/abc"/>
          <updated>neznan čas</updated>
          <summary type="html">&lt;p&gt;Policija je potrdila ogled prizorišča.&lt;/p&gt;</summary>
        </entry>
      </feed>`,
      { ...source, id: "n1", name: "N1", feedUrl: "https://n1info.si/feed/", homepage: "https://n1info.si" },
      observedAt,
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      externalId: "tag:n1info.si,2026:abc",
      url: "https://n1info.si/novice/slovenija/abc",
      publishedAt: null,
      observedAt,
      summary: "Policija je potrdila ogled prizorišča.",
    });
  });

  it("keeps Atom publication and update timestamps separate", () => {
    const [item] = parseFeed(
      `<feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <id>tag:n1info.si,2026:updated</id><title>Posodobljena zgodba</title>
        <link rel="alternate" href="https://n1info.si/novice/slovenija/updated"/>
        <published>2026-10-20T06:00:00Z</published><updated>2026-10-20T07:30:00Z</updated>
      </entry></feed>`,
      source,
      observedAt,
    );

    expect(item).toMatchObject({
      publishedAt: "2026-10-20T06:00:00.000Z",
      sourceUpdatedAt: "2026-10-20T07:30:00.000Z",
    });
  });

  it("drops entries without a usable title or safe source URL and caps excerpts", () => {
    const longText = "novica ".repeat(200);
    const items = parseFeed(
      `<rss><channel>
        <item><guid>no-title</guid><link>https://www.rtvslo.si/a</link><description>x</description></item>
        <item><guid>unsafe</guid><title>Nevarno</title><link>javascript:alert(1)</link><description>x</description></item>
        <item><guid>bounded</guid><title>Naslov</title><link>https://www.rtvslo.si/b</link><description>${longText}</description></item>
      </channel></rss>`,
      source,
      observedAt,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.summary.length).toBeLessThanOrEqual(900);
  });

  it("rejects malformed XML instead of silently returning an empty live feed", () => {
    expect(() => parseFeed("<rss><channel><item>", source, observedAt)).toThrow(/XML/i);
  });

  it("rejects an unsupported XML document while accepting a valid empty RSS or Atom feed", () => {
    expect(() => parseFeed("<response><status>temporarily unavailable</status></response>", source, observedAt))
      .toThrow(/format vira ni podprt/i);
    expect(parseFeed("<rss><channel/></rss>", source, observedAt)).toEqual([]);
    expect(parseFeed('<feed xmlns="http://www.w3.org/2005/Atom"/>', source, observedAt)).toEqual([]);
    expect(parseFeed("<RDF/>", source, observedAt)).toEqual([]);
    expect(() => parseFeed("<RDF>temporary error</RDF>", source, observedAt)).toThrow(/struktura RDF/i);
    expect(() => parseFeed("<rss><channel><item>temporary error</item></channel></rss>", source, observedAt))
      .toThrow(/vnosi RSS/i);
    expect(() => parseFeed('<feed><entry>temporary error</entry></feed>', source, observedAt))
      .toThrow(/vnosi Atom/i);
    expect(() => parseFeed("<RDF><item>temporary error</item></RDF>", source, observedAt))
      .toThrow(/vnosi RDF/i);
  });
});
