# Tasks: Pre-Alpha Chat Trust & Answer Quality

**Input**: spec.md, plan.md, research.md, quickstart.md · **Branch**: `feature/029-chat-trust-quality`
**Tests**: included — every fix here exists because something reached production unnoticed, so each gets a pinning test.

## Phase 1: Foundational (shared primitives — blocks the rest)

- [x] T001 Create `services/agent/src/sparkpoint_agent/agents/guard_text.py` — the SHARED prose guard: `looks_meta_shaped()` (028 patterns + the regression's new ones: "the notes I am reviewing", "reference notes provided", "in the notes I", "based on the notes") and `looks_action_shaped()`, both pure.
- [x] T002 [P] Tests `services/agent/tests/agents/test_guard_text.py` — every leak phrase observed in the Aug-3 run is caught; ordinary second-person answers survive (regression-proof both ways).
- [x] T003 Create `apps/web/src/lib/agent/chatError.ts` — pure: `isInternalEnvelope(text|code)` + `chatErrorCopy()` returning honest user-facing copy ("I couldn't reach my model just then"), never the raw envelope string.
- [x] T004 [P] Tests `apps/web/src/lib/agent/chatError.test.ts` — the exact strings seen in the regression ("X-Account/X-Owner/X-Chain-Id are malformed or mismatched.") classify as internal and never render verbatim.

## Phase 2: User Story 1 — no nonsense (P1) 🎯 MVP

- [x] T005 [US1] `apps/web/src/lib/agent/useAgent.ts` — replace `chainId ?? DEFAULT_CHAIN_ID` with a finite + supported-chain guard (FR-001); add the same defensive check where the header is set in `lib/agent/client.ts`.
- [x] T006 [P] [US1] Tests `apps/web/src/lib/agent/identity.test.ts` — NaN, undefined, null, 0, a string, and an unsupported chain all resolve to a supported id; a valid supported id passes through.
- [x] T007 [US1] `apps/web/src/components/screens/chat/live-blocks.tsx` — render agent errors through the new error state (visually distinct, with a **Try again**), never as prose (FR-002).
- [x] T008 [US1] `services/agent/src/sparkpoint_agent/coordinator/dag.py` — general branch: retry the prose call once; on continued failure emit the honest error message rather than `_GENERAL_HELP` (FR-003).
- [x] T009 [P] [US1] Tests `services/agent/tests/coordinator/test_general_branch.py` — first call fails + second succeeds ⇒ the good answer; both fail ⇒ honest error, NOT the canned line; no-model-configured ⇒ canned line preserved.

**Checkpoint**: the two blockers are closed — the chat can be trusted to either answer or admit failure.

## Phase 3: User Story 2 — right-shaped answers (P1)

- [x] T010 [US2] `services/agent/src/sparkpoint_agent/api/chat.py` — `_VaultChatPortfolioProvider` also reads native balance + known token balances; expose them on the view (FR-004).
- [x] T011 [US2] `services/agent/src/sparkpoint_agent/coordinator/dag.py` — the portfolio answer names wallet holdings (native + tokens + idle stablecoin) alongside positions (FR-004).
- [x] T012 [US2] `services/agent/src/sparkpoint_agent/agents/planner.py` — add fees / yield / automation understanding hints (FR-005/006/007).
- [x] T013 [US2] `services/agent/src/sparkpoint_agent/coordinator/dag.py` — answer each: fees → real fee facts or honest gap; APY → live figure or honest unavailable; automation → the signing/session-key model, never a swap card.
- [x] T014 [P] [US2] Tests `services/agent/tests/coordinator/test_answer_shapes.py` — each of the four questions produces the right shape; the automation question never yields an action block.

## Phase 4: User Story 3 — advice boundary (P1)

- [x] T015 [US3] `services/agent/src/sparkpoint_agent/agents/planner.py` + `coordinator/dag.py` — detect personal-allocation questions and short-circuit BEFORE propose with the boundary answer (FR-008).
- [x] T016 [US3] `services/agent/src/sparkpoint_agent/agents/recommender.py` — rationale must not contradict the deterministic risk stamp (FR-009): drop/replace a rationale whose risk language disagrees with the card's tier.
- [x] T017 [P] [US3] Tests `services/agent/tests/coordinator/test_advice_boundary.py` — "life savings"/"everything"/"all in" produce a boundary and ZERO recommendation blocks; an ordinary yield question still produces cards.

## Phase 5: User Story 4 — the assistant knows the product (P2)

- [x] T018 [US4] Write `services/agent/knowledge_seed/sparky-capabilities.md` — what Sparky can/can't do: cross-session memory (and how to clear it), suggestions-only + you sign, revocable scoped automation, faucets for test funds, swap scope, bridge not available.
- [x] T019 [P] [US4] Write `services/agent/knowledge_seed/srk-and-premium.md` — what SRK is, the faucet, premium price and what it changes, and that nothing core is gated.
- [x] T020 [P] [US4] Write `services/agent/knowledge_seed/platform-surfaces.md` — Trust Center, Outcome Log, Fees, Learn, Changelog: what each shows and when to use it.
- [x] T021 [US4] Tests `services/agent/tests/test_knowledge_seed.py` — the seed loads, the three new sources are present and non-empty, and no document contradicts the non-custody invariants (no "we can move your funds" phrasing).

## Phase 6: User Story 5 — transcript hygiene (P2/P3)

- [x] T022 [US5] `apps/web/src/components/screens/chat/live-blocks.tsx` — collapse completed progress steps in a finished turn (FR-012).
- [x] T023 [US5] `services/agent/src/sparkpoint_agent/agents/literacy.py` — stop emitting the internal topic identifier on the tip wire; apply the shared meta guard (FR-010).
- [x] T024 [US5] `apps/web/src/app/(app)/chat/page.tsx` — restore the wallet's most recent conversation on mount when none is selected (FR-013).
- [x] T025 [P] [US5] `services/agent/src/sparkpoint_agent/coordinator/dag.py` — refusals carry no citation block (FR-014); mandate summary text cannot self-contradict (FR-015, `agents/` summary builder).

## Phase 7: Polish & verification

- [x] T026 Living docs — `CHANGELOG.md` + a client-facing `whats-new.json` entry (canonical tag, per the 132 gate).
- [x] T027 Full gates: agent pytest/ruff/strict-mypy + web tests/typecheck:test/tsc/eslint.
- [ ] T028 Re-run the Aug-3 battery + knowledge quiz per quickstart §2 with the harness header-repair DISABLED; record results against SC-001…SC-008.
- [x] T029 PR to develop with the before/after table.

## Dependencies

Phase 1 blocks everything. US1 (T005–T009) is the MVP and independently shippable. US2/US3 depend only on Phase 1 + the DAG being touched (sequence T012→T013, T015→T016 to avoid conflicts in the same files). US4 is pure content — parallel with anything. US5 is independent. T028 requires everything deployed.

## Implementation Strategy

Single implementer. Order: Phase 1 → US1 (checkpoint, could ship alone) → US2 → US3 → US4 → US5 → verify. Commit at each checkpoint. The pure modules (T001, T003) come first so the honesty guarantees are testable without a browser — the same pattern that made 025/028 verifiable.
