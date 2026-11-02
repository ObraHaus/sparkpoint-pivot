# Spec 072 — Read-only multi-chain portfolio (backend + evals)

**Status:** backend (Phase A) implemented · web card + zod parity = web phase · live deposits stay
out of scope · **Branch:** `feat/072-multichain-portfolio` (stacked on `feat/071-rhea-near-earn`)
· **Worktree:** `~/project/sparkpoint-pivot-072`

## Problem

068–071 give SparkPoint a cross-chain swap and three earn paths, but the user still cannot answer
the simplest question: *what do I actually have across chains?* The existing `GET /portfolio` is the
**SparkPoint vault** view (one ERC-4626 position + idle stable). It does not read the session
wallet's Morpho vault positions, the Kamino shares on an already-linked Solana address, or the Rhea
(Burrow) supply on NEAR, and it has no cross-chain swap history.

072 adds a separate, strictly read-only multi-chain overview for the **signed-in session wallet
only**. Each source is independent: one dead RPC or a missing Solana link degrades that section, not
the whole answer.

## Requirements

- **R1 — Spec artifacts.** This spec, plan, research (with the smoke output), tasks, the API
  contract and a quickstart live under `specs/072-multichain-portfolio/`.

- **R2 — Service.** A `MultichainPortfolioService` assembles each section concurrently with a
  per-source timeout and a short per-owner cache. A section is `ok`, `unavailable` or `not_linked`
  and carries a human reason. No method signs, submits, takes custody or writes to a database.

- **R3 — Balances.** The session EVM wallet on Base (`BASE_MAINNET_RPC_URL`) and Ethereum
  (`ETHEREUM_RPC_URL`, else an honest `not configured` entry). Native ETH plus the USDC/USDT/WETH/
  cbBTC tokens already in the earn/crosschain config; only non-zero rows; decimals-correct human
  amounts. USD from the existing price service; stables at $1 par labelled `stablecoin_par`.
  Each chain's status is listed separately.

- **R4 — Morpho.** One GraphQL request with per-chain aliases (`userByAddress` for chainIds 1 and
  8453, `vaultPositions.state { shares assets assetsUsd }`), joined with the 069 registry for
  name/APY/rail. 1Click Earn Morpho receipt holdings are read cheaply over the same RPC and valued
  at $1 par only because every configured Morpho receipt is a USDC strategy (the row says so).

- **R5 — Kamino.** Solana is not the session chain. Only addresses already bound to the owner
  (recipients recorded in the owner's `crosschain_quotes` rows) are read; the client never supplies
  an address. kVault share balances come from public `getTokenAccountsByOwner` for the configured
  `kamino.vaults[].shares_mint`; names/APY come from the 069 snapshot. With no linked address the
  section is `not_linked` with: *"Kamino positions show once you deposit to a Solana address from
  SparkPoint (Phase C)"*. The 070 snapshot has no kVault share price, so a share balance stays
  unpriced (`valueUsd: null`) rather than inventing a NAV.

- **R6 — Rhea.** Reuses 071 `rhea_positions(wallet)` (MCA lookup + Burrow positions). USDT stays
  disabled; stablecoin amounts are $1 par.

- **R7 — Swaps.** History from `crosschain_quotes` for `user_eoa = session owner`, newest first,
  limit 20: route keys + human labels, `amountIn`, quoted `amountOut`, deposit address (shortened in
  prose), `createdAt`, `lastStatus`. At most three non-terminal rows may be refreshed through the
  existing 1Click status client **behind a flag** (off by default; mocked in tests). Empty has its
  own copy; no DB says "database is not configured".

- **R8 — Totals.** `totalUsd` sums only rows in `ok` sections, plus `byChain` and `byProtocol`
  breakdowns. Per-section and top-level `asOf` timestamps; a `sources` list
  (`rpc`/`morpho_api`/`solana_rpc`/`rhea_rpc`/`db`).

- **R9 — API.** `GET /portfolio/multichain` uses the session wallet from `get_account` only.
  A `wallet`/`address`/`owner`/`account` query parameter is **rejected**, not silently honoured.
  Rate-limited like the earn endpoints. `GET /portfolio` is unchanged.

- **R10 — Chat.** A new `portfolio_overview` block (camelCase wire) for portfolio turns:
  "show my portfolio", "what do I have across chains", "my balances", "show my positions
  everywhere" (all focus), "my swap history" (swaps-focused), "how much am I earning"
  (earn-focused). It never hijacks 068 swap/quote turns, 069/070/071 explicit earn turns
  ("my Rhea positions" stays `earn_positions`), or the vault-specific "what is my portfolio worth?"
  / "what's in my wallet?" routes. Text is deterministic, read-only, and says nothing signable.

- **R11 — Evals.** Golden cases (offline fixtures) for 6+ portfolio prompts plus degraded Kamino/
  swaps-empty/one-source-unavailable coverage and 2 precedence negatives; assertion support for the
  block kind, focus and section statuses. The 071 vague NEAR-yield case already exists
  (`near-95-vague-near-yield`), so it is not duplicated.

- **R12 — Scripts + tests.** `scripts/portfolio_smoke.py` reads a public address against public
  endpoints (no DB, no 1Click quote, ≤25 calls) and prints section statuses, row counts, totals and
  the call count. Unit tests mock every source; shared JSON fixtures for the block live in
  `packages/shared/tests/fixtures/portfolio/` (ready/degraded/empty) and are generated from the
  production models.

## Non-goals

- No live deposit, signing, transaction, custody or DB write. No new migrations.
- No arbitrary Solana address from the client; no Kamino share-price invention.
- No new dependency, Defender/CI/secret/model/billing change.
- No change to `GET /portfolio` or the existing swap/earn routes.

## Acceptance

1. `GET /portfolio/multichain` returns five sections + totals for the session owner; a wallet query
   parameter is rejected and `GET /portfolio` still passes its own suite.
2. A dead Morpho/RPC/Solana source yields that section `unavailable` (or `not_linked` for Kamino)
   while the rest stay `ok`; totals exclude unavailable sections.
3. "show my portfolio" emits `portfolio_overview`; "my swap history" uses the swaps focus; "my Rhea
   positions" remains `earn_positions`; "what is my portfolio worth right now?" remains
   `portfolio_snapshot`.
4. The offline golden suite and the 072 unit tests pass; `ruff` and `mypy src` pass; the smoke
   script prints the section table and a call count ≤25.
