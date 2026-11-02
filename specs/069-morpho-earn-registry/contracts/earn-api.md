# Contract — `/earn/*` (feature 069, backend)

All routes require the same S2S bearer + account scoping as `api/crosschain.py` (`get_account`).
`POST /earn/preview` also uses a per-owner sliding-window limiter (120/h). No route signs, submits
or holds a key. `dry=false` is rejected in Phase A.

## `GET /earn/vaults`

Query: `chain` (base|eth|…), `asset` (USDC|WETH|USDT|cbBTC), `rail`
(`direct|oneclick_earn|intents_connect`), `min_tvl` (decimal string), `limit` (1..200, default 50),
`sort` (`tvl|apy`, default `tvl`).

```json
{
  "featureEnabled": true,
  "snapshot": {
    "state": "ready",
    "fetchedAt": "2026-11-01T02:31:00+00:00",
    "source": "persisted",
    "ageMinutes": 12
  },
  "count": 31,
  "vaults": [
    {
      "chain": "base",
      "chainId": 8453,
      "address": "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
      "version": "v1",
      "name": "Gauntlet USDC Prime",
      "symbol": "GTUSDC",
      "asset": {"address": "0x8335…2913", "symbol": "USDC", "decimals": 6},
      "listed": true,
      "tvlUsd": "420747952.12",
      "netApy": "4.41",
      "source": "morpho_api",
      "fetchedAt": "2026-11-01T00:00:00+00:00",
      "curatedDefault": true,
      "rails": {
        "available": ["direct", "oneclick_earn"],
        "direct": {"available": true, "reason": null, "note": "…native Morpho vault share…"},
        "oneclickEarn": {
          "available": true,
          "liveness": "live",
          "receipt": {
            "symbol": "gtUSDCp",
            "assetId": "nep141:base-0x0bb6….omft.near",
            "decimals": 18,
            "chain": "base",
            "wrapperAddress": "0x0bb6…",
            "underlyingVault": "0xee8f…"
          },
          "reason": null,
          "note": "…NEAR-issued receipt, not the native Morpho vault share…",
          "feeNote": "Includes 1Click's 0.25% keyless routing fee."
        },
        "intentsConnect": {
          "available": false,
          "reason": "Aurora Intents Connect is disabled in the earn config."
        }
      }
    }
  ]
}
```

`netApy` is a display percent string (the API fraction × 100). `tvlUsd` is a decimal string or
`null`. A missing snapshot returns `snapshot.state="unavailable"` and an empty list, not a 500.

## `GET /earn/vaults/{chain}/{address}`

`200` with `{featureEnabled, snapshot, vault}`; `404 NOT_FOUND` when the address is not in the
snapshot; `503 UPSTREAM_UNAVAILABLE` when the feature is disabled on the deployment.

## `POST /earn/preview`

```json
{
  "chain": "base",
  "vaultAddress": "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
  "originKey": "eth:USDC",
  "amount": "100",
  "dry": true
}
```

Returns the `earn_quote` ChatBlock wire plus a plain `text`:

```json
{
  "type": "earn_quote",
  "state": "preview",
  "rail": "oneclick_earn",
  "vault": {"…": "the same vault wire as above"},
  "origin": {"key": "eth:USDC", "chain": "eth", "chainLabel": "Ethereum", "symbol": "USDC",
             "amount": "100", "assetId": "nep141:eth-0x…omft.near", "evmChainId": 1},
  "amountIn": "100",
  "amountOut": "89.146629",
  "amountOutUsd": "99.55",
  "timeEstimateSec": 52,
  "feeNote": "Includes 1Click's 0.25% keyless routing fee.",
  "receiptNote": "This route delivers a NEAR-issued receipt token, not the native Morpho vault share. …",
  "quotedAt": "2026-11-01T02:31:00+00:00",
  "text": "Preview only — nothing is signed or sent. …"
}
```

- Same-chain origin (`originKey` on the vault's chain) → `rail="direct"`, no 1Click call, no
  `amountOut`.
- 1Click `400` (no liquidity / minimum) → `state="unavailable"` with `unavailableReason`; HTTP 200.
- Transport failure → `503 UPSTREAM_UNAVAILABLE`.
- Intents Connect when enabled → `rail="intents_connect"` with `steps`:
  `[{"to": asset, "functionSignature": "approve(address,uint256)", "parameters": [vault,
  "{MIN_AMOUNT_OUT}"], "value": "0", …}, {"to": vault, "functionSignature":
  "deposit(uint256,address)", "parameters": ["{MIN_AMOUNT_OUT}", "{USER_ADDRESS}"], …}]`.
- Validation: unknown chain/origin/rail, non-positive or over-precise amount → `400
  VALIDATION_ERROR`; `dry=false` → `400 VALIDATION_ERROR`; unknown vault → `404 NOT_FOUND`.

## Chat blocks

- `earn_vaults`: `{type, state: ready|unavailable, vaults[] (top 5), snapshotAgeMinutes?,
  snapshotSource?, unavailableReason?, note?}`.
- `earn_quote`: `{type, state: preview|unavailable, rail, vault, origin?, amountIn?, amountOut?,
  amountOutUsd?, timeEstimateSec?, feeNote?, receiptNote?, unavailableReason?, steps?, quotedAt?,
  expiresHint?}`.

Both are non-signable and are persisted with the conversation turn.
