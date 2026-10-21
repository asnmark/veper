import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { FeedItem, FeedSource } from "../../shared/types.js";

const MAX_XML_CHARS = 2_000_000;
const MAX_EXCERPT_CHARS = 900;

export class FeedParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FeedParseError";
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  cdataPropName: "__cdata",
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function entriesOf(value: unknown, format: string): RawEntry[] {
  const entries = value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
  if (entries.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) {
    throw new FeedParseError(`Vnosi ${format} vira niso ustrezno strukturirani.`);
  }
  return entries as RawEntry[];
}

function textOf(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(textOf).join(" ");
  if (value && typeof value === "object") {
    const entry = value as Record<string, unknown>;
    return textOf(entry["#text"] ?? entry["__cdata"] ?? entry["content"] ?? "");
  }
  return "";
}

function cleanExcerpt(value: unknown): string {
  return textOf(value)
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_EXCERPT_CHARS);
}

function safeHttpUrl(value: unknown): string | null {
  const raw = textOf(value).trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function linkOf(value: unknown): string | null {
  const links = asArray(value);
  const preferred = links.find((link) => {
    return !!link && typeof link === "object" && (link as Record<string, unknown>)["@_rel"] === "alternate";
  });
  for (const link of [preferred, ...links]) {
    if (link && typeof link === "object") {
      const record = link as Record<string, unknown>;
      const href = safeHttpUrl(record["@_href"]);
      if (href) return href;
    }
    const href = safeHttpUrl(link);
    if (href) return href;
  }
  return null;
}

function dateOf(...values: unknown[]): string | null {
  for (const value of values) {
    const raw = textOf(value).trim();
    if (!raw) continue;
    const time = Date.parse(raw);
    if (Number.isFinite(time)) return new Date(time).toISOString();
  }
  return null;
}

interface RawEntry extends Record<string, unknown> {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  id?: unknown;
  description?: unknown;
  summary?: unknown;
  content?: unknown;
  "content:encoded"?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
  date?: unknown;
}

function rawEntries(document: unknown): RawEntry[] {
  if (!document || typeof document !== "object") return [];
  const root = document as Record<string, unknown>;
  if (Object.hasOwn(root, "rss")) {
    const rss = root["rss"] as Record<string, unknown> | undefined;
    if (!rss || !Object.hasOwn(rss, "channel")) throw new FeedParseError("Struktura RSS vira ni podprta: manjka kanal.");
    const rawChannel = rss["channel"];
    if (typeof rawChannel === "string" && !rawChannel.trim()) return [];
    if (!rawChannel || typeof rawChannel !== "object" || Array.isArray(rawChannel)) {
      throw new FeedParseError("Struktura RSS kanala ni podprta.");
    }
    const channel = rawChannel as Record<string, unknown>;
    return entriesOf(channel["item"], "RSS");
  }

  if (Object.hasOwn(root, "feed")) {
    const rawAtom = root["feed"];
    if (typeof rawAtom === "string" && !rawAtom.trim()) return [];
    if (!rawAtom || typeof rawAtom !== "object" || Array.isArray(rawAtom)) {
      throw new FeedParseError("Struktura Atom vira ni podprta.");
    }
    const atom = rawAtom as Record<string, unknown>;
    return entriesOf(atom["entry"], "Atom");
  }

  if (Object.hasOwn(root, "RDF")) {
    const rawRdf = root["RDF"];
    if (typeof rawRdf === "string" && !rawRdf.trim()) return [];
    if (!rawRdf || typeof rawRdf !== "object" || Array.isArray(rawRdf)) {
      throw new FeedParseError("Struktura RDF vira ni podprta.");
    }
    const rdf = rawRdf as Record<string, unknown>;
    return entriesOf(rdf["item"], "RDF");
  }
  throw new FeedParseError("Format vira ni podprt; pričakovan je RSS, Atom ali RDF.");
}

export function parseFeed(xml: string, source: FeedSource, observedAt: string): FeedItem[] {
  if (!xml.trim() || xml.length > MAX_XML_CHARS) throw new FeedParseError("XML vira je prazen ali presega dovoljeno velikost.");
  const validation = XMLValidator.validate(xml);
  if (validation !== true) throw new FeedParseError(`XML vira ni veljaven: ${validation.err.msg}`);

  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch (error) {
    throw new FeedParseError("XML vira ni mogoče razčleniti.", { cause: error });
  }

  return rawEntries(document).flatMap((entry) => {
    const title = cleanExcerpt(entry.title);
    const url = linkOf(entry.link);
    if (!title || !url) return [];

    const externalId = cleanExcerpt(entry.guid ?? entry.id) || url;
    const summary = cleanExcerpt(entry.description ?? entry.summary ?? entry["content:encoded"] ?? entry.content);

    return [{
      externalId: externalId.slice(0, 500),
      sourceId: source.id,
      sourceName: source.name,
      region: source.region,
      language: source.language,
      title: title.slice(0, 360),
      summary,
      url,
      publishedAt: dateOf(entry.pubDate, entry.published, entry.date),
      sourceUpdatedAt: dateOf(entry.updated),
      observedAt,
    }];
  });
}
