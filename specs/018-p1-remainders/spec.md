# Feature Specification: P1 remainders — honest outcomes + a real pre-sign dry-run

**Feature Branch**: `feat/018-p1-remainders`

**Created**: 2026-07-23

**Status**: Draft

**Input**: Pull forward the two "P1 remainder" surfaces flagged Phase-3-deferred in the Jul-23 gap audit, as the smallest HONEST slices that respect non-custody (N1–N5) and "provable, not promised" (Principle III): (1) **de-mock `/outcomes`** — the live page renders fabricated PnL (`−$27.86`, "2 wins/1 loss") with fake tx "proof" links behind a `mock` tag; that is a live fabrication that reads as genuine and must go NOW; (2) **US2 pre-sign dry-run** — upgrade the vault deposit/withdraw confirm gate from a view-only amount preview to a real `eth_call` dry-run of the ACTUAL mutating calldata (revert / decoded reason / real gas), reusing the already-built simulator; (3) **US5 realized-outcomes ledger** — a read-only `GET /outcomes` that reprojects the already-indexed vault flows (feature 017's `replay_basis`) into one REAL row per realized withdrawal (realized USD, win/loss, its own tx as proof), returned only when the share history reconciles. No migration (all read/derive). The full `/build-tx` IntentBundle chokepoint, swap simulation, direct-Aave, and true per-recommendation attribution stay DEFERRED and are documented as such.

## Clarifications

### Session 2026-07-23
- **Q: US2 scope — full build→simulate→submit spine, or the honest slice?** → **A: The honest slice.** The deterministic `evaluate()` policy gate and the `viem_eth_call` simulator already exist as library code; wire ONLY a read-only pre-sign `eth_call` dry-run of the real deposit/redeem calldata into the live confirm gate. DEFER the `/build-tx` IntentBundle chokepoint, `ExecutionDrawer`, signed-tx relay, Aerodrome swap sim, and the 0021 execution migration.
- **Q: Dry-run primitive, given testnet has no mainnet Anvil fork?** → **A: `viem_eth_call`** — a deterministic `eth_call` revert/return check + `eth_estimateGas` against the live chain RPC (84532/46630). It yields a REAL `willRevert` + decoded `revertReason` + real gas + block. It is labeled a **revert/gas dry-run**, NOT over-sold as a full fork simulation (no balance-delta / slippage on this leg).
- **Q: Deposit is 2-step (approve → deposit) — a pre-approval dry-run would "revert" on missing allowance. How to stay honest?** → **A: Read the user's live USDC allowance first.** Only run the deposit `eth_call` dry-run once allowance ≥ amount; before approval, label the state truthfully ("approve first — dry-run runs after approval"), NEVER a spurious "would revert" that blocks a legitimate deposit.
- **Q: Does the sim gate the withdraw path?** → **A: Never (N2).** The dry-run is advisory on deposit (a hard revert disables Sign to save the user gas) and STRICTLY advisory on withdraw — a sim/RPC outage or a revert prediction must NEVER block a withdrawal or the on-chain escape hatch. Fail-open on withdraw; the direct-RPC `previewRedeem` + `/exit` remain the source of truth.
- **Q: US5 — realized PnL per what, without a recommendation store?** → **A: Per realized withdrawal (position-level), NOT per-advice.** Reproject the indexed Deposit/Withdraw flows: each withdrawal realizes `assets_received − avg-cost of the shares redeemed` (exact integer average-cost replay, USDC $1-par). Row carries its own `tx_hash` as on-chain proof. Returned ONLY when reconstructed shares reconcile to the on-chain balance (complete, untransferred history) — else an honest empty state, never a partial-history guess. Honestly labeled "realized results per position — not yet linked to the specific advice that caused it."
- **Q: Migrations?** → **A: None.** US2 dry-run is a stateless `eth_call`; US5 reprojects the existing `onchain_events` (feature 017's `vault_flows`). No new table, no schema change. The true per-advice attribution loop (FR-039/SC-010) — which needs persisted recommendations + an `intent_action_id` + the execution spine — stays DEFERRED.
- **Q: Governance — both are Phase-3-deferred in the authoritative live-state docs.** → **A: Pull forward + update in lockstep.** `docs/orchestration/wave-state.json`, `docs/orchestration/GATES.md`, and `docs/phase-3-deferred.md` are updated to record exactly what shipped and what remains deferred (the execution spine, swaps, direct-Aave, per-advice attribution). SC-002 stays UNMET for swaps; SC-010 (per-rec) stays UNMET after the ledger.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The `/outcomes` page never shows a fabricated number (Priority: P0 — honesty hotfix)

A user (or a tester/client) opening `/outcomes` sees EITHER a real realized-outcomes ledger OR an honest empty/pending state — never the hardcoded `−$27.86` / "2 wins/1 loss" with dead `tx` links that read as genuine on-chain proof.

**Why this priority**: A live "provable, not promised" (Principle III) violation that presents fabricated PnL + fake proof links as real. It ships first, standalone, because the fake data is a live defect regardless of the rest.

**Independent Test**: `grep -R "27.86" apps/web/src` finds nothing; the `/outcomes` page no longer imports `data.outcomes`; with no reconciled history the page renders an honest empty state (no numbers, no dead `tx` links).

**Acceptance Scenarios**:
1. **Given** the `/outcomes` page, **When** it renders with no real ledger data, **Then** it shows an honest empty/pending state (copy explaining outcomes appear once withdrawals are indexed) — no fabricated figures, no dead proof links.
2. **Given** the page renders any figure or `tx` link, **When** inspected, **Then** every number came from a real read and every `tx` link resolves to a real on-chain transaction (or is absent).

---

### User Story 2 - A real pre-sign dry-run of the actual deposit/withdraw (Priority: P1)

Before a user signs a vault deposit or withdraw, the confirm gate runs a real `eth_call` dry-run of the ACTUAL mutating calldata and shows an honest verdict — "simulation passed" with the real gas estimate, or "this would revert: <reason>" — read from the live chain, never fabricated. On deposit a predicted revert disables Sign (saves gas); on withdraw the dry-run is strictly advisory and never blocks the exit (N2).

**Why this priority**: US2 is the non-custody "simulation before you sign" trust backbone (FR-021/FR-023, SC-002). The live gate today only previews amounts; it never dry-runs the mutating call, so a doomed tx still reaches the wallet.

**Independent Test**: `POST /vault/simulate/deposit` with a valid amount + sufficient allowance returns `willRevert:false` + a real hex `gas.estimate` + `asOfBlock`; with an amount over `maxDeposit` (or zero allowance surfaced honestly) it returns `willRevert:true` + a decoded `revertReason`; the confirm gate disables Sign on a deposit revert and keeps Sign enabled on any withdraw sim state.

**Acceptance Scenarios**:
1. **Given** a deposit with allowance ≥ amount, **When** the confirm gate opens, **Then** a real `eth_call` dry-run runs and shows "simulation passed · ~<gas>" or "would revert: <reason>", from a live block.
2. **Given** a deposit whose dry-run predicts a revert, **When** the verdict is shown, **Then** Sign is disabled and the user is told why (never a silent doomed signature).
3. **Given** a deposit with allowance < amount, **When** the gate opens, **Then** it honestly says approval is required first and does NOT show a spurious "would revert" (the dry-run runs after approval).
4. **Given** a withdraw/redeem, **When** the dry-run runs (or the sim RPC is unavailable), **Then** the verdict is advisory only and Sign / the `/exit` hatch is NEVER blocked (N2).
5. **Given** the sim endpoint on a chain where the vault is undeployed or the RPC is unreachable, **When** called, **Then** it fails closed to the canonical `SIMULATION_UNAVAILABLE`/`UPSTREAM_UNAVAILABLE` envelope — never a fabricated "passed".

---

### User Story 3 - A real realized-outcomes ledger on `/outcomes` (Priority: P2)

A user who has withdrawn from the vault sees, on `/outcomes`, one row per realized withdrawal — the realized USD (win/loss/flat), the position it came from, and the withdrawal's own transaction as on-chain proof — derived from their indexed flows, with wins and losses shown equally; when the indexed history doesn't reconcile, an honest empty/pending state.

**Why this priority**: Delivers the real value behind the de-mock (US1), reusing feature 017's cost-basis replay. It is P2 because it is position-level (not yet per-advice); the per-recommendation attribution loop stays deferred.

**Independent Test**: With flows [deposit 100M shares 100M → withdraw 50M shares at pps 1.2 → assets 60M], `GET /outcomes` returns one row `realizedUsd "10.00"`, `kind "gain"`, `txHash` = the withdrawal's tx; with an unreconciled history it returns an empty ledger + `reconciles:false` (honest), never a partial row.

**Acceptance Scenarios**:
1. **Given** a reconciled history with withdrawals, **When** `GET /outcomes` is read, **Then** each withdrawal is one row: real realized USD (signed), win/loss/flat by sign, and its own `txHash` as proof.
2. **Given** an unreconciled/incomplete history, **When** read, **Then** the ledger is empty with an honest "pending" flag — never a partial or fabricated row.
3. **Given** both gains and losses, **When** rendered, **Then** losses are shown as plainly as gains (no survivorship, no euphemism), and the row copy states outcomes are position-level, "not yet linked to the specific advice."
4. **Given** a chain/index outage, **When** read, **Then** the endpoint degrades to an honest empty/stale state, never a hard error on this advisory read.

---

### Edge Cases
- **Deposit dry-run before approval** → honest "approve first" state, not a false revert (US2 AS-3).
- **Withdraw sim outage** → advisory-only; Sign + `/exit` never blocked (US2 AS-4, N2).
- **Partial / non-reconciling flow history** → `/outcomes` empty + pending; portfolio PnL already null in this case (US3 AS-2).
- **A withdrawal that over-draws the reconstructed share balance** (indexer behind, share transfer) → `reconciles:false`, empty ledger.
- **Zero-yield / flat withdrawal** (`realized == 0`) → shown as a `flat` outcome, not hidden.
- **Sub-unit rounding** on redeemed cost mirrors the vault's round-DOWN (bounded dust) — matches feature 017.

## Requirements *(mandatory)*

### Functional Requirements
- **FR-001**: The `/outcomes` page MUST NOT render any fabricated figure or dead proof link; it MUST show real data or an honest empty/pending state (Principle III).
- **FR-002**: A read-only `POST /vault/simulate/{deposit,withdraw}` MUST `eth_call`-dry-run the ACTUAL mutating ERC-4626 calldata and return a `SimulationResult` (`willRevert`, decoded `revertReason`, real `eth_estimateGas`, `asOfBlock`) — provider `viem_eth_call`, zero fabricated numbers.
- **FR-003**: The deposit dry-run MUST first read the user's live allowance and only run once allowance ≥ amount; before approval it MUST surface an honest "approval required" state, never a false revert.
- **FR-004**: The withdraw dry-run MUST be strictly advisory — it MUST NOT gate Sign, and a sim/RPC outage MUST NOT block withdraw or the `/exit` hatch (N2).
- **FR-005**: The confirm gate MUST disable Sign on a deposit dry-run that predicts a revert, and tell the user why.
- **FR-006**: The sim endpoint MUST fail closed (`SIMULATION_UNAVAILABLE`/`UPSTREAM_UNAVAILABLE`) on an undeployed vault / unreachable RPC — never a fabricated pass.
- **FR-007**: A read-only `GET /outcomes` MUST reproject the indexed vault flows into one row per realized withdrawal: realized USD (signed), win/loss/flat, its own `txHash`, and MUST return them ONLY when the reconstructed shares reconcile to the on-chain balance (else an honest empty ledger with a `reconciles:false` flag).
- **FR-008**: `GET /outcomes` MUST show losses as plainly as gains (no survivorship) and MUST label rows position-level ("not yet linked to the specific advice").
- **FR-009**: The Python `SimulationResult`/`OutcomesResponse` models MUST stay byte-identical to their `packages/shared` zod schemas.
- **FR-010**: No migration and no schema change; all new endpoints are pure read/derive (N1–N5 untouched by construction — no keys, no chain-write).
- **FR-011**: The authoritative live-state docs (`wave-state.json`, `GATES.md`, `phase-3-deferred.md`) MUST be updated in lockstep to record what shipped and what remains deferred; both changelogs (repo `CHANGELOG.md` + in-app `/changelog`) MUST get entries.

### Non-Custody Invariants (unchanged, re-asserted)
- **N1**: No new build/sign path; if any calldata is ever built it forces the recipient to the user's own account/owner. (This slice builds calldata only to `eth_call` it — never signs, never submits.)
- **N2**: Simulation is NEVER a hard gate on withdraw/exit; a sim outage degrades to advisory.
- **N3–N5**: Unchanged — read/derive only, no custody, no authority, non-upgradeable semantics untouched.

### Success Criteria
- **SC-001**: `/outcomes` renders zero fabricated figures (grep-proven) — real ledger or honest empty state.
- **SC-002 (partial)**: A pre-trade dry-run is shown before deposit/withdraw signature requests on the vault path. Swaps stay DEFERRED → SC-002 remains UNMET for swaps (documented).
- **SC-003**: A predicted deposit revert disables Sign with a reason; a withdraw dry-run never blocks the exit.
- **SC-004**: `GET /outcomes` returns real per-withdrawal realized PnL when reconciled, empty when not — never a partial guess.
- **SC-010 (unmet, documented)**: Per-recommendation attribution (100% of acted-upon recs logged + PnL-linked) stays UNMET after this slice; recorded as deferred.

## Out of Scope (DEFERRED — documented in phase-3-deferred.md)
- The `/build-tx` IntentBundle chokepoint, `ExecutionDrawer` signing chokepoint, `POST /submit-signed-tx` relay, and the `0021_execution` persistence (intent_bundles / simulation_results / executions).
- Full Anvil mainnet-fork balance-delta / price-impact / slippage simulation.
- Aerodrome swap simulation + adapter; direct-Aave.
- True per-recommendation → tx attribution (persisted recommendations + `intent_action_id` + IntentLog/heuristic worker + outcome_logs/context_snapshots tables).
