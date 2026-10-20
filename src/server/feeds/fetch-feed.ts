import type { FeedSource } from "../../shared/types.js";

const MAX_FEED_BYTES = 1_000_000;
const FETCH_TIMEOUT_MS = 7_000;
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export class FeedFetchError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "FeedFetchError";
    this.status = status;
  }
}

export async function fetchFeedXml(source: FeedSource): Promise<{ xml: string; status: number }> {
  let current: URL;
  try {
    current = new URL(source.feedUrl);
  } catch {
    throw new FeedFetchError("Povezava vira ni veljavna.");
  }

  if ((current.protocol !== "https:" && current.protocol !== "http:") || current.username || current.password) {
    throw new FeedFetchError("Povezava vira ni varna.");
  }

  const initialHost = current.hostname.toLowerCase();
  const visited = new Set<string>();

  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    if (visited.has(current.href)) throw new FeedFetchError("Vira ni mogoče naložiti zaradi zanke preusmeritev.");
    visited.add(current.href);

    const response = await fetch(current, {
      headers: {
        accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
        "user-agent": "VeperNewsroom/0.1 (+public RSS/Atom reader)",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || redirects === MAX_REDIRECTS) throw new FeedFetchError("Vir je presegel dovoljeno število preusmeritev.", response.status);

      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new FeedFetchError("Vir je vrnil neveljavno preusmeritev.", response.status);
      }
      if (next.hostname.toLowerCase() !== initialHost || next.protocol !== current.protocol || next.username || next.password) {
        throw new FeedFetchError("Preusmeritev vira na drug naslov je zavrnjena.", response.status);
      }
      current = next;
      continue;
    }

    if (!response.ok) throw new FeedFetchError(`Vir je vrnil HTTP ${response.status}.`, response.status);
    const advertisedBytes = Number(response.headers.get("content-length"));
    if (Number.isFinite(advertisedBytes) && advertisedBytes > MAX_FEED_BYTES) {
      await response.body?.cancel();
      throw new FeedFetchError("Vir presega dovoljeno velikost 1 MB.", response.status);
    }

    if (!response.body) throw new FeedFetchError("Vir je vrnil prazen odgovor.", response.status);
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_FEED_BYTES) {
        await reader.cancel();
        throw new FeedFetchError("Vir presega dovoljeno velikost 1 MB.", response.status);
      }
      chunks.push(value);
    }

    const all = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      all.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { xml: new TextDecoder("utf-8", { fatal: true }).decode(all), status: response.status };
  }

  throw new FeedFetchError("Vira ni mogoče naložiti.");
}
