# Spec 070 — Kamino SOL yield via 1Click Earn on the 069 registry

**Status:** backend + web (Phase B) implemented · live deposits/withdraw Phase C
(awaits owner) · **Branch:** `feat/070-kamino-sol-earn` (stacked on
`feat/069-morpho-earn-registry` @ `8ce6256`, which is stacked on 068) · **Worktree:**
`~/project/sparkpoint-pivot-070`

## Problem

069 made Morpho vault support a data question. The same question now applies to Kamino: can a
Kamino kVault on Solana be offered through NEAR Intents 1Click Earn, and can a Kamino USDC (or any
other kVault) be added by editing `earn.json` only — no code change?

Today 1Click has exactly **one** Kamino receipt (`kV-gtSOLb`) for kVault `DcCRSd…` ("SOL
Balanced", SOL). Unlike the 069 Morpho receipts (NEAR-issued ERC-4626 wrappers), this receipt is
the **native Kamino vault share mint** (`5EBsGg…`). There is **no** Kamino USDC receipt in 1Click
Earn yet.

## Requirements

- **R1 — Data-driven.** `earn.json` carries the `sol` chain, a `kamino` section (API URL,
  auto-discovery flag, token mints, filters, configured vaults) and a Solana dry-probe address.
  Adding a Kamino USDC vault is appending to `kamino.vaults` + `oneclick_receipts`. No handler
  hard-codes a vault address.
- **R2 — Snapshot, never request-path.** The Kamino list (~400 KB, 194 vaults) and per-vault
  metrics are fetched only by the background refresher or `scripts/earn_registry_snapshot.py`.
  Request handlers read the shared registry snapshot; the shipped `snapshot.json` is the fallback.
- **R3 — Honest rails.** Kamino `direct` is hidden (the beta has no Solana wallet) with a clear
  reason. `oneclick_earn` is available only for a configured receipt whose `underlying_vault`
  matches (case-exact base58). The preview says plainly that the receipt **is** the native kVault
  share (not a NEAR wrapper) and discloses the keyless 0.25% fee. Intents Connect is never offered
  on Solana.
- **R4 — Preview.** `POST /earn/preview` accepts an optional Solana `recipient` (068 base58
  validation). A Base-USDC deposit uses the connected EVM wallet and a pasted Solana recipient;
  SOL-origin deposits and withdraws use the 068 copy-address flow. Dry only. A 1Click
  `400 No liquidity available` is an honest `unavailable` card ("try a smaller amount").
- **R5 — Chat.** Deterministic parser for "Show Kamino vaults", "best Kamino vault", "Kamino SOL
  vault" and "deposit/put/stake X SOL|USDC into/in Kamino [vault] [on Solana]". Only fires on an
  explicit Kamino mention or a configured Kamino vault name; 068 swap/bridge and 069 Morpho
  phrasing are unchanged.
- **R6 — Scripts + tests.** Snapshot script reports total kVaults / by asset / configured /
  oneclick-live (with `--kamino-only` to avoid a Morpho page budget); dry smoke adds the verified
  Kamino quotes. Mock-HTTP tests cover normalization, metrics merge, auto-discover on/off,
  config-only USDC addition, case-sensitive keys, rails, previews, router filters, parser and the
  DAG hook. All 069 tests still pass.
- **R7 — Spec-kit artifacts** in this directory + CLAUDE.md pointer + CHANGELOG.

## Non-goals

- No live (signable) web deposit/withdraw, no signing, no custody (Phase C); Phase B is preview-only.
- No live 1Click quote call from the web card and no transaction of any kind.
- No new npm/python dependency; no Defender/CI/secret/model/billing changes.

## Acceptance

1. `GET /earn/vaults?chain=sol&protocol=kamino` returns `SOL Balanced` with a `oneclick_earn` rail
   and `protocol="kamino"`; no Kamino call is made from the handler.
2. A dry `100 Base USDC → kV-gtSOLb` preview returns `receiptKind="native_shares"` and
   `walletSupport {recipient:"paste_solana_address", deposit:"evm_wallet"}`.
3. An EVM `0x…` recipient on a Solana receipt is a `400 VALIDATION_ERROR`.
4. `Show Kamino vaults` and `Deposit 100 USDC into Kamino SOL vault` emit `earn_vaults` /
   `earn_quote` without the LLM; `Compare Aave and Kamino, then deposit 500 USDC into the safer
   one.` keeps the planner.
5. Adding a hypothetical Kamino USDC vault + receipt to `earn.json` makes it appear with the
   oneclick rail (test proves it).
6. Full agent `pytest`, `ruff` and `mypy` pass (the 12 pre-existing vault_reader forge-artifact
   failures excepted).
