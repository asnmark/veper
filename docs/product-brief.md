# Veper product contract

## Editorial job

Help a Slovenian radio journalist answer four questions during a shift: What happened? Who else reports it? What changed, and where do accounts diverge? What is the next useful thing to verify or ask?

## Product rules

- Organize the desk around evolving stories and evidence, not a stream of AI-written headlines.
- Keep every original publisher, article URL, source publication time, capture time, and captured excerpt inspectable.
- Treat AI output as an editorial draft, never as a verified fact. Every factual sentence, comparison, and lead must cite an item and an exact excerpt captured from that public feed. Reject unmatched citations, then run a separate Gemini support review that must accept each claim; omit uncertain claims. This second model review reduces unsupported output but is not independent verification or proof.
- Label disagreements as leads to check, never as proven misinformation. Preserve both accounts and their dates.
- Never infer an event time from the capture time. Show the distinction when a feed omits its publication date.
- Do not scrape article bodies, defeat paywalls, or send more than the public feed title and short description to Gemini.
- Treat recognized empty feeds as healthy; reject unknown XML roots and malformed RSS/Atom/RDF entries and expose the parser error in source health.
- Do not invent live data, source confidence, virality, or precision scores. Empty, stale, failed, and AI-disabled states must be explicit.
- Do not offer a chatbot. Intelligence runs in bounded background jobs when new evidence changes a story.

## MVP workflow

1. Poll a small, vetted catalog of public RSS/Atom feeds and keep source health visible.
2. Normalize, deduplicate, and conservatively cluster article updates into stories; uncertain links stay separate.
3. Show the story's source-by-source timeline and excerpts side by side.
4. On changed stories, ask Gemini for bounded briefing points, source comparisons, story development, and newsroom follow-up questions. Skip model calls on unchanged evidence.
5. Validate each source ID and exact excerpt locally. Send only those citation-bound candidates to a second bounded Gemini review; store only claims the review explicitly accepts. The review receives the exact excerpts, source names, titles, and dates, not article URLs or full text.
6. Let the editor filter, search, inspect each source, and save a story for a shift handoff.

## Explicitly deferred

Paid feeds, full-text extraction, authentication/multi-tenant accounts, embeddings/vector search, external queues, automated publishing, email/SMS delivery, dashboards with synthetic charts, open-ended chat, and cross-language story matching without strong evidence.

## Acceptance bar

An end-to-end test must take two feed entries from different publishers through parsing, persistence, clustering, citation validation, support review, API retrieval, and an interactive browser dossier. Unknown XML roots or malformed entries must mark a source offline, while a recognized empty feed stays online. A mismatched quote or unknown item ID must never reach the desk; a candidate rejected by the support review must never be shown. A story evidence revision or analysis-policy version change invalidates prior analysis. The ordinary empty state must contain no sample news. Product copy must describe AI analysis as an editorial draft, not a verified fact.

## Cost and limits

- Each changed batch that produces citation-bound candidate claims uses one drafting call and one support-review call. Empty or fully rejected candidates are not retried until evidence changes; provider errors use bounded backoff.
- Gemini is fallible. The verifier is a second model pass, not an independent source or fact checker. Journalists must open and inspect original sources before broadcast.
- Conservative title clustering can miss translated or differently worded coverage; missed joins remain separate rather than fabricating a comparison.
