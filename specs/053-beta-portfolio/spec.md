# Spec 053 — Beta portfolio: wallet + wrappers, for the user and the AI

**Status:** approved by operator 2026-09-20 (decisions below) · **Owner:** build ·
**Depends on:** 049 (V3 fleet), 050 (curated board), 051 (wrapper rail). **Contracts: none** — the
wrapper is a complete ERC-4626; the work is reads, indexing, and UI.

## Why

On the Robinhood Chain beta (4663) the portfolio is wired to the **launch Aave vault only**:

- `live` requires the launch vault to be deployed (`useVault` on the connected chain). On 4663 it
  is not, so `degraded=true` and the allocation/positions cards render
  **"The AI vault isn't in the beta yet."** — even for a wallet holding USDG or a wrapper position.
- The held wrapper is read from the **static** `sparkPointWrappers` address-book list, which is
  `undefined` on 4663 (wrapper instances are dynamic, served by the curated board). A Steakhouse
  USDG depositor therefore sees no position.
- The wallet's USDG balance is read (`stableRaw`) but never fed into `derivePortfolio`; net worth
  has no USD total ("no price oracle") even though USDG is a $1 stablecoin.
- Token discovery (`useWalletTokens`) has no 4663 mapping, and the 4663 explorer
  (`robinhoodchain.blockscout.com`) is behind a Cloudflare challenge — a non-browser API read is
  403'd, so explorer enumeration is not dependable there.
- The agent's `GET /portfolio` is vault-centric (launch vault via `VaultReader`); on 4663 it
  degrades to empty, so **the AI cannot see the user's holdings** to recommend from.
- PnL/history needs indexed Deposit/Withdraw flows; only the launch vault is indexed, so the beta
  chart says "The AI vault isn't in the beta yet." instead of an honest empty state.

The portfolio is the surface that shows a user their idle funds can be grown — and the surface the
AI reads to recommend where. It must work **before any deposit**, **with no vaults at all**, and
**with curated wrappers**.

## Operator decisions (2026-09-20)

1. **Full beta portfolio** — wallet tokens + all held curated wrappers + idle + allocation + net
   worth + a working before-deposit state (one read layer).
2. **USDG at $1 par** for the USD total, labelled as par (a stablecoin needs no oracle; the launch
   vault's own endpoint already values USDC at par). ETH stays a separate ETH line, never priced.
3. **Token discovery:** a per-chain known-token list read by direct RPC, **plus** a user-facing
   "add token by address" (validated ERC-20, persisted per wallet+chain). Explorer enumeration
   stays for chains that have it.
4. **The AI sees the beta portfolio** — extend the agent for 4663 (wallet tokens + whitelisted
   wrapper positions), not a client-supplied snapshot.
5. **Index wrapper flows now** — so PnL and the value history/chart work on 4663.
6. **Before-deposit state:** an idle position row with a "Put it to work" CTA (allocation reads
   100% cash).

## What

1. **Web portfolio read layer (chain-generic)**
   - Compose from **direct RPC only**: native ETH, the chain stable (USDG/USDC), known/added
     tokens, **held curated wrappers** (board-driven, batched reads), and the launch vault when
     present.
   - `live` = connected && reads settled — **never** "the launch vault is deployed".
   - Net worth (USD) = stable at par + USD-priced wrapper value + launch-vault value; ETH shown in
     ETH (not folded in). `priceSource` for par is explicit.
2. **Positions & allocation**
   - Positions rows: each held vault (label, shares, value), the idle stable row ("earning
     nothing" → CTA), ETH, and the launch vault when present.
   - Allocation by risk tier: held vault tier(s) + idle cash; with only idle, 100% cash plus an
     invite line.
   - Before-deposit: the idle row + "Put it to work" routes to the deposit flow.
3. **Token discovery + manual add**
   - Known list per chain (4663: USDG, WETH, wrapper share tokens; Base/Base Sepolia/RH testnet
     unchanged) via RPC `symbol()/decimals()/balanceOf()`.
   - "Add token by address": validate ERC-20 shape, read symbol/decimals/balance, persist per
     `(chainId, wallet)` in local storage; removable.
   - Explorer enumeration (Blockscout) remains the discovery path where mapped.
4. **Agent `/portfolio` on 4663**
   - Read wallet tokens (known list) + **whitelisted wrapper positions** from the agent DB, valued
     with the stable at $1 par; positions identified per vault (`wrapper:<addr>`).
   - Advisory/stale-markable as today; custody figures remain direct-RPC on the web.
5. **Wrapper flow indexer (4663)**
   - Index wrapper Deposit/Withdraw events for whitelisted wrappers so cost basis, realized/
     unrealized PnL, and the value series work on the beta.
6. **Honest states**
   - Connected with no history ⇒ "No history yet — it appears after your first deposit." (never
     mock, never "AI vault isn't in the beta").
   - Unknown figures stay "—"; the par valuation is labelled.

## Non-negotiable

- Custody balances are always direct-RPC on the web; the agent read is advisory and stale-markable.
- No fabricated figures: unknown ⇒ "—"; par is labelled as par, not a market quote.
- Withdraw is never gated on curation/provenance (N2); exits stay client-signed.
- A token added manually is display-only — it is never a policy target, never signable.
- Fail-closed: an option not from the curated board never gets the wrapper kind (051 holds).

## Acceptance

- On 4663, a wallet with only USDG sees: a real USD net worth (USDG at par), an "Idle USDG" row
  with a "Put it to work" CTA, allocation 100% cash, ETH listed separately, and no "AI vault isn't
  in the beta" copy anywhere on the page.
- A wallet holding the Steakhouse USDG wrapper sees the wrapper position with live shares/value,
  allocation split by tier, and the idle remainder.
- The token card lists the known tokens with real balances; a manually added token persists and
  shows its balance; an invalid address is rejected with an honest error.
- `GET /portfolio` on 4663 returns the same positions (stable at par) so chat can recommend from
  them; unreadable ⇒ `stale:true` with nulls, never invented numbers.
- After a wrapper deposit, PnL + value history render on 4663 (indexed), and the chart shows the
  honest empty state before the first deposit.
- Tests: web unit tests for the derivation/known-token/manual-add; agent tests for the 4663 read
  and the wrapper flow index. Full web + agent suites green; both changelogs updated.
