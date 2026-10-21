import type { FeedSource } from "../../shared/types.js";

export const PUBLIC_SOURCES: FeedSource[] = [
  {
    id: "rtvslo",
    name: "RTV Slovenija",
    region: "si",
    language: "sl",
    feedUrl: "https://img.rtvslo.si/feeds/novice.xml",
    homepage: "https://www.rtvslo.si",
  },
  {
    id: "n1",
    name: "N1 Slovenija",
    region: "si",
    language: "sl",
    feedUrl: "https://n1info.si/feed/",
    homepage: "https://n1info.si",
  },
  {
    id: "siol",
    name: "Siol.net",
    region: "si",
    language: "sl",
    feedUrl: "https://siol.net/feeds/section/novice",
    homepage: "https://siol.net",
  },
  {
    id: "delo",
    name: "Delo",
    region: "si",
    language: "sl",
    feedUrl: "https://www.delo.si/rss",
    homepage: "https://www.delo.si",
  },
  {
    id: "bbc-world",
    name: "BBC News · World",
    region: "world",
    language: "en",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    homepage: "https://www.bbc.com/news/world",
  },
  {
    id: "guardian-world",
    name: "The Guardian · World",
    region: "world",
    language: "en",
    feedUrl: "https://www.theguardian.com/world/rss",
    homepage: "https://www.theguardian.com/world",
  },
];
