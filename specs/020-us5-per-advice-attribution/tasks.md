# Tasks: US5 — Per-Advice Attribution (the credibility loop)

**Feature**: `specs/020-us5-per-advice-attribution` | **Branch**: `feature/020-us5-per-advice-attribution`

**Inputs**: [plan.md](./plan.md) · [spec.md](./spec.md) · [research.md](./research.md) ·
[data-model.md](./data-model.md) · [contracts/outcomes-attribution.md](./contracts/outcomes-attribution.md) ·
[quickstart.md](./quickstart.md)

Tests included (Principle III honesty + non-custody are load-bearing). `[P]` = parallelizable. Story
labels: US1 view-outcome, US2 persist+link (spine), US3 honest-attribution, US4 stay-current.

**Likely ships in two increments** (matching 019): **A = agent backend** (store + link + attribution +
endpoints + tests; live-validatable via API — SC-007), **B = web surface**. Tasks cover both.

> **Increment A status (SHIPPED — this PR).** Built + green (712 agent tests, ruff + mypy strict):
> migration `0022_recommendations`, `db/recommendations.py` (`RecommendationStore` + `dedupe_key`),
> `replay_lots` FIFO per-deposit-lot attribution (`db/vault_flows.py`), the `/build-tx` rec-link
> (`orchestrate._resolve_rec` writes `intent_bundles.recommendation_id`, advances `surfaced → acted`),
> and the surfaces `GET /outcomes` (`recommendations[]`) + `GET /outcomes/{recId}` (`api/portfolio.py`).
> Tests: `test_recommendations_store.py`, `replay_lots` cases in `test_vault_flows.py`,
> `test_outcomes_attribution.py`, and the rec-link cases in `test_build_tx.py`. **SC-010 met on the
> acted path** (an acted-on rec that submits + indexes generates an outcome).
>
> **Deferred to a US5 follow-up (NOT in this PR):** **T002 / T010** — persist-at-surface so
> `GET /recommendations` returns the durable UUID `recId` and `/recommendations/{recId}` is a store
> read. Today the wire `recId` stays strategy-keyed (`rec_<kind>`); the acted path still links + logs a
> clean, human-titled snapshot via `_resolve_rec`, so attribution + SC-010 hold. Deferred because it is
> a `/recommendations` wire-contract change best reviewed on its own. **Increment B (web surface)** and
> **T018–T019 (stay-current)** also remain.

---

## Phase 1: Setup

- [ ] T001 Create `services/agent/migrations/0022_recommendations.sql` skeleton (banner + N1/N2/N5 non-custody note + `PGCLIENTENCODING=UTF8`).
- [X] T002 [P] Confirm no other consumer breaks when `recId` changes to a UUID (grep web for `recId`/`recommendationId` usage; note the round-trip is opaque string pass-through). **DONE:** consumers treat `recId`/`recommendationId` as an opaque round-trip string (`recView.ts` `id`, ExecutionDrawer relay, `/build-tx`); no strategy-key parsing.

## Phase 2: Foundational (BLOCKS all user stories)

- [ ] T003 Write `0022_recommendations.sql`: guarded `recommendation_status` enum + `recommendations` table (per data-model.md) + `UNIQUE(dedupe_key)` + `(wallet, created_at DESC)` / `(wallet, status)` indexes.
- [ ] T004 [P] `services/agent/src/sparkpoint_agent/db/recommendations.py`: `@dataclass RecommendationStore(db)` with `upsert(RecInsert) -> UUID` (`INSERT … ON CONFLICT (dedupe_key) DO UPDATE … RETURNING id`), `get(id) -> RecRow|None`, `mark_status(id, status)`, `list_executed(wallet) -> list[RecRow]`; a `dedupe_key(wallet, strategy_kind, proposed_action, policy_version)` helper (sha256 over canonical json). Copy `db/subscriptions.py`/`db/intent_bundles.py` idioms.
- [ ] T005 [P] Export `RecommendationStore` + models from `services/agent/src/sparkpoint_agent/db/__init__.py`.
- [ ] T006 `services/agent/src/sparkpoint_agent/db/executions.py`: extend `update_status` (or add `set_attribution`) to write `attribution_method` (+ `intent_log_action_id`); keep it optional/None-safe.
- [ ] T007 `services/agent/src/sparkpoint_agent/db/vault_flows.py`: `replay_lots(flows, current_shares, current_pps) -> LotReplay` — per-deposit FIFO lots (each deposit a lot; withdrawals consume FIFO; per-lot realized + unrealized; keyed by deposit tx_hash) with the SAME reconcile gate as `replay_outcomes`; exact integer math. Return `LotReplay(lots: tuple[Lot,...], reconciles: bool)`, `Lot(deposit_tx, entry_block, entry_cost, realized, unrealized, shares_remaining, shared: bool)`.
- [ ] T008 [P] `services/agent/tests/db/test_recommendations.py`: upsert idempotent by dedupe_key (re-surface → same id, no dup); status transitions; get/list_executed.
- [ ] T009 [P] `services/agent/tests/db/test_replay_lots.py`: FIFO lot realized/unrealized vs hand-computed; Σ(lot realized) == `replay_outcomes` total (consistency); reconcile gate on a gap; `shared` flag when ≥2 lots.

## Phase 3: User Story 2 — Persist + link the acted-on rec (Priority: P1) 🎯 the spine

**Goal**: a surfaced rec is persisted; acting on it links `intent_bundles.recommendation_id` + advances the rec to executed.
**Independent test**: quickstart steps 1–3 (surface → row upserted, recId=UUID; build → link written + status acted; confirm → executed + attribution_method).

- [X] T010 [US2] `api/recommendations.py`: at surface, upsert each cleared rec (full snapshot) via `RecommendationStore`; set `recId` = persisted UUID + `proposedAction.recommendationId` = it; fail-open to the ephemeral id on a store outage. Update `GET /recommendations/{recId}` to a store read (UUID) with `NOT_FOUND`. **DONE:** `_persist_recids` upserts each cleared rec (clean `{type,asset,decimals,amount}` snapshot, recommendationId stripped → stable dedupe) + rewrites `recId`/`proposedAction.recommendationId` to the UUID; fail-open per-item (never 503s). Detail is recompute+re-key-then-match (keeps live citations/comparison a bare store read would drop) resolving the durable UUID; unknown → `NOT_FOUND`. +2 tests (idempotent + fail-open); 716 agent tests green.
- [ ] T011 [US2] `execution/orchestrate.py` `build_tx`: resolve-or-create the persisted rec from `req.action.recommendationId` + the action; WRITE `intent_bundles.recommendation_id = <UUID>` (fix orchestrate.py:137 `None`); set the wire `IntentBundle.recommendationId = <UUID>`; `mark_status(acted)`. Unknown/absent id → unlinked (honest).
- [ ] T012 [US2] `execution/orchestrate.py` `submit_signed` + `submission_status`: on record/confirm, `mark_status(executed)` for the linked rec + write `executions.attribution_method='intent_log'`. Never gate anything (N2).
- [ ] T013 [P] [US2] `services/agent/tests/api/test_build_tx_reclink.py`: build with a known recId → `intent_bundles.recommendation_id` written + wire recommendationId echoes it + rec status `acted`; build with an unknown/absent id → unlinked (recommendation_id None), no error; submit/confirm → status `executed` + attribution_method `intent_log`.

## Phase 4: User Story 1 — View a recommendation's outcome (Priority: P1)

**Goal**: `GET /outcomes/{recId}` + a `recommendations[]` section on `GET /outcomes` show each acted-on rec's realized+unrealized PnL, computed live.
**Independent test**: quickstart steps 4–5.

- [ ] T014 [US1] `api/portfolio.py`: NEW pydantic `RecommendationOutcomeRow` + `RecommendationOutcomeResponse` (contracts/outcomes-attribution.md; `extra="forbid"`, camelCase).
- [ ] T015 [US1] `api/portfolio.py`: NEW `GET /outcomes/{recId}` — rec → linked execution (executions by intent_bundles.recommendation_id) → deposit tx → matching lot from `replay_lots` → the detail (entry/realized/unrealized/label/apy/attributionMethod/reconstructable). `NOT_FOUND` for unknown/unexecuted; `DATA_STALE`/honest-degrade on outage.
- [ ] T016 [US1] `api/portfolio.py`: augment `GET /outcomes` to add `recommendations[]` (one row per executed rec via `list_executed` + `replay_lots`), populated only when `reconciles`.
- [ ] T017 [P] [US1] `services/agent/tests/api/test_outcomes_attribution.py`: executed rec → outcome detail with the acted tx + live PnL; surfaced-only rec → `NOT_FOUND`; /outcomes carries the recommendations[] row; unreconciled history → empty + honest.

## Phase 5: User Story 3 — Honest attribution (Priority: P1)

**Goal**: intent_log only; blended → `shared:true` share-of-position; unattributed deposits stay position-level. No fabricated split.
**Independent test**: quickstart step 6 + the blended/unattributed cases.

- [ ] T018 [US3] Ensure the outcome rows set `attributionMethod='intent_log'` always (never heuristic), `shared=true` when the rec's lot is one of ≥2 lots, and deposits with no rec link are ABSENT from `recommendations[]` (they remain in the position-level `outcomes[]`).
- [ ] T019 [P] [US3] `services/agent/tests/api/test_outcomes_attribution.py` (cont.): a 2-rec blended position → both rows `shared:true`, each a real FIFO lot (no fabricated split); a deposit outside any rec → no recommendations[] row, still in outcomes[]; every figure reconstructable (recompute check).

## Phase 6: User Story 4 — Stay current (Priority: P2)

**Goal**: figures reflect live chain each read (inherent to live-compute).
**Independent test**: quickstart step 5 (a withdrawal moves realized; a price change moves unrealized).

- [ ] T020 [P] [US4] `services/agent/tests/db/test_replay_lots.py` (cont.): raising `current_pps` raises a lot's unrealized; adding a withdrawal raises its realized + lowers shares_remaining — proving live recompute tracks state.

## Phase 7: Web — the "By recommendation" surface

- [X] T021 [P] `apps/web/src/lib/agent/outcomesView.ts`: extend the DTO/view with `recommendations[]` (recId, title, actedTxHash, entry/realized/unrealized text, label, shared, attributionMethod) + pure formatting; keep the honest empty/`can't reconcile` states. **DONE (increment B):** added `RecommendationOutcomeDto`/`RecommendationOutcomeDetailDto` + `toRecommendationOutcome`/`toOutcomeDetailView`; `-0.00`→flat; `intent_log`-only attribution label; recommendations mirror the `reconciles` gate.
- [X] T022 `apps/web/src/app/(app)/outcomes/page.tsx`: render a "By recommendation" section (title + acted-tx proof link + realized/unrealized PnL + win/loss/open label); retire the "not yet linked to the specific advice" caveat where a link exists, keep it (honest) for the position-level ledger. **DONE:** "By recommendation" section + lazy per-rec detail (`useOutcomeDetail` → `GET /outcomes/{recId}`: rationale + realized APY); "Shared position" honest badge; blanket caveat retired, kept on the "All withdrawals" ledger.
- [X] T023 [P] `apps/web/src/lib/agent/outcomesView.test.ts`: the view parses recommendations[]; shared/unattributed labels render; empty/degraded states hold. **DONE:** +11 unit tests (137 web total green).

## Phase 8: Polish, Housekeeping & Ship

- [ ] T024 Agent gate: `cd services/agent && uv run ruff check src && uv run mypy src && uv run pytest -q` — green.
- [ ] T025 Web gate: `cd apps/web && pnpm run typecheck:test && pnpm run lint && node --experimental-strip-types --test "src/lib/agent/**/*.test.ts" && pnpm run build`; `cd packages/shared && pnpm run build`.
- [ ] T026 [P] `CHANGELOG.md` (Added: recommendations store + rec→outcome attribution + 0022) + `MIGRATIONS.md` (0022 row + current-state) + `services/agent/content_seed/whats-new.json` (New, client-friendly "See whether the AI's advice actually paid off").
- [ ] T027 [P] `docs/phase-3-deferred.md` row 7 (US5) → attribution SHIPPED (intent-log); note the heuristic path + outcome_logs table still deferred. Update `wave-state.json` US5 line.
- [ ] T028 Apply `0022` to develop DB (`PGCLIENTENCODING=UTF8`) BEFORE the agent redeploy; verify the table + enum.
- [ ] T029 PR (base develop) → CI green (agent ruff+mypy+pytest, web build, parity, changelog gate — both changelogs updated) → merge.
- [ ] T030 Deploy agent + web (manual Coolify); confirm `/api/version`; run the quickstart e2e on alpha (SC-007) via real SIWE (surface → act → link written → outcome open → withdraw → realized attributed); non-custody spot checks.
- [ ] T031 Memory: update `sparkpoint-019-execution-spine`/a new US5 note — what shipped, 0022, intent-log-only, live-compute, SC-010 met.

---

## Dependencies & order

- Setup → Foundational block everything. **US2 (T010–T013)** is the spine (persist+link) and unblocks
  **US1 (T014–T017)**. **US3 (T018–T019)** and **US4 (T020)** refine US1's compute. **Web (T021–T023)**
  needs US1's endpoints. **Ship (T024–T031)** last; apply 0022 (T028) before the agent redeploy (T030).

## MVP scope

**US2 + US1** (persist + link + view the outcome) is the demonstrable MVP and meets **SC-010** on the
agent side (live-validatable via API). US3/US4 are honesty + freshness guarantees; the web surface is the
user-facing finish. Ship agent-backend first (increment A), web second (increment B) if the diff is large.
