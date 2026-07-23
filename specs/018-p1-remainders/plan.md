# Implementation Plan: 018 — P1 remainders (honest outcomes + pre-sign dry-run)

**Spec**: [spec.md](./spec.md) · **Branch**: `feat/018-p1-remainders` · **Constitution**: v1.2.0

## Approach

Three decoupled, HONEST slices — each reuses code that already exists, none adds a migration:

1. **US1 de-mock `/outcomes`** (ships first, standalone honesty hotfix). Stop the page importing `data.outcomes`; render the real ledger (US3) when present, else an honest empty/pending state. Removes a live Principle-III violation.
2. **US2 pre-sign dry-run**. New read-only `POST /vault/simulate/{deposit,withdraw}` in the agent that ABI-encodes the REAL `deposit(assets,receiver)` / `redeem(shares,owner,receiver)` calldata and `eth_call`-dry-runs it (revert/return) + `eth_estimateGas`, returning the existing `SimulationResult` wire schema on the `viem_eth_call` leg. Web adds it as a third fail-closed signal in the confirm gate — advisory on withdraw (N2), Sign-disabling on a predicted deposit revert.
3. **US3 realized-outcomes ledger**. New read-only `GET /outcomes` that fetches the indexed flows (as `/portfolio` does) and reprojects them per-withdrawal (extend `vault_flows.py` with a per-withdrawal realized replay), returned only when `reconciles`. Web `useOutcomes()` hook + the real `/outcomes` render.

## Reused-code map (no new infra)

| Need | Reuse |
|---|---|
| eth_call revert/return + gas dry-run | `services/agent/src/sparkpoint_agent/sim/simulator.py` (`viem_eth_call` provider) |
| `SimulationResult` wire schema | `sim/simulator.py` (Python) ↔ `packages/shared/src/schemas/simulation.ts` (zod) — keep byte-identical (FR-009) |
| deposit/redeem/allowance encode + RPC | `services/agent/src/sparkpoint_agent/chain/` (`VaultReader` + RPC client) |
| per-user realized PnL replay | `services/agent/src/sparkpoint_agent/db/vault_flows.py` (`replay_basis` → extend with per-withdrawal replay) |
| flow fetch + `_network_id` + deps | `services/agent/src/sparkpoint_agent/api/portfolio.py`, `api/vault.py` (`get_account`, `get_vault_reader`) |
| confirm gate signals | `apps/web/src/lib/chain/useConfirmPreview.ts`, `vaultConfirmModel.ts`, `components/ui/ConfirmFlow.tsx` |
| agent GET/POST from web | BFF `apps/web/src/app/api/agent/[...path]/route.ts` + `apps/web/src/lib/agent/useAgent.ts` |

## Non-custody / honesty guardrails (design-level)
- The sim path builds calldata ONLY to `eth_call` it — it never signs, never submits, holds no key (N1/N3). The recipient in any built calldata is forced to the user's own account (N1/VR-X5).
- Withdraw sim is advisory: a revert prediction or a sim/RPC outage NEVER disables Sign or the `/exit` hatch (N2). Only deposit disables Sign on a hard revert.
- Every figure is a real read; the `viem_eth_call` leg is labeled a revert/gas dry-run (no balance-delta/slippage claim). Empty-or-honest on any outage; fail-closed (`SIMULATION_UNAVAILABLE`) never a fabricated pass.
- No migration; `/outcomes` + `/vault/simulate/*` are pure read/derive.

## Testing
- **Agent**: `replay_outcomes` unit tests (gain/loss/flat, reconcile-gate, over-draw); `/vault/simulate/*` tests (revert decode, gas, allowance-gated deposit, withdraw advisory, fail-closed); `/outcomes` endpoint tests (per-withdrawal rows, empty-on-unreconciled).
- **Web**: pure-module tests for the outcomes view-model + the sim confirm-signal reducer; e2e `f018-p1-remainders.spec.ts` (/outcomes honest render; deposit confirm shows a real dry-run verdict).
- **Schema parity**: Python model ↔ zod byte-identical (a parity check).

## Docs / housekeeping (FR-011)
- `docs/orchestration/wave-state.json` + `GATES.md`: mark US2 (vault dry-run) + US5 (ledger) partial-shipped; keep the execution spine / swaps / attribution deferred.
- `docs/phase-3-deferred.md`: record exactly what shipped vs what remains (SC-002 swaps unmet, SC-010 per-rec unmet).
- Repo `CHANGELOG.md` + in-app `/changelog` (`content_seed/whats-new.json`) entries.
