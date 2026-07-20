# Implementation Plan: Force-Refresh on New Release + What's New Greeting

**Branch**: `006-force-refresh-whats-new` | **Date**: 2026-07-20 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/006-force-refresh-whats-new/spec.md`

## Summary

Give every open alpha session a way to notice a new deploy and reload onto it (60 s, non-cancellable), greet the user with what changed, and make it structurally hard for a future change to ship a blank changelog or a dead version signal — all without ever interrupting a signature, a broadcast transaction, or the withdraw/exit path.

**Technical approach**: a per-**build** release id (`SOURCE_COMMIT` + a build-frozen timestamp) is baked into the web bundle via `generateBuildId` + an inlined `NEXT_PUBLIC_BUILD_ID`; a same-origin, gate-exempt `GET /api/version` echoes that baked id (never recomputed). A dependency-free `useSyncExternalStore` "critical-op" ref-counter (LOCKED / BUSY) lets flow owners publish an in-flight signal that pauses the reload. A new global `UpdateBanner` (mounted in `providers.tsx`) polls `/api/version` (60 s + on focus), and a `WhatsNewModal` reads the in-app changelog and opens only when there is something new. The in-app changelog gains a committed source (`docs/whats-new.yml`) ingested at deploy (idempotent upsert via a new unique-slug column), so one edit feeds both changelogs and rides the PR diff — which a run-always CI gate then requires. Rollout is staged: version id + safety nets first (auto-reload OFF), then the changelog source + migration, then the CI gate + config-drift fixes, and the 60 s auto-reload last.

## Technical Context

**Language/Version**: TypeScript 5 / Next.js 16.2.9 (App Router) / React 19.2 (web); Python 3.12 / FastAPI (agent).

**Primary Dependencies** (existing, reused — no new runtime deps): `@tanstack/react-query`, `wagmi`/`viem`, `next-themes`, the in-house `Icon` (`lib/icons.tsx`), `useLocalState`, `OverlayProvider`, the `.btn`/token CSS in `globals.css`. Agent: `yoyo` migrations, `psycopg`, the existing content/tips/persona ingest utilities.

**Storage**: Postgres (agent) — existing `content_entries` table (migration 0011) gains a unique `slug` column; new committed `docs/whats-new.yml` seed source. Client: `localStorage` (last-seen marker via `useLocalState`), `sessionStorage` (loop-breaker + one-shot "greet after reload").

**Testing**: web `node --test` + Playwright (`e2e/`); agent `pytest` (ruff/mypy). New: CI workflow `changelog-required.yml`; a build-time invariant assert (`/api/version` === baked id).

**Target Platform**: Coolify (Nixpacks, `next start`) single-container develop; prod landing behind an nginx `ip_hash` LB (multi-replica) — hence the corroboration/debounce requirement.

**Project Type**: Web application (Next.js frontend + FastAPI agent) in a pnpm/turbo monorepo.

**Performance Goals**: detection within ~60 s of deploy; ≥95% of open sessions on the new build within 3 min (SC-001); poll is one lightweight `no-store` GET per tab per 60 s.

**Constraints**: MUST NOT interrupt signing / a broadcast-but-unconfirmed tx / the exit path (N2); no new UI framework — reuse SparkPoint tokens + primitives; both changelogs stay in sync (no-drift rule); enforcement targets GitHub Free (hook + check signal), not paid branch protection.

**Scale/Scope**: alpha (small closed tester set), single web container on develop; ~9 new files + ~10 edits across web + agent + CI + `.claude`/`.specify` (see Project Structure).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Assessment |
|---|---|
| **I. Non-Custodial by Construction (N1–N5)** | **PASS — and load-bearing.** This is a client-side refresh/UX feature; it adds **no** code path that moves funds, holds keys, or changes signing (N1/N3/N4/N5 untouched). **N2 (withdraw-always)** is actively protected: FR-009 forbids auto-reload on the exit/trust pages, FR-007 forbids reload during a broadcast-but-unconfirmed tx, and FR-011's max-defer never overrides the exit/trust rule. The reload gating is treated as safety-critical. |
| **II. AI Proposes, Policy + User Disposes** | **PASS — N/A to funds.** No agent output reaches the chain here. The only agent-side change is the changelog ingest (content rows), which is on the content path, never the policy/propose/build path. |
| **III. Provable, Not Promised** | **PASS.** No yield/return claims. The What's New feed shows only shipped, curated changes. |
| **IV. Security & Bounded Blast Radius** | **PASS.** New surface is one read-only `GET /api/version` (no secrets, no params) + a public content read that already exists. Worst case of a bug is a spurious/absent reload prompt, contained by the no-op-on-unknown + loop-breaker + suppress-on-empty safety nets. |
| **V. Conservative, Transparent Launch** | **PASS.** Adds no strategy, protocol, or token surface. |
| **VI. Spec-Driven Development** | **PASS.** This plan follows spec → plan → tasks; no code before the approved plan. |
| **VII. Simplicity & YAGNI** | **PASS.** No new runtime dependency (ref-counter via `useSyncExternalStore`, not zustand; CSS-class UI, not a component lib). Scope is bounded to alpha + Base/develop; no multi-network, no service worker. |

**Gate result: PASS. No violations → Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```text
specs/006-force-refresh-whats-new/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions (version id, endpoint, criticalOp, ingest, CI)
├── data-model.md        # Phase 1 — entities (release id, changelog entry, last-seen, critical-op)
├── quickstart.md        # Phase 1 — end-to-end validation guide
├── contracts/
│   ├── api-version.md            # GET /api/version response contract
│   ├── whats-new-yml.md          # docs/whats-new.yml schema
│   ├── admin-content-reingest.md # POST /admin/content/reingest contract
│   └── changelog-required-ci.md  # the pre-merge gate contract
└── checklists/requirements.md    # spec quality checklist (done)
```

### Source Code (repository root)

```text
apps/web/
├── next.config.ts                         # EDIT — bake BUILD_ID → generateBuildId + NEXT_PUBLIC_BUILD_ID
├── middleware.ts                          # EDIT — add /api/version to ALLOW_EXACT (gate-exempt)
└── src/
    ├── app/api/version/route.ts           # NEW — echoes baked id (nodejs, force-dynamic, no-store)
    ├── components/
    │   ├── providers.tsx                  # EDIT — mount <UpdateBanner/> + <WhatsNewModal/>
    │   └── shell/
    │       ├── UpdateBanner.tsx           # NEW — poll + 60s countdown + pause + loop-breaker
    │       └── WhatsNewModal.tsx          # NEW — suppress-on-empty greeting from useChangelog
    ├── lib/
    │   ├── version.ts                     # NEW — useVersionCheck() (60s + focus, debounced, no-op-on-unknown)
    │   └── ui/
    │       ├── criticalOp.ts              # NEW — ref-counted LOCKED/BUSY store (useSyncExternalStore)
    │       └── chunkGuard.ts              # NEW — ChunkLoadError → guarded single reload
    ├── app/globals.css                    # EDIT — .updatebar + .whatsnew (info register)
    └── (flow consumers, EDIT — publish holds): components/ui/ConfirmFlow.tsx,
        app/(app)/swap/page.tsx, app/(app)/bridge/page.tsx, app/exit/page.tsx,
        lib/auth/useSiwe.ts, app/(app)/chat/page.tsx, app/admin/knowledge/page.tsx

services/agent/
├── migrations/0014_content_slug.sql       # NEW — unique slug col + backfill + ON CONFLICT support
├── content_seed/whats-new.yml             # NEW — committed client changelog source (backfill live rows)
├── Dockerfile                             # EDIT — COPY content_seed (else prod ingests 0)
└── src/sparkpoint_agent/
    ├── api/main.py                         # EDIT — boot loader in lifespan (fail-open), next to _warm_persona
    ├── api/content.py                      # EDIT — POST /admin/content/reingest (mirror tips reingest)
    └── db/content_entries.py               # EDIT — upsert-by-slug (ON CONFLICT), list respects skip

.github/workflows/changelog-required.yml    # NEW — run-always diff gate (CHANGELOG.md + whats-new.yml)
.github/pull_request_template.md            # NEW — changelog checkboxes
.claude/                                     # EDIT (rollout step 6) — restore oh-git-guard.sh; defaultMode auto
.claude/commands/ship.md                     # NEW — /ship release checklist (advisory)
.claude/hooks/require-changelog.sh           # NEW — Stop/SubagentStop advisory hook
.specify/templates/tasks-template.md         # EDIT — standing DoD task (update BOTH changelogs)
```

**Structure Decision**: Web application (Option 2). Frontend changes live in `apps/web/src` reusing the existing shell/lib layout and CSS-class UI system; agent changes live in `services/agent` reusing the tips/persona seed-ingest pattern; enforcement lives in `.github/`, `.claude/`, and `.specify/`. No new top-level project.

## Complexity Tracking

> No Constitution Check violations — this section is intentionally empty.

## Phased delivery (maps to tasks.md milestones)

1. **Version id + endpoint (auto-reload OFF)** — `next.config.ts`, `app/api/version/route.ts`, `middleware.ts`, `lib/version.ts`; CI assert `/api/version === baked id`.
2. **UI safety nets (flagged)** — `criticalOp.ts`, `chunkGuard.ts`, `UpdateBanner.tsx` (banner + pause + loop-breaker + max-defer 10 min), `WhatsNewModal.tsx` (suppress-on-empty), wire the 7 flow consumers, `globals.css`, mount in `providers.tsx`.
3. **Repo-file changelog** — `0014_content_slug.sql`, `content_seed/whats-new.yml` (backfill), boot loader + `/admin/content/reingest`, upsert-by-slug, Dockerfile COPY.
4. **Blocking gate** — `changelog-required.yml`, PR template.
5. **Make it bind (config-drift fix, approved)** — restore `oh-git-guard.sh`, `defaultMode → auto`.
6. **Advisory scaffolding** — `/ship`, `require-changelog.sh`, DoD in tasks-template, git-cliff draft (optional).
7. **Enable** — flip the 60 s auto-reload on; add the deploy smoke check; update living docs + BOTH changelogs; verify end-to-end on develop first.

See [research.md](./research.md) for the decisions behind each, [data-model.md](./data-model.md) for entities, [contracts/](./contracts/) for interfaces, and [quickstart.md](./quickstart.md) for validation.
