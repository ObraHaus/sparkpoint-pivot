# Phase 0 — Research & Decisions: Force-Refresh + What's New

All decisions below were validated against the current codebase (Next 16 App Router, no baked build id today; Coolify Nixpacks single-container develop; agent `content_entries` from migration 0011; tips/persona seed-ingest patterns).

## D1 — Release identity: per-build, automatic
- **Decision**: `BUILD_ID = (SOURCE_COMMIT ?? 'dev') + '-' + BUILD_TIMESTAMP`, where `BUILD_TIMESTAMP` is evaluated **once** at build in `next.config.ts` and frozen. Fed to `generateBuildId()` **and** inlined as `NEXT_PUBLIC_BUILD_ID`.
- **Rationale**: deletes "forgot to bump the version" — nothing manual. The frozen timestamp guarantees the id changes on **every real deploy**, including a config/dependency-only redeploy where the commit SHA is unchanged. Tying `generateBuildId` to it also moves the chunk build id with the version.
- **Alternatives rejected**: pure git SHA (misses same-commit redeploys → stale clients); `package.json` version (manual bump, the exact thing we're eliminating); Next default random buildId (not exposed to the client).

## D2 — Server report: `GET /api/version`, gate-exempt, never recomputed
- **Decision**: a `nodejs` + `force-dynamic` route returning `{ version: NEXT_PUBLIC_BUILD_ID }` with `Cache-Control: no-store`; add `/api/version` to `middleware.ts` `ALLOW_EXACT`.
- **Rationale**: the client can only know its own build; the running server must report **its** id. Echoing the baked constant (never `Date.now()` per request) guarantees client and server agree per container, so a mismatch means only "a newer container is live." Gate-exemption is required because the fail-closed `SITE_LOCKED` middleware 307s everything else to `/coming-soon` (would return HTML, not JSON).
- **Alternatives rejected**: recompute per request (permanent mismatch → reload loop → bricked); a response header on every route via middleware (more invasive, header/inline drift); reading `.next/BUILD_ID` at request (works but the env echo is simpler and identical).

## D3 — Coolify SOURCE_COMMIT wiring
- **Decision**: expose the commit to the build via the **`build_command`** (`export SPARKPOINT_BUILD_ID=$(git rev-parse --short=8 HEAD 2>/dev/null); pnpm --filter @sparkpoint/web build`), OR the operator's UI toggle *Advanced → Include Source Commit in Build*. Code reads `SPARKPOINT_BUILD_ID || SOURCE_COMMIT || <frozen timestamp>`.
- **Rationale**: investigated — Coolify `4.0.0-beta.434` **rejects** `include_source_commit_in_build` on the API (`422`), and `SOURCE_COMMIT` is excluded from builds by default. The `build_command` field IS API-settable and `.git` is present in the Nixpacks context (base_directory `/`). The frozen-timestamp fallback means the refresh arms even if neither is wired.
- **Alternatives rejected**: API toggle (not accepted by this beta); static Coolify build-env id (wouldn't change per deploy).

## D4 — Critical-op signal: dependency-free ref-counter
- **Decision**: `lib/ui/criticalOp.ts` — module-level counters + `useSyncExternalStore` (same pattern as `useLocalState`), exposing `beginCriticalOp(severity)`, `useCriticalOp()`, and an effect hook `useHoldCriticalOp(active, severity)`. Two severities: **LOCKED** (tx approve/execute, or a txHash without a terminal receipt) and **BUSY** (chat streaming, unsent draft, dirty admin editor, SIWE pending).
- **Rationale**: no global "op in flight" state exists today (every busy flag is local `useState`); the banner mounts outside those components and needs a signal to read. `useSyncExternalStore` avoids a new dependency (zustand is not installed).
- **Alternatives rejected**: zustand (new dep); React context threaded through every flow (invasive, re-render churn); reading each hook's state (not lifted).

## D5 — Reload behavior: 60 s non-cancellable, pause-aware, loop-broken
- **Decision**: on a corroborated mismatch, show a persistent bottom-left info-register banner; count down 60 s then `location.reload()`. `Reload now` skips the wait; there is no dismiss. Countdown **pauses** while LOCKED/BUSY and resumes when idle, with a **10-minute** max-defer → manual Refresh fallback (never overriding the exit/trust rule). A **loop-breaker** (sessionStorage-stamped) stops after a reload that doesn't clear the mismatch and shows a manual Refresh. A `beforeunload` guard warns while LOCKED or dirty. A ChunkLoadError listener hard-reloads once (loop-guarded, suppressed while LOCKED) as an independent backstop.
- **Rationale**: operator decision (non-cancellable) balanced against funds safety (N2) and the reload-loop bricking risk.
- **Alternatives rejected**: user-cancellable banner (stragglers linger); naive `location.reload()` on detect (double-spend window); no loop-breaker (a bad `/api/version` bricks the app).

## D6 — In-app changelog from a committed repo file
- **Decision**: add `services/agent/content_seed/whats-new.yml` (entries: `slug`, `tag` New|Fixed|Improved|Announcement, `title`, `body`, `cta_label?`, `cta_href?`, `published_at`, `active`), ingested at boot in the FastAPI `lifespan` (fail-open, next to `_warm_persona`) plus `POST /admin/content/reingest`. Add migration `0014_content_slug.sql` (unique `slug` column + backfill) and upsert-by-slug in `db/content_entries.py`; reuse `skip_sources` precedence so a live Admin → Updates edit wins.
- **Rationale**: makes the client changelog a tracked artifact that rides the PR diff (so CI can require it) and feeds both surfaces from one edit. Mirrors the existing tips (`/admin/tips/reingest`) and persona (boot loader) patterns. The slug + `ON CONFLICT` prevents duplicate rows on every deploy (today's bigserial id would duplicate).
- **Alternatives rejected**: keep admin-DB-only (invisible to CI, the drift source); mirror `CHANGELOG.md` verbatim (leaks dev detail to testers); re-run the 0011 seed (yoyo runs once, never re-applies).

## D7 — Enforcement: run-always CI gate + hook binding (GitHub Free)
- **Decision**: `.github/workflows/changelog-required.yml` — `pull_request: [develop]`, **no paths filter** (a path-skipped required check stays perpetually pending), computes the diff internally: if `apps/web/src` or `services/agent/src` changed but neither `CHANGELOG.md` (real `## [Unreleased]` added lines) nor `content_seed/whats-new.yml` changed → fail; `skip-changelog` label escape hatch. Restore the playbook `oh-git-guard.sh` (runs `gh pr checks` before `gh pr merge`, check-name-agnostic) and switch `defaultMode` `bypassPermissions → auto`. Advisory: `require-changelog.sh` Stop-hook, `/ship` command, DoD in `tasks-template.md`, PR template.
- **Rationale**: merge to develop = the Coolify deploy, so gating the merge gates the deploy. On Free there is no server-side required-check, so the hook is the binding mechanism for agent-driven merges; the CI signal + PR template cover human review. Operator chose Free (no paid branch protection).
- **Alternatives rejected**: paid branch protection (declined for now); relying on CLAUDE.md prose alone (the ~80% forget rate this feature exists to fix).

## D8 — What's New audience & first-run
- **Decision**: greeting shows only to authenticated app-group users (the changelog is beta-gated). A first-time user (no last-seen marker) has the marker set to the current release silently — no backlog dump. Returning users see one consolidated greeting for everything since their last-seen release.
- **Rationale**: anonymous/landing users can't reach `/changelog`; new users shouldn't be greeted with history they never missed.
- **Alternatives rejected**: greet everyone (blank for anon; overwhelming for new users).
