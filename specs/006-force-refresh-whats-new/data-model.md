# Phase 1 — Data Model: Force-Refresh + What's New

## Release identity (build-time constant, not persisted)
- **Value**: `NEXT_PUBLIC_BUILD_ID` = `(SOURCE_COMMIT ?? 'dev') + '-' + BUILD_TIMESTAMP` (frozen once per build).
- **Producers**: `next.config.ts` (`generateBuildId` + inlined env).
- **Consumers**: the client bundle (its own id) and `GET /api/version` (the running server's id).
- **Rules**: non-empty and deterministic per build; changes on every real deploy; treated as opaque (string compare only). Empty/`'dev'`-only or `unknown` ⇒ client no-ops.

## Client changelog entry
- **Source of truth**: `services/agent/content_seed/whats-new.yml` (committed) → ingested into the `content_entries` table (agent Postgres).
- **Fields**: `slug` (stable unique key; NEW column), `type` = `changelog`, `tag` ∈ {New, Fixed, Improved, Announcement}, `title`, `body`, `cta_label?`, `cta_href?`, `published_at` (timestamptz; supports honest backdating), `is_active` (bool), `author` (`seed` | operator).
- **Rules**:
  - Upsert by `slug` (`ON CONFLICT (slug) DO UPDATE`) — re-ingest is idempotent (no duplicate rows).
  - `skip_sources` precedence: a slug an operator has hand-edited (Admin → Updates) is NOT overwritten by the shipped seed on re-ingest.
  - Curated client register — MUST NOT carry dev-only detail (file names, N1–N5, "requires redeploy").
- **Reads**: public `GET /content/changelog` (`WHERE type='changelog' AND is_active` ORDER BY `published_at` DESC) powers both `/changelog` and the greeting.
- **Migration**: `0014_content_slug.sql` — add `slug text`, backfill existing rows with a deterministic slug, add a UNIQUE constraint. Apply with `PGCLIENTENCODING=UTF8`.

## Last-seen marker (client, localStorage)
- **Key**: `sp-app-version-seen` via `useLocalState`.
- **Value**: the release id the user has been greeted for.
- **Rules**: initialized to the current release silently on first run (no greeting); the greeting opens only when the current release differs AND ≥1 changelog entry is newer than the marker's release/date; acknowledging ("Got it") sets it to the current release.
- **Related (session)**: `sp-whatsnew-pending` (sessionStorage one-shot) set just before an update-driven reload so the greeting shows once on the fresh load.

## Critical-op state (client, in-memory ref-counter)
- **Store**: `lib/ui/criticalOp.ts` — module-level `{ locked: number, busy: number }` via `useSyncExternalStore`.
- **Severities**:
  - **LOCKED** — a signature in progress, or a broadcast txHash without a terminal receipt (deposit/withdraw/swap/bridge/exit).
  - **BUSY** — chat streaming, an unsent draft, a dirty admin editor, SIWE pending.
- **Producers** (`useHoldCriticalOp`): `ConfirmFlow.tsx`, `swap`, `bridge`, `exit`, `useSiwe`, `chat`, `admin/knowledge`.
- **Consumer**: `UpdateBanner` — reload paused while `locked>0 || busy>0`; auto-reload fires only when both are 0; `beforeunload` guard active while `locked>0` or dirty.
- **Rules**: never observable on `/exit` or `/trust` in a way that permits reload (those pages are hard-excluded regardless of counters); 10-minute max-defer → manual Refresh.

## Reload/version session state (client, sessionStorage)
- `sp-chunk-reload-at` — timestamp guarding the ChunkLoadError backstop (skip if a reload happened < ~10 s ago).
- `sp-loopbreak-<id>` — records that a reload was attempted for a target id; if still mismatched after ~30 s, stop auto-reloading and show manual Refresh.
