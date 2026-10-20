# Agent guide

## Product contract
- Veper is a source-grounded Slovenian radio newsroom desk, not a generated news feed.
- Never fabricate articles, publishers, dates, quotes, source counts or live state.
- Preserve the publisher URL and show whether a time is publisher-provided or capture time.
- AI runs in the background only. Each claim must cite an exact stored title/excerpt and link to its source, then pass a second Gemini support review before display. The UI must call these editor drafts, never verified facts; the second model is fallible and the journalist must inspect the source.
- A contradiction needs mutually exclusive claims from different publishers; emphasis differences remain differences.
- Failed feeds never erase previously stored evidence. Missing Gemini is an explicit product state.
- A valid empty RSS/Atom/RDF document is healthy; unknown roots or non-object feed entries are parse failures, not successful empty feeds.
- User-facing copy must be Slovenian. Code, tests and agent documentation may be English.

## Architecture
- `src/server/feeds`: bounded RSS/Atom fetching and parsing.
- `src/server/db.ts`: SQLite persistence, deduplication, revisions, recent-desk window.
- `src/server/stories.ts`: conservative title matching; do not loosen without false-positive tests.
- `src/server/intelligence`: bounded Gemini drafting, exact citation validation, fail-closed support review.
- `src/server/newsroom.ts`: polling, policy-versioned analysis, retry/backoff and desk events.
- `src/server/app.ts`: Fastify HTTP/SSE API; subscribe cleanup follows the SSE response lifetime; `main.ts` is the runnable server.
- `src/client`: React/Vite newsroom UI. `src/shared/types.ts` is the API contract.

## Commands
- `npm ci`
- `npm run dev` (local API + Vite)
- `npm test` (unit and API integration)
- `npm run test:e2e` (Chromium browser workflow)
- `npm run typecheck`
- `npm run build && npm start` (production server)
- `npm run check` runs the validation suite.

## Change protocol
- Add/adjust a failing regression test before behavior changes.
- Prefer built-in APIs and existing dependencies. Keep SQLite single-process.
- No scraped article bodies, external AI provider abstraction, vector database or fake seed dataset.
- Exercise failure, duplicate, stale and empty states. Inspect desktop and 390px mobile screenshots after UI changes.
- Keep tests deterministic and network-independent; live public feeds are smoke-checked separately and may be blocked by the environment.
