# Tasks: Force-Refresh on New Release + What's New Greeting

**Input**: Design documents from `specs/006-force-refresh-whats-new/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included (safety-critical funds app + strong repo test culture). Keep proportionate.

## Format: `[ID] [P?] [Story] Description`
- **[P]**: parallelizable (different files, no dependency)
- **[Story]**: US1 auto-refresh · US2 never-interrupt (safety) · US3 What's New · US4 enforcement

**Safety ordering (from plan.md)**: the auto-reload (US1) is ENABLED only after the US2 safety nets are built and verified. Version signal + safety primitives are foundational.

---

## Phase 1: Setup

- [ ] T001 [done] Feature branch `feature/006-force-refresh-whats-new` + `specs/006-*` artifacts.
- [ ] T002 Add `NEXT_PUBLIC_FORCE_REFRESH` flag (default `false`) to `apps/web/src/lib/env.ts` + `apps/web/.env.example`, so the auto-reload ships dark until Phase 7.

---

## Phase 2: Foundational (blocking prerequisites) ⚠️ before any story

- [ ] T003 [US1] `apps/web/next.config.ts` — compute `BUILD_ID = (SOURCE_COMMIT ?? 'dev') + '-' + <frozen ts>`; set `generateBuildId` + `env.NEXT_PUBLIC_BUILD_ID` (see research D1).
- [ ] T004 [P] [US1] `apps/web/src/app/api/version/route.ts` — `runtime='nodejs'`, `dynamic='force-dynamic'`, returns `{version: NEXT_PUBLIC_BUILD_ID}` `no-store` (contracts/api-version.md).
- [ ] T005 [US1] `apps/web/middleware.ts` — add `/api/version` to `ALLOW_EXACT` (gate-exempt JSON).
- [ ] T006 [P] [US1] `apps/web/src/lib/version.ts` — `useVersionCheck()`: poll 60 s + on focus, 2-read debounce, no-op on empty/non-200/non-JSON/equal (contracts/api-version.md).
- [ ] T007 [P] [US2] `apps/web/src/lib/ui/criticalOp.ts` — ref-counter (`useSyncExternalStore`), `beginCriticalOp`, `useCriticalOp`, `useHoldCriticalOp(active,severity)`; LOCKED/BUSY (data-model.md).
- [ ] T008 [P] [US1] `apps/web/src/lib/ui/chunkGuard.ts` — ChunkLoadError/`unhandledrejection` → guarded single reload (sessionStorage `sp-chunk-reload-at`, suppressed while LOCKED).
- [ ] T009 [US4] CI assert script: post-build check `GET /api/version === NEXT_PUBLIC_BUILD_ID`; wire into a lightweight web CI job.
- [ ] T010 [P] [test] Unit: version compare no-op matrix (empty/non-200/non-JSON/equal) + criticalOp counting (`apps/web/src/lib/**/*.test.ts`).

**Checkpoint**: release detection + safety primitives exist (reload still OFF).

---

## Phase 3: User Story 2 — A reload never interrupts money or work (P1) 🛡️ safety

**Goal**: pending reloads defer around funds/data-loss ops; exit/trust never reload. **Must be complete before US1 is enabled.**

- [ ] T011 [US2] `apps/web/src/components/shell/UpdateBanner.tsx` — consume `useCriticalOp`; pause the countdown while `locked>0||busy>0`; "we'll refresh when you're done" copy.
- [ ] T012 [US2] Same file — max-defer 10 min → manual Refresh; loop-breaker (~30 s, `sp-loopbreak-<id>`) → manual Refresh.
- [ ] T013 [US2] Same file — hard-exclude `/exit` + `/trust` from any reload; register `beforeunload` guard while LOCKED or dirty; preserve unsaved input.
- [ ] T014 [P] [US2] `apps/web/src/components/ui/ConfirmFlow.tsx` — `useHoldCriticalOp` LOCKED = `exec.isBusy || (txHash && stage∉{done,error})`.
- [ ] T015 [P] [US2] `apps/web/src/app/(app)/swap/page.tsx` — hold LOCKED during swap send/receipt.
- [ ] T016 [P] [US2] `apps/web/src/app/(app)/bridge/page.tsx` — hold LOCKED during write/hash.
- [ ] T017 [P] [US2] `apps/web/src/app/exit/page.tsx` — hold LOCKED during send/confirm (and page is reload-excluded).
- [ ] T018 [P] [US2] `apps/web/src/lib/auth/useSiwe.ts` — hold BUSY while SIWE pending.
- [ ] T019 [P] [US2] `apps/web/src/app/(app)/chat/page.tsx` — hold BUSY while streaming || draft non-empty.
- [ ] T020 [P] [US2] `apps/web/src/app/admin/knowledge/page.tsx` — hold BUSY while editor dirty.
- [ ] T021 [test] [US2] Playwright: reload deferred during a simulated LOCKED op; never fires on `/exit`; draft preserved.

**Checkpoint**: safety proven → US1 may be enabled.

---

## Phase 4: User Story 1 — Land on the newest release automatically (P1) 🎯 MVP

**Goal**: detect a new build and reload (60 s, non-cancellable), skippable via "Reload now".

- [ ] T022 [US1] `UpdateBanner.tsx` — detection via `useVersionCheck`; 60 s countdown + "Reload now"; info-register markup (Icon `refresh`, `.btn` classes); mount in `apps/web/src/components/providers.tsx` gated by `NEXT_PUBLIC_FORCE_REFRESH` (OFF).
- [ ] T023 [US1] `apps/web/src/app/globals.css` — `.updatebar` family in the info register (`--info`/`--info-subtle`), bottom-left, z-index 115, theme-aware, `prefers-reduced-motion` safe.
- [ ] T024 [test] [US1] Playwright (flag on in test): mismatch → banner → countdown → reload; "Reload now" skips the wait; no dismiss affordance.

**Checkpoint**: MVP — safe auto-refresh (still flag-gated for staged enable).

---

## Phase 5: User Story 3 — Know what changed, never blank (P2)

**Goal**: repo-file changelog + suppress-on-empty greeting.

- [ ] T025 [US3] `services/agent/migrations/0014_content_slug.sql` — add unique `slug` + backfill existing rows (apply `PGCLIENTENCODING=UTF8`).
- [ ] T026 [US3] `services/agent/src/sparkpoint_agent/db/content_entries.py` — upsert-by-slug (`ON CONFLICT (slug)`), honor `skip_sources`.
- [ ] T027 [P] [US3] `services/agent/content_seed/whats-new.yml` — backfill current live changelog rows (contracts/whats-new-yml.md).
- [ ] T028 [US3] `services/agent/src/sparkpoint_agent/api/main.py` lifespan boot loader (fail-open, next to `_warm_persona`) + `api/content.py` `POST /admin/content/reingest` (contracts/admin-content-reingest.md).
- [ ] T029 [US3] `services/agent/Dockerfile` — `COPY content_seed` (else prod ingests 0).
- [ ] T030 [P] [US3] `apps/web/src/components/shell/WhatsNewModal.tsx` — suppress-on-empty (open iff newCount>0); `useChangelog`; last-seen `sp-app-version-seen` (first-run silent); app-routes only; mount in `providers.tsx`.
- [ ] T031 [US3] Set one-shot `sp-whatsnew-pending` (sessionStorage) just before an update-driven reload so the greeting shows once on the fresh load.
- [ ] T032 [test] [US3] Agent pytest: reingest idempotency + skip_sources precedence; web: modal suppressed when 0 new / on error.

**Checkpoint**: greeting works and can never render blank.

---

## Phase 6: User Story 4 — No blank changelog / dead refresh can ship (P3)

**Goal**: enforcement binds the deploy.

- [ ] T033 [US4] `.github/workflows/changelog-required.yml` — run-always diff gate + `skip-changelog` escape hatch (contracts/changelog-required-ci.md).
- [ ] T034 [P] [US4] `.github/pull_request_template.md` — CHANGELOG.md + whats-new.yml checkboxes.
- [ ] T035 [US4] **Config-drift fix (operator-approved)**: restore playbook `oh-git-guard.sh` in `.claude/` (checks-gate on `gh pr merge`); switch `defaultMode` `bypassPermissions → auto`.
- [ ] T036 [P] [US4] `.claude/hooks/require-changelog.sh` — Stop/SubagentStop advisory (exit-2 if product code changed w/o a changelog).
- [ ] T037 [P] [US4] `.claude/commands/ship.md` — `/ship` release checklist (asserts both changelogs, typecheck/lint/build, never-Friday).
- [ ] T038 [US4] `.specify/templates/tasks-template.md` — standing DoD task "Update BOTH changelogs" so every future feature inherits it.

**Checkpoint**: a source-only PR goes red and cannot merge; escape hatch works.

---

## Phase 7: Enable + Polish + Docs

- [ ] T039 Enable `NEXT_PUBLIC_FORCE_REFRESH=true` on develop; verify quickstart §2–§5 end-to-end.
- [ ] T040 Deploy smoke-check script: `GET /content/changelog` active count == whats-new.yml active count; `GET /api/version` == baked id.
- [ ] T041 [P] Living docs: `COOLIFY.md` (build_command SHA + include-source-commit note), `DEPLOYMENT.md`, `docs/ops/known-limitations.md` (stale-client/ChunkLoadError), `apps/web/.env.example` + root `.env.example` (`NEXT_PUBLIC_BUILD_ID`, flag).
- [ ] T042 [P] Update BOTH changelogs for THIS feature: `CHANGELOG.md` `[Unreleased]` bullet + a `content_seed/whats-new.yml` client entry (dogfoods the gate).
- [ ] T043 `/code-review` + quickstart on develop; then **confirm with operator before** opening the PR to develop (never-Friday).

---

## Dependencies & parallelization

- **Phase 2 blocks all stories.** Within Phase 2, T004/T006/T007/T008/T010 are [P] (distinct files); T003→T005 touch config/middleware.
- **US2 (Phase 3) blocks enabling US1** (T039). The 7 flow-consumer holds (T014–T020) are [P].
- **US3** agent tasks (T025→T026→T028, T029) are sequential on the agent; T027/T030 are [P]. Migration (T025) precedes the boot loader (T028).
- **US4** T033/T034/T036/T037 are [P]; T035 (config-drift) is the binding step and pairs with T033.
- **MVP = Phase 2 + Phase 3 + Phase 4** (safe auto-refresh). US3 + US4 layer on.

## Definition of Done (inherited)
Both changelogs updated (or `skip-changelog` justified) · version id confirmed to change on deploy · refresh/greeting verified per quickstart · migrations apply (UTF8) + Dockerfile COPY present · CI green · never-Friday.
