# Spec 071 — Rhea Finance (Burrow) USDC supply on NEAR via 1Click Earn

**Status:** backend (Phase A) implemented · web cards = Phase B · live deposit + `personal_sign`
= Phase C (awaits owner) · in-app withdraw = optional, pending owner · **Branch:**
`feat/071-rhea-near-earn` (stacked on `feat/070-kamino-sol-earn` @ `db42aed`, which is stacked on
069 → 068) · **Worktree:** `~/project/sparkpoint-pivot-071`

## Problem

069 made Morpho a data question and 070 added Kamino on Solana. Can the same earn registry offer
**Rhea Finance lending (Burrow) on NEAR** through the native 1Click route — an in-app dry deposit
preview and a read-only positions view — with the asset list in `earn.json` so USDT (or any other
Burrow market) is enabled by config, not code?

Rhea's cross-chain lending uses a **Multichain Account (MCA)** managed by `multica.near` and a
Burrow market at `contract.main.burrow.near`. A supply is an ordinary 1Click quote whose
`customRecipientMsg` tells Rhea to supply (or register-and-supply) on the user's behalf. The first
deposit also pays a one-off MCA creation fee taken from the deposited amount.

## Requirements

- **R1 — Data-driven.** `earn.json` gains the `near` chain (`protocols:["rhea"]`) and a `rhea`
  section: RPC URL list, logic/AM contracts, app URL, assets (symbol/token id/1Click asset id/
  decimals/enabled), MCA fee fallback, `use_as_collateral`, origin keys. Adding USDT is enabling an
  asset entry. No handler hard-codes a token id or fee.
- **R2 — Snapshot / cached reads.** `earn/rhea.py` is a bounded NEAR JSON-RPC view client with URL
  fallback (10 s timeout, `User-Agent`, base64 args, decoded JSON result). Asset + fee views are
  cached ~5 min in memory; MCA lookup ~60 s. The background registry loop refreshes Rhea rows and
  the shipped snapshot is the fallback. Request handlers never page the RPC for the list.
- **R3 — Honest preview.** `POST /earn/preview` (dry only) returns protocol `rhea`, `firstDeposit`,
  `mca`, `recipient`, `customRecipientMsg`, `messageToSign` (first deposit only), a separate
  `oneTimeFee` ("one-time 0.30 USDC Rhea account fee — first deposit only"), `amountOut`,
  `netSupplied` (`amountOut − fee`), ETA, `supplyApy`, a `source` object and a `withdraw` link-out.
  The `customRecipientMsg` is exactly the SDK wire:
  - existing MCA: `{"w":[{"EVM":"<addr without 0x>"}],"b":{"r":"BurrowSupply"}}`
  - first deposit: `{"w":[...],"b":{"r":"BurrowRegisterAndSupply"},"s":["<signature hex no 0x>"]}`
  - `messageToSign` = `[{"EVM":"<addr without 0x>"}]` (compact JSON, original case).
  A dry placeholder signature is used; the real `personal_sign` is Phase C.
- **R4 — APR is a contract read, never a hard-code.** `get_asset {"token_id"}` returns `supply_apr`
  (fraction), `borrow_apr`, `config.extra_decimals` and `supplied.balance`. Display
  "Supply APY 14.05% (Rhea, variable)" and always include
  `source {kind:"contract", contract:"contract.main.burrow.near", method:"get_asset",
  field:"supply_apr", uiUrl:"https://app.rhea.finance/lending", fetchedAt, stale}`. Only the
  shipped fallback snapshot may carry a stale number, marked with its `fetchedAt`.
- **R5 — Positions (read-only).** `GET /earn/rhea/positions` uses the **signed-in session wallet**
  (never a caller-supplied wallet), resolves the MCA, reads `get_account_all_positions`, converts
  inner units with `token decimals + extra_decimals`, and returns
  `{type:"earn_positions", state, mca, supplied[], totalUsd?, source, appUrl, explainer?, ...}`.
  No MCA / unknown account is an honest `empty` with an explainer; RPC failure is `unavailable`.
- **R6 — Chat.** Deterministic parser for "deposit/supply/lend/earn X USDC on/in/into Rhea
  [Finance] [lending]", "Rhea APY|rate for USDC", "show my Rhea position(s)" and "how do I withdraw
  from Rhea" (link). Fires only on an explicit **Rhea**/**Burrow** mention and never steals
  068/069/070 phrasing (bridge/swap/comparative/generic vault negatives). Emits `earn_vaults` /
  `earn_quote` (protocol `rhea`) and the new `earn_positions` block through the SSE path.
- **R7 — Size cap is honest.** Same 1Click rule as 070: no hard-coded cap; a
  `400 No liquidity available` becomes an `unavailable` card with "try a smaller amount".
- **R8 — Scripts + tests.** `earn_registry_snapshot.py --rhea-only` merges Rhea rows without
  re-fetching Morpho; `earn_dry_smoke.py` covers Base USDC 100 supply/register and 5000, plus an
  MCA lookup and fee read. Mocked-HTTP/RPC tests cover decode/fallback, extra-decimals math, fee
  present/absent, exact message shapes, preview ok/no-liquidity/RPC-down, positions empty/non-empty/
  unknown, API session-wallet scoping, router filters, parser positives/negatives and the DAG.
  All 068/069/070 tests still pass.
- **R9 — Spec-kit artifacts**, CLAUDE.md SPECKIT pointer and a CHANGELOG entry.

## Non-goals

- No live (signable) deposit, no `personal_sign`, no custody, no on-chain transaction (Phase C).
- No in-app withdraw in this phase — it links out to `https://app.rhea.finance/lending`.
- No `api.rhea.finance` proxy calls and no reuse of the Rhea SDK's embedded JWT/authorization.
- No new npm/python dependency, no Defender/CI/secret/model/billing changes.

## Acceptance

1. `GET /earn/vaults?chain=near&protocol=rhea` returns `Rhea Lending USDC` with a `oneclick_rhea`
   rail and `netApy="14.05"` from the snapshot; no RPC is called by the handler.
2. A dry `100 Base USDC → Rhea USDC` preview (no MCA) returns `firstDeposit=true`,
   `oneTimeFee.amount="0.3"`, `netSupplied="99.6808"`, `messageToSign`, and a
   `customRecipientMsg` with `BurrowRegisterAndSupply`.
3. With an existing MCA the preview omits the fee/message and uses `BurrowSupply` + the MCA as
   recipient.
4. `GET /earn/rhea/positions` reads only the session wallet; a query-string wallet is ignored.
5. "Deposit 100 USDC into Rhea" and "Show my Rhea positions" emit `earn_quote` / `earn_positions`
   without the LLM; "Compare Aave and Rhea, then deposit 500 USDC into the safer one." and
   "Bridge 100 USDC to NEAR then deposit into Rhea" keep their existing routes.
6. Full agent `pytest`, `ruff` and `mypy` pass (the 12 pre-existing vault_reader forge-artifact
   failures excepted).
