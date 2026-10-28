# Spec 061 — A9 UX quick fixes (beta audit)

**Status:** implemented · **Owner:** build · **Branch:** `feat/061-ux-quick-fixes`
**Source findings:** `~/sparkpoint-audit/run/crawl-results.{json,md}` — 70× `400 /api/agent/brokers/owned`,
14× `404 /api/agent/recommendations`, `/vault` never reaching network idle (30s crawl idle), mobile
console noise, and the UX review items A9.

## Why

The crawl and the audit found a set of small, high-friction defects. None is a custody issue; each
is the kind of thing that makes a beta feel unfinished: a modal that blocks the app, a nav entry
that leads nowhere, requests that paint the console red, a page that polls forever, a phone header
that crowds, a chat that can stall without a way forward, a quota dead-end, and thumbs that do not
persist.

## User stories & acceptance criteria

### US1 — What's New does not block the app
1. The greeting is a dismissible corner panel; there is no full-screen scrim and the page behind it
   stays interactive.
2. It appears at most once per release: the newest entry's **slug** is stored in localStorage and
   an acknowledged release never reappears (including after a re-seed that renumbers ids).
3. A first-time visitor still gets a bounded welcome (≤4 entries), never the whole backlog.
4. The stale `broker-mint-whitelist-2026-10` seed entry is pruned (seed ingest prunes seed-owned
   rows).

### US2 — `/brokers/owned` never reports a wallet's collection as broken
1. A missing/unsupported chain identity returns **200** `{available:false, reason:"no-account"}`,
   never a 400; authentication is unchanged.
2. The browser sends `X-Chain-Id`, so the normal path is scoped and succeeds.
3. An unreadable chain still returns `available:false` (never an empty list).

### US3 — Recommendations do not 404
1. No recommendation request is made without a mandate (the agent correctly answers 404 there).
2. A race/404 is treated as an empty state, not a failed live surface.

### US4 — Vault polling is sane
1. Vault reads poll every 60s, not every few seconds.
2. No background polling; window focus refreshes.
3. Failures back off exponentially and stop after 5 consecutive failures; manual refetch works.

### US5 — Strategies nav reflects reality
1. When a mandate ranks zero strategies, Strategies is hidden in the desktop and mobile primary
   nav. It stays reachable by URL and in ⌘K.
2. Unknown/loading/error states keep it visible (never bury a page on a guess).

### US6 — Mobile header and trust banner
1. At 390px the header shows the mark, notifications and account; address/network/self-custody/stage
   pills collapse into the existing menus; no horizontal overflow.
2. The trust banner has a dismiss control; dismissal persists across reloads.

### US7 — Slow chat and retry
1. After ~8s with no first content the waiting row says "Sparky is taking longer than usual…".
2. The BFF chat proxy has a 60s deadline and closes the stream with a clean `error` block instead of
   hanging.
3. The existing Retry action resends the last message; agent refund semantics mean a failed turn
   does not double-charge.
4. Compatible with 059 streaming deltas without touching its reducer.

### US8 — Dead-end quota/error copy
1. A rate-limit response says when the allowance resets and what still works without Sparky
   (Vault, Swap, Portfolio, `/changelog`).
2. Internal/transport failures keep their honest copy and add the same escape routes.

### US9 — Thumbs feedback persists
1. A finished live answer offers thumbs up/down; the rating is POSTed to `/chat/feedback`.
2. The agent stores `(owner, conversation, message, rating, optional reason)` in migration 0043.
3. Idempotent per user+message: repeat taps update one row.
4. The write is fail-open; a DB problem never fails the tap.

## Non-goals

- No custody, signing, policy or model/billing changes.
- No new chat block type or 059 reducer rewrite.
- No design-system rework; phone fixes are layout/collapse only.

## Success signals

- Agent: ruff, strict mypy, pytest (incl. brokers, feedback, seed) green.
- Web: lint, typecheck, unit tests, build, and the new Playwright specs green locally/mocked.
- Both changelogs updated; the in-app entry is backdated UTC.
