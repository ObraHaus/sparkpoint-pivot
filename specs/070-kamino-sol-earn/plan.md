# Plan — 070 Kamino SOL earn (backend)

**Branch:** `feat/070-kamino-sol-earn` (stacked on 069 @ `8ce6256`) · **Worktree:**
`~/project/sparkpoint-pivot-070`.

## Design

### 1. Config (`earn/earn.json`, `earn/config.py`)

- `EarnChain` gains `protocols` (default `["morpho"]`); the new
  `sol` chain is `{"chain":"sol","chain_id":0,"label":"Solana","enabled":true,
  "protocols":["kamino"]}`. `chain_id=0` is the documented non-EVM sentinel; Morpho fetching
  skips chains without the `morpho` protocol.
- `OneClickReceipt` gains `protocol` (default `morpho`) and `receipt_kind`
  (`wrapper` | `native_shares`, default `wrapper`). `kV-gtSOLb` is `kamino` + `native_shares`,
  `underlying_vault=DcCRSd…`, `wrapper_address` = its shares mint `5EBsGg…`.
- `KaminoConfig`: `enabled`, `api_url`, `auto_discover`, `token_mints` (SOL/USDC mints +
  decimals), `filters.assets`, `filters.min_tvl_usd`, `vaults` (address/name/asset/shares_mint).
- `dry_probe_addresses.sol` supplies the valid base58 recipient for dry quotes.
- Address matching is case-normalized **only** for `0x…` values; Solana base58 stays
  case-sensitive (`normalize_address` / `addresses_equal`).

### 2. Kamino (`earn/kamino.py`)

`fetch_kamino_vaults` reads `GET /kvaults/vaults` once, selects configured vaults (plus, when
`auto_discover=true`, mints/assets that pass the filters, capped at 24 metrics calls), fetches
`GET /kvaults/{address}/metrics` with bounded concurrency, and normalizes to `VaultEntry`
(`chain=sol`, `chain_id=0`, `protocol=kamino`, `version=kvault`, asset from `token_mints`,
`tvl_usd=tokensInvestedUsd`, `net_apy=apy`). Fail-open: any API failure returns `[]`; a metrics
failure keeps the configured vault with null TVL/APY. `registry.fetch_vaults` merges Morpho and
Kamino rows into the same snapshot/refresh loop.

### 3. Rails (`earn/rails.py`)

- `direct`: unavailable for Kamino ("requires a Solana wallet — not in beta").
- `oneclick_earn`: receipt matched by `underlying_vault`; native-share note for
  `receipt_kind="native_shares"`, wrapper note for Morpho. Liveness probe uses the configured
  Solana dry-probe recipient for sol receipts and a refund address matching the origin kind.
- `intents_connect`: never available on `sol`.

### 4. Service + API

`preview_for(..., recipient=None)` chooses the oneclick rail for Kamino, sends `refundTo` by origin
kind and `recipient` = the supplied Solana address / configured dry probe, and returns
`receiptKind` + `walletSupport` on the `earn_quote`. `GET /earn/vaults` adds `chain=sol` and
`protocol=morpho|kamino`; `POST /earn/preview` accepts an optional `recipient`, validated with the
068 address checker for the receipt's chain kind. No live quote (`dry=false` still rejected).

### 5. Chat

`earn/parse.py` recognises Kamino explicitly (or the configured `SOL Balanced` / `kV-gtSOLb`
names), maps a Kamino request with no chain to `sol`, and resolves `SOL` to the configured vault.
Negatives keep generic vault deposits, comparative turns, swaps and bridges on the existing path.
The DAG labels the tool step "Kamino" and picks the origin route (Base USDC for a USDC funding
asset, Solana for SOL) unless the user says "from <chain>".

### 6. Scripts

`earn_registry_snapshot.py` merges Kamino into the shipped snapshot and prints kVault counts
(`--kamino-only` keeps the existing Morpho rows). `earn_dry_smoke.py` adds Base USDC 100, SOL 1,
Solana USDC 100, withdraw 1 kV → SOL and a $1000 cap check.

### 7. Phases

- **Phase B (pending):** shared zod fields for `protocol`, `receiptKind`, `walletSupport`; Kamino
  list/preview cards; Solana recipient paste + EVM/copy-address deposit affordances.
- **Phase C (pending, owner):** live Evm-wallet/copy-address deposit + withdraw using the 068
  confirm/status flow; client decisions on fee copy and USDC receipt availability.

## Reference facts (2026-11-01)

See `research.md`. Only one Kamino receipt exists in 1Click (`kV-gtSOLb`); no Kamino USDC receipt
exists today. `sUSDC` on Solana is "Spicy USDC", not Kamino.
