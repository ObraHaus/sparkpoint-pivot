# Tasks: P0 Alpha Fixes (015)

**Input**: [spec.md](./spec.md) · [plan.md](./plan.md) · per-fix investigation specs (scratchpad `p0specs/`)
**Scope**: `apps/web` only. No agent / contract / DB / migration change.
**Format**: `[ID] [P?] [Story] Description` — `[P]` = parallelizable (different files, no dep).

## Definition of Done (every SparkPoint feature — feature 006)

- [ ] `CHANGELOG.md` — dev bullets under `## [Unreleased]` for each fix (behavior change).
- [ ] `services/agent/content_seed/whats-new.json` — client-facing entries for the user-visible changes (stable slugs).
- [ ] Version id automatic; no migrations in this feature; no new agent seed dirs.
- [ ] `changelog-required` CI green; `pnpm --filter web test` + `build` green; agent `ruff`/`mypy`/`pytest` green (no server change, re-confirm the contracts).

## Phase 1: Setup

- [ ] T001 Confirm branch `feat/015-p0-alpha-fixes` off latest `develop`; `pnpm install --frozen-lockfile` clean.

## Phase 2: US1 — Onboarding saves the real mandate (P1) 🎯

- [ ] T010 [US1] NEW `apps/web/src/lib/agent/mandateDraft.ts` — pure `buildMandateDraft(answers)`; fix `riskProfile` enum (`aggressive`→`growth`) + goal-kind ordering (aggressive before grow).
- [ ] T011 [P][US1] NEW `apps/web/src/lib/agent/mandateDraft.test.ts` — tier→profile, goal-kind, horizon buckets, all-tiers-server-valid.
- [ ] T012 [US1] EDIT `apps/web/src/app/onboarding/page.tsx` — import the extracted builder; delete local copy; add `saveState`; rewrite `confirmPlan` to persist the LOCAL draft, awaited, success/error UI; thread `saveState` into `renderDock` case 6; derive step-8 copy from answers.
- [ ] T013 [US1] EDIT `apps/web/src/lib/agent/useAgent.ts` — after a successful `confirmMandate`, invalidate `["agent","mandate"]` (instant reflect for US2).

## Phase 3: US2 — Surface the real mandate (P1)

- [ ] T020 [US2] NEW `apps/web/src/lib/agent/mandate.ts` — pure `mandateView`/`timelineLabel`/`mandateDrift` + types.
- [ ] T021 [P][US2] NEW `apps/web/src/lib/agent/mandate.test.ts` — wire→view map, timeline buckets, drift.
- [ ] T022 [US2] EDIT `apps/web/src/lib/agent/useAgent.ts` — add `useMandate()` (GET `/mandate`, honest states) + re-export `mandateDrift`.
- [ ] T023 [P][US2] EDIT `apps/web/src/app/(app)/settings/page.tsx` — replace the mock mandate tab with `<MandateTab/>` driven by `useMandate` (+ Max slippage row).
- [ ] T024 [P][US2] EDIT `apps/web/src/app/(app)/chat/page.tsx` — rail "Your mandate" card reads `useMandate` with connect/loading/empty fallbacks.
- [ ] T025 [P][US2] EDIT `apps/web/src/app/(app)/portfolio/page.tsx` — "Drift vs your plan" computes real drift via `mandateDrift`.

## Phase 4: US3 — Rec rationale + citations (P1)

- [ ] T030 [US3] NEW `apps/web/src/lib/agent/recView.ts` — `RecommendationDto`(+citations), `RecCitation`, `RecView`(+citations), `parseCitations`, `toRecView`.
- [ ] T031 [P][US3] NEW `apps/web/src/lib/agent/recView.test.ts` — toRecView map + parseCitations fail-closed.
- [ ] T032 [US3] EDIT `apps/web/src/lib/agent/useAgent.ts` — import from `recView`; delete inline DTO/View; re-export; map via `toRecView`.
- [ ] T033 [US3] EDIT `apps/web/src/app/(app)/strategies/page.tsx` — `MOCK_RECS` citations `[]`; fix `usingMock` → `=== null`; citation chip; live rationale + sources in the expander (mock copy preserved).

## Phase 5: US4 — Deposit fee disclosure + receipt line (P1)

- [ ] T040 [US4] NEW `apps/web/src/lib/policy/feeCopy.ts` — canonical `PERFORMANCE_FEE_DISCLOSURE` (dependency-free).
- [ ] T041 [P][US4] NEW `apps/web/src/lib/policy/feeCopy.test.ts` — lock the verbatim string.
- [ ] T042 [US4] EDIT `apps/web/src/components/NonCustodyBadge.tsx` — import + re-export the constant from `feeCopy`.
- [ ] T043 [US4] EDIT `apps/web/src/lib/chain/vaultConfirmModel.ts` — add `managementFeeRow` + `withdrawFeeNote` (live-% keyed; wrapper mentions curator fee).
- [ ] T044 [P][US4] EDIT `apps/web/src/lib/chain/vaultConfirmModel.test.ts` — assert the two new fields (launch + wrapper).
- [ ] T045 [US4] EDIT `apps/web/src/components/ui/ConfirmFlow.tsx` — add optional `disclosure` (deposit reveal) + `receiptFeeLine` (withdraw receipt) fields + render.
- [ ] T046 [US4] EDIT `apps/web/src/lib/chain/useVaultConfirm.tsx` — insert `m.managementFeeRow`; set `disclosure` (deposit) + `receiptFeeLine` (withdraw).

## Phase 6: US5 — Live CapRegistry caps meter (P2)

- [ ] T050 [US5] NEW `apps/web/src/lib/policy/liveCaps.ts` — `TvlCapKey`, `LiveVaultCaps`, `liveCapRawFor`, `effectiveCapRaw`.
- [ ] T051 [P][US5] NEW `apps/web/src/lib/policy/liveCaps.test.ts` — key mapping + live-preferred + per-cap fallback.
- [ ] T052 [US5] EDIT `apps/web/src/lib/chain/useVault.ts` — `capRegistryAbi` import + `capRegistryAddressFor` + `capReads` batch (excluded from aggregate) + expose `perUserCap/totalCap/vaultCap` + `refetch`.
- [ ] T053 [P][US5] EDIT `apps/web/src/app/(app)/vault/page.tsx` — `capRaw = v.perUserCap ?? perUserCapRaw(...)`.
- [ ] T054 [P][US5] EDIT `apps/web/src/lib/chain/useVaultConfirm.tsx` — `capRaw = v.perUserCap ?? perUserCapRaw(...)`.
- [ ] T055 [US5] EDIT `apps/web/src/components/CapsMeter.tsx` — `liveCaps` prop; prefer live per meter; `TvlCapKey` from `liveCaps`.
- [ ] T056 [US5] EDIT `apps/web/src/components/NonCustodyBadge.tsx` — pass `liveCaps={{perUserCap,totalCap,vaultCap}}` to `CapsMeter`.

## Phase 7: US6 — Standalone /confirm runs the real gate (P2)

- [ ] T060 [US6] NEW `apps/web/src/lib/chain/confirmParams.ts` — pure `parseConfirmParams` (`?assets=/?shares=/?vault=`, fail-safe).
- [ ] T061 [P][US6] NEW `apps/web/src/lib/chain/confirmParams.test.ts` — base-unit parse, shares+vault passthrough, fail-safe cases.
- [ ] T062 [US6] NEW `apps/web/src/app/(app)/confirm/[intent]/RouteConfirm.tsx` — thread amount → `useVaultConfirm` → real gate; beta-gate deposit; live amount-entry fallback; placeholder for swap/premium/bridge.
- [ ] T063 [US6] EDIT `apps/web/src/app/(app)/confirm/[intent]/page.tsx` — resolve intent, delegate to `<RouteConfirm>` inside `<Suspense>`.

## Phase 8: Validation & housekeeping

- [ ] T070 Run `pnpm --filter web test` (new units green) + `pnpm --filter web build` (tsc + next build clean).
- [ ] T071 Run agent `ruff` + `mypy` + `pytest services/agent/tests/api/test_mandate.py services/agent/tests/coordinator/test_onboarding.py services/agent/tests/api/test_recommendations*.py` to re-confirm the depended-on contracts are green.
- [ ] T072 `CHANGELOG.md` `## [Unreleased]` bullets + `services/agent/content_seed/whats-new.json` client entries (stable slugs) for the user-visible fixes.
- [ ] T073 Update `DEVELOPMENT.md`/`DEPLOYMENT.md` only if a new env/behavior is introduced (none expected; the operator env toggles go in this feature's go-live notes).
- [ ] T074 Commit per phase (Conventional Commits + Opus trailer); push; open PR → `develop` with validation evidence.

## Dependencies & Execution Order

- Phases 2–7 are largely independent (different files) **except** `useAgent.ts` (T013/T022/T032) and `useVaultConfirm.tsx` (T046/T054) — sequence those edits within their file. Implement per phase, run its unit test, commit.
- T070–T071 after all phases. T072–T074 last.

## Parallel Opportunities

- All `*.test.ts` (T011, T021, T031, T041, T051, T061) and the pure `lib/` modules can be authored in parallel.
- Page edits that touch distinct files (T023/T024/T025, T053) are `[P]`.
