# Contract — `/earn/*` additions (feature 071, Rhea on NEAR)

The 069 (`earn-api.md`) and 070 (`earn-api-070.md`) contracts are unchanged and backward
compatible. This file documents the additive Rhea fields, the new block and the new route.

All routes keep the same S2S bearer + account-scoping dependencies and the per-owner rate limiter.
Nothing signs, submits or holds a key; previews are `dry=true` only.

## Vault rows

`GET /earn/vaults` may return rows with `"protocol":"rhea"`, `"chain":"near"`, `"chainId":0`,
`"version":"lending"`, `"address":<token id>` (case-preserved), `"name":"Rhea Lending USDC"`,
`"symbol":"USDC"`, `"asset":{"address":<token id>,"symbol":"USDC","decimals":6}`,
`"source":"rhea_rpc"`, `"netApy":"14.05"` (display percent) and `"tvlUsd"` (stablecoin estimate).
The rail is `oneclick_rhea`.

```bash
GET /earn/vaults?chain=near&protocol=rhea
GET /earn/vaults?rail=oneclick_rhea
```

`chain=near` and `protocol=rhea` are now valid; `protocol` accepts `morpho|kamino|rhea` and
`rail` accepts `direct|oneclick_earn|oneclick_rhea|intents_connect`.

```json
{
  "chain": "near",
  "chainId": 0,
  "address": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "version": "lending",
  "name": "Rhea Lending USDC",
  "symbol": "USDC",
  "asset": {
    "address": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
    "symbol": "USDC",
    "decimals": 6
  },
  "listed": true,
  "tvlUsd": "12733803.142795182964809779",
  "netApy": "14.05",
  "source": "rhea_rpc",
  "fetchedAt": "2026-11-01T04:06:00+00:00",
  "protocol": "rhea",
  "curatedDefault": false,
  "rails": {
    "available": ["oneclick_rhea"],
    "direct": {
      "available": false,
      "reason": "Rhea lending is on NEAR; the beta has no NEAR wallet. Supply runs through NEAR Intents 1Click instead."
    },
    "oneclickRhea": {
      "available": true,
      "liveness": "unknown",
      "reason": "Liquidity has not been probed yet; a preview asks 1Click for a dry quote.",
      "note": "Supplies into your Rhea (Burrow) account on NEAR through NEAR Intents 1Click — no NEAR wallet, gas or chain switch. Withdraw on app.rhea.finance with the same wallet.",
      "feeNote": "Includes 1Click's 0.25% keyless routing fee. A one-time 0.30 USDC Rhea account fee applies on the first deposit only.",
      "assetId": "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"
    },
    "intentsConnect": {
      "available": false,
      "reason": "Intents Connect does not apply to Rhea supply."
    }
  }
}
```

## `POST /earn/preview` (protocol rhea)

```json
{
  "chain": "near",
  "vaultAddress": "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1",
  "originKey": "base:USDC",
  "amount": "100",
  "dry": true
}
```

The wallet is the **signed-in session wallet** (`X-Owner`), never a body/query parameter. The
response is the `earn_quote` wire plus `text`:

```json
{
  "type": "earn_quote",
  "state": "preview",
  "rail": "oneclick_rhea",
  "protocol": "rhea",
  "vault": {"…": "the Rhea vault row above"},
  "origin": {"key": "base:USDC", "chain": "base", "chainLabel": "Base", "symbol": "USDC",
             "amount": "100", "assetId": "nep141:base-0x8335….omft.near", "evmChainId": 8453},
  "amountIn": "100",
  "amountOut": "99.9808",
  "amountOutUsd": "99.9808",
  "timeEstimateSec": 35,
  "feeNote": "Includes 1Click's 0.25% keyless routing fee.",
  "receiptNote": "Supplies into your Rhea (Burrow) account on NEAR through NEAR Intents 1Click — …",
  "firstDeposit": true,
  "mca": null,
  "recipient": "multica.near",
  "customRecipientMsg": "{\"w\":[{\"EVM\":\"d8dA…\"}],\"b\":{\"r\":\"BurrowRegisterAndSupply\"},\"s\":[\"00…\"]}",
  "messageToSign": "[{\"EVM\":\"d8dA…\"}]",
  "oneTimeFee": {
    "amount": "0.30",
    "symbol": "USDC",
    "reason": "one-time Rhea account fee — first deposit only"
  },
  "netSupplied": "99.6808",
  "supplyApy": "14.05%",
  "source": {
    "kind": "contract",
    "contract": "contract.main.burrow.near",
    "method": "get_asset",
    "field": "supply_apr",
    "uiUrl": "https://app.rhea.finance/lending",
    "fetchedAt": "2026-11-01T04:06:00+00:00",
    "stale": false
  },
  "withdraw": {
    "kind": "external_link",
    "url": "https://app.rhea.finance/lending",
    "note": "Withdraw on Rhea with the same wallet"
  },
  "quotedAt": "2026-11-01T04:10:00+00:00",
  "text": "Preview only — nothing is signed or sent. …"
}
```

- **Existing MCA:** `firstDeposit=false`, `mca=<id>`, `recipient=<id>`, `oneTimeFee` and
  `messageToSign` are absent, and `customRecipientMsg` uses `BurrowSupply`.
- **First deposit:** `recipient="multica.near"`, `messageToSign` is present, the one-off fee is
  shown and `netSupplied = amountOut − fee`. The `s` signature in `customRecipientMsg` is a dry
  placeholder until Phase C.
- `customRecipientMsg` is non-secret business data (it contains no private key). The real
  `personal_sign` is Phase C.
- An RPC failure still renders a preview: it assumes a first deposit (with a text warning) and
  `source.stale` reflects the snapshot age.
- 1Click `400 No liquidity available` → `state="unavailable"` with a "try a smaller amount" reason
  (HTTP 200). Transport failure → `503 UPSTREAM_UNAVAILABLE`. `dry=false` → `400 VALIDATION_ERROR`.

## `GET /earn/rhea/positions`

Read-only NEAR view for the **signed-in wallet**. No wallet query/body parameter is accepted in
production; tests override the `get_rhea_wallet` dependency.

```json
{
  "type": "earn_positions",
  "state": "ready",
  "mca": "abc.multica.near",
  "supplied": [
    {"symbol": "USDC", "amount": "100", "apy": "14"}
  ],
  "totalUsd": "100",
  "source": {
    "kind": "contract",
    "contract": "contract.main.burrow.near",
    "method": "get_account_all_positions",
    "field": "supplied",
    "uiUrl": "https://app.rhea.finance/lending",
    "fetchedAt": "2026-11-01T04:10:00+00:00"
  },
  "appUrl": "https://app.rhea.finance/lending",
  "note": "Read-only view of your Rhea (Burrow) account. Supply/withdraw happen on Rhea with the same wallet.",
  "text": "Your Rhea positions on NEAR (abc.multica.near) — read-only, nothing was signed or sent: …"
}
```

- `state="empty"` + `explainer` when the wallet has no MCA, or when the MCA has no supplied
  positions / the account is unknown (`get_account_all_positions → null`).
- `state="unavailable"` + `unavailableReason` when the NEAR RPC read fails; `appUrl` is still
  provided.
- `supplied[].amount` is inner units converted with `token decimals + extra_decimals`;
  `supplied[].apy` is the contract's `apr` as a display percent (or the asset `supply_apr`).
  `totalUsd` is a stablecoin sum estimate (USDC/USDT), omitted when zero.

## Chat blocks

- `earn_quote` gains the optional Rhea fields above. For 069/070 they are omitted, so those
  fixtures are byte-identical; `mca` is emitted (possibly `null`) only when `protocol="rhea"`.
- New `earn_positions` block: `{type, state: ready|empty|unavailable, mca, supplied[], totalUsd?,
  source?, appUrl?, explainer?, unavailableReason?, note?}`.
- Both are non-signable and are persisted with the conversation turn. The SSE path emits
  `earn_positions` like any other block.
