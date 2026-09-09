# Tasks: 018 — P1 remainders

Ordered for independent, honest shipping. US1 first (kills a live fabrication).

## US1 — De-mock `/outcomes` (P0 honesty hotfix)
- [ ] T001 Stop `apps/web/src/app/(app)/outcomes/page.tsx` importing `data.outcomes`; render the real ledger (US3) when present else an honest empty/pending state. Keep `lib/mock-data.ts` (other pages use it) — just don't consume `.outcomes` here.
- [ ] T002 Remove the fabricated stats (`−$27.86`, wins/losses) + dead `tx` links; grep-prove `27.86` gone.

## US2 — Pre-sign dry-run (P1)
- [ ] T010 Agent: `POST /vault/simulate/{deposit,withdraw}` in `services/agent/src/sparkpoint_agent/api/vault.py` (or a new `api/simulate.py`) — ABI-encode real `deposit(assets,receiver)` / `redeem(shares,owner,receiver)` calldata, `eth_call` dry-run + `eth_estimateGas` via the `viem_eth_call` path, return `SimulationResult`. Deposit: read allowance first, honest "approval required" when insufficient. Fail closed (`SIMULATION_UNAVAILABLE`) on undeployed/unreachable.
- [ ] T011 Register the router in `api/main.py`.
- [ ] T012 Web: add the sim `useQuery` + `simStatus`/`willRevert`/`revertReason`/`gas`/`asOfBlock` to `apps/web/src/lib/chain/useConfirmPreview.ts`; fold into the DEPOSIT aggregate gate, keep WITHDRAW ungated (N2).
- [ ] T013 Web: add the sim `PreviewStep` row + honest labels in `apps/web/src/components/ui/ConfirmFlow.tsx`; deposit-only gating; withdraw row informational.
- [ ] T014 Web: parse the response with `SimulationResultSchema` (`@sparkpoint/shared/schemas`), fail-closed.

## US3 — Realized-outcomes ledger (P2)
- [ ] T020 Agent: extend `services/agent/src/sparkpoint_agent/db/vault_flows.py` with a per-withdrawal realized replay (`replay_outcomes(flows, current_shares) -> list[RealizedOutcome] + reconciles`), exact integer average-cost (mirror `replay_basis`).
- [ ] T021 Agent: `GET /outcomes` in `api/portfolio.py` (or `api/outcomes.py`) — fetch flows (as `/portfolio`), reproject per-withdrawal, return rows ONLY when `reconciles` else empty + honest flag. Degrade to empty/stale on outage.
- [ ] T022 Shared: add an `OutcomesResponse` zod schema in `packages/shared/src/schemas/` (or a local web type) — keep Python ↔ zod byte-identical.
- [ ] T023 Web: `useOutcomes()` hook in `lib/agent/useAgent.ts` + wire `/outcomes` page to render real rows (wins + losses, tx proof links) with the honest position-level label.

## Tests
- [ ] T030 Agent: `replay_outcomes` unit tests (gain/loss/flat, reconcile-gate, over-draw) in `tests/db/test_vault_flows.py`.
- [ ] T031 Agent: `/vault/simulate/*` tests (revert decode, gas, allowance-gated deposit, withdraw advisory, fail-closed) in `tests/api/`.
- [ ] T032 Agent: `/outcomes` tests (per-withdrawal rows, empty-on-unreconciled).
- [ ] T033 Web: pure-module tests for the outcomes view-model + sim confirm-signal reducer.
- [ ] T034 Web: e2e `apps/web/e2e/pw/f018-p1-remainders.spec.ts` (/outcomes honest render; deposit confirm shows a real dry-run verdict).
- [ ] T035 Schema-parity check (Python model ↔ zod).

## Docs / housekeeping
- [ ] T040 Update `docs/orchestration/wave-state.json` + `GATES.md` (US2 vault dry-run + US5 ledger partial-shipped; execution spine/swaps/attribution still deferred).
- [ ] T041 Update `docs/phase-3-deferred.md` (what shipped vs deferred; SC-002 swaps unmet, SC-010 per-rec unmet).
- [ ] T042 Repo `CHANGELOG.md` + in-app `content_seed/whats-new.json` entries.
