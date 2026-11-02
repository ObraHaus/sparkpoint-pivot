# Plan — 071 Rhea lending (NEAR) backend

**Branch:** `feat/071-rhea-near-earn` (stacked on 070 @ `db42aed`) · **Worktree:**
`~/project/sparkpoint-pivot-071`.

## Design

### 1. Config (`earn/earn.json`, `earn/config.py`)

- `earn.json` gains the `near` chain (`chain_id=0` non-EVM sentinel, `protocols:["rhea"]`) and a
  `rhea` section: `enabled`, `rpc_urls` (`free.rpc.fastnear.com`, `rpc.mainnet.near.org`),
  `logic_contract` (`contract.main.burrow.near`), `am_contract` (`multica.near`), `app_url`,
  `assets` (USDC enabled, USDT disabled), `mca_fee_fallback {USDC:"0.30"}`, `use_as_collateral`,
  `origins` (base/eth/sol USDC) and `default_origin` (`base:USDC`).
- `RheaAsset` / `RheaConfig` parse that block (defaults keep an old `earn.json` valid).
  `EarnConfig.rhea` is additive; `EarnRails.oneclick_rhea` gates the new rail.
- `known_protocol()` treats an explicit **rhea**/**burrow** mention as protocol `rhea` (before
  Kamino/Morpho).

### 2. Rhea module (`earn/rhea.py`)

- `NearRpcClient.view(contract, method, args)` → JSON-RPC `query`/`call_function`, base64 args,
  decoded byte-array result. Tries each configured URL on transport/HTTP/JSON-RPC errors and
  raises `RheaRpcError` only when all fail.
- `RheaViews` wraps the four reads with TTL caches: `mca_for_wallet` (~60 s), `create_mca_fee` and
  `asset` (~5 min). `positions` is read live per request.
- Pure helpers: `supply_message`, `register_message`, `message_to_sign`,
  `custom_recipient_msg`, `inner_units_to_decimal` (token + `extra_decimals`),
  `token_units_to_decimal`, `mca_fee_amount` (live raw → human; config fallback is human),
  `percent_string`, `parse_supplied_positions`.
- `fetch_rhea_vaults` builds one `VaultEntry` per enabled asset: `chain="near"`, `version="lending"`,
  `address=token_id` (case-preserved), `net_apy=supply_apr` (quantized to 4 fraction decimals for
  the "14.05%" display), `tvl_usd` = supplied amount for stablecoins (pegged ~$1) else null,
  `source="rhea_rpc"`, `protocol="rhea"`. Fail-open to an APY-less row when `get_asset` fails.
  `registry.fetch_vaults` merges these rows into the shared snapshot/refresh loop.

### 3. Rails (`earn/rails.py`)

`oneclick_rhea` is the only Rhea rail. Direct is hidden ("no NEAR wallet in the beta"); Intents
Connect does not apply. The rail carries the Rhea note, the keyless 0.25% fee note, an optional
1Click `assetId`, and the same live/no-liquidity liveness state keyed by the token id. A
`No liquidity` probe turns the rail off up front; unknown is not unavailable.

### 4. Service (`earn/service.py`)

`preview_for(..., wallet=...)` branches to `_rhea_preview` for `protocol=="rhea"`:
resolve the MCA (fail-open → first-deposit preview + a text warning), read the fee only on a first
deposit, build the exact message, dry-quote 1Click with `customRecipientMsg`, and return an
`earn_quote` with `rail="oneclick_rhea"`, protocol/firstDeposit/mca/recipient/message fields,
one-time fee, `netSupplied`, `supplyApy`, `source`, `withdraw` link. `refundTo` is the signed-in
EVM wallet (or the configured dry-probe address for a non-EVM origin). A 400 quote is an
`unavailable` card; transport errors propagate for the chat/API fallbacks.

`rhea_positions(wallet)` resolves the MCA, reads `get_account_all_positions`, fetches
`get_asset` per enabled asset (cached) for `extra_decimals`, and returns an `earn_positions` block
(`ready` / `empty` / `unavailable`). `rhea_withdraw_text()` returns the link-out copy.

### 5. Chat blocks (`coordinator/chat_blocks.py`)

`EarnQuoteBlock` gains additive optional Rhea fields (omitted for 069/070, so their fixtures stay
byte-identical); `protocol=="rhea"` emits `mca` explicitly (may be null). New
`EarnPositionsBlock` (`type="earn_positions"`) with camelCase wire: `state`, `mca`, `supplied`,
`totalUsd`, `source`, `appUrl`, `explainer`, `unavailableReason`, `note`.

### 6. Parser + DAG (`earn/parse.py`, `coordinator/dag.py`)

`_parse_rhea` handles positions, withdraw, APY/list and supply, only after an explicit Rhea/Burrow
mention, and returns `None` for bridge/swap/comparative phrasing. The DAG labels Rhea, handles the
new `positions` / `withdraw` kinds, and passes `chain.owner` as the wallet to previews/positions.
The origin route falls back to `base:USDC` (the beta is EVM) unless the user says "from <chain>".

### 7. HTTP (`api/earn.py`)

- `GET /earn/rhea/positions` uses `get_rhea_wallet` (a dependency over the session `AccountContext`;
  no wallet query parameter; tests override it).
- `GET /earn/vaults` accepts `protocol=rhea`, `chain=near`, `rail=oneclick_rhea`.
- `POST /earn/preview` passes `account.owner` as the wallet; `dry=false` remains rejected.

### 8. Scripts

`earn_registry_snapshot.py --rhea-only` keeps the existing Morpho/Kamino rows and refreshes only
Rhea; it prints asset APY, source and the one-time fee. `earn_dry_smoke.py` adds Base USDC 100
(supply and register messages), Base USDC 5000, an MCA lookup and a fee read.

### 9. Phases

- **Phase B (web, pending):** `protocol="rhea"` badge, first-deposit fee/net-supplied/message
  display, positions card, withdraw link. Shared zod fields for the new block/fields.
- **Phase C (pending, owner):** the real `personal_sign` for the first deposit, a live 1Click
  deposit flow, and the owner decision on in-app withdraw (currently a link-out).

## Reference facts (2026-11-01)

See `research.md`: contract views (`multica.near`, `contract.main.burrow.near`), dry quotes
(Base USDC 100 → 99.9808 supply / 99.9894 register; 5000 → 4999.04), the Rhea UI reading
("USDC Native — Supply APY 14.05%"), and the SDK README's cross-chain supply / MCA sections.
