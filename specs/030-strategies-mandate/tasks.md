# Tasks — 030 strategies & mandate that mean something

**Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Research**: [research.md](./research.md)

Tests are written alongside, per this repo's convention: every honesty rule lands in a leaf module
tested without a browser, pinned with the verbatim string or figure observed live.

## Phase 1: Foundation — candidates that exist, and a gate that can bite

- [x] T001 `services/agent/src/sparkpoint_agent/agents/recommender.py` — give `_YIELD_STRATEGIES` a per-strategy `RiskProfile`; `build_action` takes `risk_class` as a parameter distinct from the user's mandate profile (R2).
- [x] T002 `services/agent/tests/policy/test_risk_class_parity.py` — verdict, reason codes and full check trace byte-identical before/after for both strategies × all three mandate profiles; plus a synthetic over-risk action that now REJECTS where it previously could not (proves the tautology is gone).
- [x] T003 `services/agent/src/sparkpoint_agent/api/recommendations.py` — `_build_chain_context` resolves `aave_v3_pool` from `config.aave_pool_address` (R1).
- [x] T004 [P] `services/agent/tests/api/test_recommendations.py` — two candidates on a chain with both configured; exactly one when the pool address is absent (the 46630 case), with no error.

## Phase 2: User Story 1 — a real choice between real options (P1)

- [x] T005 `services/agent/src/sparkpoint_agent/api/recommendations.py` + `coordinator/chat_blocks.py` — carry `riskTier`, `feeStance`, `managedBy` on the recommendation wire (data-model.md).
- [x] T006 [P] `apps/web/src/lib/strategy/projection.ts` — NEW leaf: projected annual earnings from balance × net rate in exact integer arithmetic, the idle baseline, and honest absence when either input is missing (R4).
- [x] T007 [P] `apps/web/src/lib/strategy/projection.test.ts` — $1,503.26 at 0.40% ⇒ "$6.01"; no balance ⇒ "—" not "$0.00"; no rate ⇒ no projection; never a float.
- [x] T008 `apps/web/src/app/(app)/strategies/page.tsx` — render both cards with fee stance and who manages the position; money framing next to the idle baseline; the testnet-rates note.
- [x] T009 `apps/web/src/app/(app)/strategies/page.tsx` — "Review this move" carries the amount AND the recommendation id into `/confirm/deposit` (FR-009).
- [x] T010 [P] `apps/web/src/app/(app)/confirm/[intent]/RouteConfirm.tsx` — accept and thread the recommendation id so the built transaction stays attributable.
- [x] T011 [P] `apps/web/src/lib/agent/recView.test.ts` — a single-strategy chain still renders without phantom ranking; two strategies rank 1 and 2.

## Phase 3: User Story 2 — the screen tells the truth about my plan (P1)

- [x] T012 `apps/web/src/lib/agent/recView.ts` — `risk` from the strategy's own tier; `fit` derived from the saved mandate (FR-006, FR-007).
- [x] T013 [P] `apps/web/src/lib/agent/recView.test.ts` — a growth mandate is never told "lower risk, steady yield"; the fit line changes when the mandate changes; the risk badge follows the strategy.
- [x] T014 [P] `apps/web/src/components/screens/chat/live-blocks.tsx` — the chat recommendation card reads the block's risk tier instead of `tier={1}`.
- [x] T015 `apps/web/src/lib/agent/mandate.ts` — `mandateDrift` gains `below_plan` (R7), with copy that observes rather than urges.
- [x] T016 [P] `apps/web/src/lib/agent/mandate.test.ts` — growth mandate + tier-1 holdings ⇒ `below_plan`; conservative + tier-1 ⇒ `on_plan`; unknown inputs ⇒ `unknown`; below-plan copy never suggests taking more risk.
- [x] T017 [P] `services/agent/src/sparkpoint_agent/agents/recommender.py` — widen `_AGGRESSIVE_RE` to `leverag(?:e|ed|ing)` + the observed phrasing; test with the verbatim live rationale (R9).

## Phase 4: User Story 3 — a plan I can state, and change (P1)

- [x] T018 `services/agent/migrations/0033_mandate_goal_and_limits.py` — additive nullable columns per data-model.md; MIGRATIONS.md entry.
- [x] T019 `services/agent/src/sparkpoint_agent/db/mandates.py` — persist and read the new fields; `ensure_ascii=False` on both jsonb writes; `UndefinedColumnError` degrades to pre-030 behaviour with a once-per-process warning.
- [x] T020 `services/agent/src/sparkpoint_agent/api/mandate.py` — accept the new fields; reject a target-seeking goal missing amount or date (FR-011); percent-form exposure with no wallet value is *not stated*, never resolved against a guess.
- [x] T021 [P] `services/agent/tests/api/test_mandate.py` — round-trip all four; a legacy mandate with none of them still loads and behaves as pre-030; a half-specified goal is refused.
- [x] T022 `apps/web/src/lib/agent/mandateDraft.ts` — carry the new fields; persist the chosen 1..5 tier alongside the profile (R6).
- [x] T023 `apps/web/src/app/onboarding/page.tsx` — ask for the exposure limit, and for the target amount + date when the goal is target-seeking; contribution intent phrased so it can never read as automatic (FR-013).
- [x] T024 `apps/web/src/app/(app)/settings/page.tsx` — `MandateTab` becomes per-field editable; saving one field never re-asks the others (FR-014).
- [x] T025 [P] `apps/web/src/lib/agent/mandate.ts` — one risk scale end to end; the summary is derived at display time so legacy self-contradictory strings stop being authoritative (R6, FR-016).
- [x] T026 [P] `apps/web/src/lib/agent/mandate.test.ts` — mandate v6's exact stored string no longer reaches the screen; tier round-trips 1..5; a growth plan never renders "capital-preservation-first".

## Phase 5: User Story 4 — progress toward what I'm saving for (P2)

- [x] T027 [P] `apps/web/src/lib/goal/progress.ts` — NEW leaf: share of target, time remaining, on-pace judgement, shortfall (R8).
- [x] T028 [P] `apps/web/src/lib/goal/progress.test.ts` — target met reads met; a past date reads passed, not negative; unreachable states the shortfall; no target ⇒ an invitation, never a fabricated figure.
- [x] T029 `apps/web/src/app/(app)/portfolio/page.tsx` — render progress when a target exists; invite one when it does not; label it a projection at current rates.

## Phase 6: Polish & verification

- [ ] T030 `CHANGELOG.md` + a client-facing `content_seed/whats-new.json` entry (canonical tag — the 132 gate requires both surfaces).
- [ ] T031 Full gates: agent pytest/ruff/strict-mypy + web tests/tsc/typecheck:test/eslint.
- [ ] T032 Apply 0033 → deploy agent → deploy web → poll ~3 min for `exited:unhealthy`.
- [ ] T033 Live matrix per quickstart §3 (SC-001…SC-010), then re-run the 029 battery unchanged.
- [ ] T034 PR to develop with the before/after table.

## Dependencies

Phase 1 blocks everything — US1 and US2 both need candidates to exist and to carry a real risk class.
US3 is independent of US1/US2 and could ship alone. US4 depends on US3 (no target, no progress).
T033 requires everything deployed.

## Implementation Strategy

Single implementer, in phase order. Phase 1 + US1 is the MVP and is independently shippable: it turns
the page from a list of one into a real comparison. Commit at each phase boundary. The pure leaf
modules (T006, T027) come before the screens that consume them, so the honesty rules are testable
without a browser — the pattern that made 025/028/029 verifiable, and that caught five defects a
green suite had passed.
