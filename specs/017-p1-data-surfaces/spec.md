# Feature Specification: P1 data surfaces — realized PnL, honest live APY, fee-proof

**Feature Branch**: `feat/017-p1-data-surfaces`

**Created**: 2026-07-23

**Status**: Draft

**Input**: Round out the three "partial"/fabricated data surfaces from the Jul-23 gap audit so the numbers are real, not pending-labelled or hardcoded: (1) portfolio **realized PnL** + a denser (still real) net-worth series — and fix the latent bug where "unrealized" silently becomes lifetime PnL after a withdrawal; (2) an **honest live APY** on the vault + recommendation cards, read from the on-chain Aave v3 supply rate instead of a fabricated 4.3% (shown as "≈0% (testnet)" when the testnet rate is ~0); (3) a **real fee-proof panel** on `/fees` replacing the fabricated yield-vs-revenue bars, built from live on-chain reads (share price vs high-water mark + your real position). No schema/migration change.

## Clarifications

### Session 2026-07-23
- **Q: Realized PnL — how, without a price oracle?** → **A: A moving-average cost-basis replay over the already-indexed Deposit/Withdraw flows** (they carry `shares` + `assets`; USDC is $1-par so no oracle). Realized = Σ(assets received − avg cost of shares redeemed); costBasis = avg cost of shares *held now*. Surfaced ONLY when reconstructed shares reconcile to the on-chain balance (complete, untransferred history) — else honest null. This also fixes the latent double-count: today `unrealized = value − (deposited − withdrawn)` = *lifetime* PnL once a withdrawal exists.
- **Q: APY source, given the 010 Morpho feed is Phase-3-deferred?** → **A: The Aave v3 `IPool.getReserveData(asset).currentLiquidityRate` (RAY) on Base Sepolia** — a keyless view read, converted RAY→APY (per-second compounding, as Aave's UI). Honest: testnet USDC has ~0 borrow demand → render "≈0% (testnet)", never a fabricated figure; "—" when unreadable. A pure conversion is mirrored in TS (`aaveApy.ts`) and Python (`aave_rate.py`) with a keep-in-sync note + tests.
- **Q: Fees chart — the full version exposes protocol-wide fee totals publicly (currently admin-only), a business-disclosure decision.** → **A: Build the decision-free on-chain-only fallback** (share-price-vs-HWM proof + the user's real position; remove the fabricated bars). The public `/fees/proof` revenue endpoint is left as an operator-approvable follow-up (recorded, not built here).
- **Q: Migrations?** → **A: None.** Realized PnL + series derive from `onchain_events` (already carries shares); APY + fees use on-chain view reads. Two public (non-key) agent env vars (`AAVE_POOL_ADDRESS`, `AAVE_RESERVE_USDC_ADDRESS`) are runtime config; unset ⇒ honest null.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Portfolio shows real realized PnL + a coherent unrealized (Priority: P1)

A user who has deposited (and possibly withdrawn) sees, on their portfolio + position detail, a **realized PnL** figure and a **coherent unrealized** figure (no longer double-counting realized gains), plus cost-basis = the average cost of shares they still hold — all derived from their indexed on-chain flows, or an honest "pending" when the indexed history doesn't reconcile.

**Why this priority**: Fixes a real correctness/honesty bug (unrealized = lifetime PnL after any withdrawal) and delivers the missing realized-PnL number — a core portfolio truth.

**Independent Test**: With flows [deposit 100 → withdraw 60 at pps 1.2], confirm `GET /portfolio` returns `realizedUsd "10.00"`, `unrealizedUsd "10.00"`, `costBasisUsd "50.00"`; and `realized + unrealized == value + Σwithdrawn − Σdeposited`.

**Acceptance Scenarios**:
1. **Given** a reconciled indexed history, **When** the portfolio is read, **Then** realized/unrealized/costBasis are real signed USD strings; realized + unrealized = lifetime PnL.
2. **Given** an incomplete/unreconciled history (indexer behind / share transfer), **When** read, **Then** all three PnL fields are `null` (honest "pending") — never a partial guess.
3. **Given** a no-withdrawal position, **When** read, **Then** costBasis == net-deposited (back-compat) and unrealized is unchanged from today.
4. **Given** the net-worth series, **When** it renders, **Then** deposits/withdrawals appear as honest steps (real pre-event marks at the flow's implied pps), the final point is the live value, and there is no interpolated/fabricated curve.

---

### User Story 2 - Honest live APY on the vault + recommendation cards (Priority: P1)

A user sees the **live Aave USDC supply APY** (net of the live performance fee) on the vault card, the deposit/withdraw confirm gate, and recommendation cards — read on-chain — instead of a hardcoded 4.3%/3.87%; on testnet where the rate is ~0 it honestly reads "≈0% (testnet)", and "—" when unreadable.

**Why this priority**: The fabricated 4.3% appears across the product and directly contradicts "provable, not promised" (Principle III).

**Independent Test**: On Base Sepolia, `/vault` shows the net APY from the live `getReserveData(USDC).currentLiquidityRate` (≈0% (testnet) when ~0); `GET /recommendations` returns non-null `grossApyBps`/`projectedApyBps` when the Aave envs are set (`projected = round(gross·(1−fee))`), null when unset; `grep 4.3% apps/web/src` finds no APY figure outside mock/landing/admin.

**Acceptance Scenarios**:
1. **Given** the live Aave read, **When** the vault card renders, **Then** it shows the net-of-fee APY (or "≈0% (testnet)" / "—"), never a hardcoded figure.
2. **Given** the recommender with the Aave envs set, **When** recommendations are built, **Then** `grossApyBps`/`projectedApyBps` are the real read; with envs unset they are null (honest, unchanged legacy).
3. **Given** the confirm gate, **When** the deposit "Net APY on new shares" row renders, **Then** it matches the vault card's honest value.

---

### User Story 3 - The /fees panel proves fees from live on-chain state (Priority: P2)

A user opens `/fees` and sees a **provable** statement built from live on-chain reads — the vault's current share price vs its high-water mark (⇒ whether any performance fee is accruing) + their own real position value — instead of a fabricated yield-vs-revenue bar chart; the live "verify" fee-param panel is unchanged.

**Why this priority**: Removes a fabrication ("$0.00 fees" + invented bars) and replaces it with real, provable on-chain facts, without a business-disclosure decision.

**Independent Test**: `/fees` no longer renders the hardcoded `yld`/`rev` arrays; the "fees so far" statement is derived from the live share-price-vs-HWM read; the `performanceFeeBps`/`feeRecipient` verify panel still reads live.

**Acceptance Scenarios**:
1. **Given** share price ≤ high-water mark, **When** `/fees` renders, **Then** it states no performance fee is currently accruing for anyone — a live, provable fact.
2. **Given** the user's position, **When** `/fees` renders, **Then** it shows their real position value (convertToAssets(balanceOf)).
3. **Given** the page, **When** it renders, **Then** no fabricated bar arrays remain and the StatusTag honestly separates the real reads from the (deferred) protocol-revenue history.

### Edge Cases
- Chain/RPC outage: portfolio degrades to `200 + stale:true` with all PnL `null`, series `[]` (unchanged); APY reads `null`→"—"; fees panel shows honest "unavailable".
- Unreconciled history: PnL null (never a partial guess).
- Testnet ~0 APY: "≈0% (testnet)", never a fabricated rate.
- Aave envs unset on the agent: recommender APY stays null (legacy), no 503.

## Requirements *(mandatory)*

- **FR-001**: `replay_basis` MUST compute realized PnL + remaining cost basis via average-cost over the complete indexed flows, exposing a `reconciles` gate (reconstructed shares == on-chain balance); `GET /portfolio` + position detail MUST surface realized/unrealized/costBasis only when reconciled, else null.
- **FR-002**: Coherence MUST hold: `realizedUsd + unrealizedUsd == valueUsd + Σwithdrawn − Σdeposited` for a reconciled history.
- **FR-003**: The net-worth series MUST densify with real pre-event marks (held shares × the flow's implied pps); no interpolation/oracle/fabrication.
- **FR-004**: A keyless on-chain Aave supply-rate read (RAY→APY) MUST feed the vault card, confirm gate, and recommender MarketData; honest "≈0% (testnet)"/"—" labels; the TS + Python conversions MUST match (tests both sides).
- **FR-005**: Two public env vars (`AAVE_POOL_ADDRESS`, `AAVE_RESERVE_USDC_ADDRESS`) MUST be added to the agent config allowlist without tripping `_assert_no_key_material`; unset ⇒ honest null.
- **FR-006**: `/fees` MUST replace the fabricated bars with a live on-chain proof panel (share-price-vs-HWM + user position); the live fee-param verify panel stays real.
- **FR-007**: No schema/migration change; no custody/withdraw/exit path touched (all reads view-only + keyless).
- **FR-008 (non-custody)**: Display-only throughout; `signable ⟺ policy approved` preserved on rec cards; a ~0% testnet vault deposit stays signable.

### Key Entities
- **BasisResult**: realized, remaining_cost_basis, reconstructed_shares, reconciles.
- **PortfolioPnlView / PositionPnl**: derived (incl. realizedPnlUsd), fail-closed to undefined.
- **Aave supply rate**: RAY currentLiquidityRate → APY bps (mirrored TS/Python).
- **Fee proof**: live share price, high-water mark, user position.

## Success Criteria *(mandatory)*
- **SC-001**: Realized PnL correct + coherent on a withdrawal case (agent test); null when unreconciled.
- **SC-002**: Vault + rec cards show the live Aave APY (or honest ≈0%/—); 0 hardcoded 4.3%/3.87% APY figures remain in `apps/web/src` outside mock/landing/admin.
- **SC-003**: `/fees` renders no fabricated arrays; the fee statement is derived from a live read.
- **SC-004**: Agent `ruff`/`mypy`/`pytest` + web `test`/`tsc`/`lint`/`build` green; `changelog-required` green.

## Assumptions
- `onchain_events` flows carry `shares` + `assets` (verified). USDC is $1-par.
- Aave v3 `getReserveData` returns `currentLiquidityRate` at tuple index 2 (stable v3.0–v3.2); pool + reserve pinned in the shared address book for Base Sepolia + Base.
- The perf-fee ledger has no per-user column + no background loop feeding it (so the honest fees panel is on-chain-state-based, not a per-user revenue history).
