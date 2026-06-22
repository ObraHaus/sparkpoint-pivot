# Data Model — Phase 1 (002-web-app-ui)

All entities are **UI/mock data** (typed in `apps/web/src/lib/mock-data.ts`), mirroring the design's `SP.data`. No persistence, backend, or chain. Money/amounts render with tabular numerals.

## Entities

### Network
Base + Sui. Fields: `id` ('base'|'sui'), `name`, `live` (bool), `color`, `wallet` (per-network mock address). UI holds an `activeNetwork` selection (default `base`).

### Session / Wallet
Mock signed-in user. Fields: `wallet` (display address, varies by active network), `connected` (bool, simulated). No real keys/auth.

### Mandate
Onboarding result. Fields: `tier` (0–5 risk), `name` (e.g., "Lower risk"), `goal`, `timeline`, `experience`.

### Portfolio
Fields: `netWorth`, `pnl` { `abs`, `pct`, `window` }, `idleUSDC`, `allocation` [ { `k` label, `v` value, `risk` tier } ], `series1M` (number[] for the net-worth chart), `apyHist` (number[]).

### Position
A holding (e.g., the vault position, idle USDC). Fields: label, value, risk tier, and detail fields for the position-detail view (realized/unrealized, history).

### Vault (Aave Yield Vault)
Fields: `name`, `netApy` (3.87), `supplyApy` (4.3), `fee` (0 deposit/withdraw), `perfFee` (10, % of yield over a **high-water mark**), `shares`, `shareValue`, `accrued`, `risk` (tier 1), `capUser`, `capUsed`, `tvl`, `tvlCap`. Net-APY breakdown = supplyApy − perfFee-effect = netApy.

### Recommendation
Ranked suggestion. Fields: `id`, `rank` (e.g., "Best fit · #1 vs your goal"), `title`, `thesis`, `apy`, `risk` (tier), `fit`.

### Outcome
Realized result of a past recommendation. Fields: `id`, `kind` ('gain'|'loss'), `pnl` (±$), `pct`, `win` (window), `from` (originating recommendation), `cause`, `date`.

### Notification
Fields: `t` (title), `s` (subtitle), `time`, `unread` (bool), `icon`. Unread count drives the bell badge.

### Transaction
Mock activity. Fields: `type` (Deposit/Yield/Withdraw), `amt`, `usd`, `time`, `dir` ('in'|'out').

### Session Key / Automation
Default `null` (no active automation). When present: scope (allowlisted vault/targets), per-tx + cumulative caps, max slippage, expiry; instant revoke. UI states: none-granted vs active.

### Bridge Asset / Transfer
`bridgeAssets`: [ { `sym`, `base` (balance), `sui` (balance) } ]. A transfer (UI-only): asset, amount, from-network, to-network, status.

### Admin Role
The "View as" selection: `Super-Admin` | `Ops` | `Stakeholder` | `Client`. Governs which admin sections/nav are visible. (Cosmetic in this build — no real authorization.)

### Risk Tier (lookup)
0=Cash, 1=Lower, 2=Low, 3=Moderate, 4=Elevated, 5=High — each maps to a token color (`--risk-1..5`) for the risk chip/meter. Drives `riskChip()`.

## Relationships & rules
- A **Mandate** is produced by onboarding and referenced by **Recommendation** ranking ("vs your goal") and the risk framing.
- **Portfolio.allocation** references the **Vault** position + idle cash; **Position** detail expands an allocation row.
- **Outcome** links back to the **Recommendation** that produced it ("from …").
- **Network** selection swaps the displayed **Session.wallet** and gates the **Bridge** balances.
- All figures are sample data; the UI must label/treat them as non-live (no real PnL/custody).
