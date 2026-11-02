# Contract — cross-chain API + chat block (068)

All routes require the normal S2S bearer plus `X-Account` / `X-Owner` / `X-Chain-Id` (parsed by
`RequestContextMiddleware`; `get_account` is the route dependency). Quote/submit add a per-wallet
rate limit (120/h). A non-2xx response uses the canonical §1.5 envelope.

Nothing here returns a signature this service created, calldata, or a signable bundle.

---

## `GET /crosschain/assets`

```jsonc
{
  "featureEnabled": true,
  "slippageBps": 100,
  "deadlineMinutes": 30,
  "assets": [
    {
      "key": "base:USDC",
      "chain": "base",
      "chainLabel": "Base",
      "evmChainId": 8453,
      "symbol": "USDC",
      "assetId": "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near",
      "decimals": 6,
      "addressKind": "evm",
      "enabled": true
    },
    {
      "key": "tron:USDT",
      "chain": "tron",
      "chainLabel": "Tron",
      "evmChainId": null,
      "symbol": "USDT",
      "assetId": "nep141:tron-d28a265909efecdcee7c5028585214ea0b96f015.omft.near",
      "decimals": 6,
      "addressKind": "tron",
      "enabled": false,
      "unavailableReason": "1Click is not quoting Tron payouts right now"
    }
  ]
}
```

No 1Click URL or key material is returned.

---

## `POST /crosschain/quote`

```jsonc
{
  "originKey": "base:USDC",
  "destinationKey": "btc:BTC",
  "amount": "5,000",          // human units; commas allowed; validated against origin decimals
  "recipient": "bc1q…",       // required when dry=false; validated per destination addressKind
  "refundTo": "0x…",          // required when dry=false; validated per origin addressKind
  "dry": true                 // DEFAULT true
}
```

### Preview (`dry=true`)

```jsonc
{
  "state": "preview",
  "origin": { "key": "base:USDC", "chain": "base", "chainLabel": "Base", "symbol": "USDC",
              "amount": "5000", "assetId": "…", "evmChainId": 8453 },
  "destination": { "key": "btc:BTC", "chain": "btc", "chainLabel": "Bitcoin", "symbol": "BTC",
                   "assetId": "…", "addressKind": "btc" },
  "amountOut": "0.06439596",
  "amountOutUsd": "4986.694350",
  "amountInUsd": "5000.000000",
  "minAmountOut": "0.063752",
  "timeEstimateSec": 480,
  "slippageBps": 100,
  "feeNote": "Includes 1Click's 0.25% keyless routing fee.",  // omitted with an API key
  "quotedAt": "2026-11-01T00:19:48.065Z",
  "expiresHint": "Quote expires in about 30 minutes."
}
```

### Confirm (`dry=false`)

Same shape with `state: "live"`, plus `depositAddress`, `deadline`, `quoteId`. The quote is
persisted in `crosschain_quotes` for `X-Owner` before the response is returned. If 1Click returns
no deposit address, the route fails closed with `UPSTREAM_UNAVAILABLE` and persists nothing.

### Unavailable (`200`, not an error)

```jsonc
{
  "state": "unavailable",
  "origin": { … },
  "destination": { … },
  "slippageBps": 100,
  "quotedAt": "…",
  "unavailableReason": "1Click is not quoting Tron payouts right now"
}
```

This covers a disabled asset and a 1Click `400` (`Quoting for this pair is not available`,
`No liquidity available`, minimum amount). Unknown keys / bad amounts / invalid confirm addresses
are `400 VALIDATION_ERROR`; transport failure is `503 UPSTREAM_UNAVAILABLE`.

---

## `POST /crosschain/deposit/submit`

```jsonc
{ "depositAddress": "0x…", "txHash": "0x…" }
```

Only for a deposit address owned by `X-Owner`; otherwise `404 NOT_FOUND` (no existence leak).
Forwards to 1Click's optional speed-up endpoint and returns:

```jsonc
{ "ok": true, "depositAddress": "0x…", "result": { } }
```

---

## `GET /crosschain/status?depositAddress=0x…`

Only for an owned address. Returns and records the last observed status:

```jsonc
{
  "status": "PROCESSING",
  "depositAddress": "0x…",
  "swapDetails": { }
}
```

Statuses: `PENDING_DEPOSIT | KNOWN_DEPOSIT_TX | PROCESSING | SUCCESS | INCOMPLETE_DEPOSIT |
REFUNDED | FAILED`.

---

## Chat block — `crosschain_quote`

Added to the shared ChatBlock union (frontend Phase 2). It is **not signable** and carries no
calldata.

```jsonc
{
  "type": "crosschain_quote",
  "state": "preview",                 // "preview" | "unavailable"
  "origin": {
    "key": "base:USDC", "chain": "base", "chainLabel": "Base", "symbol": "USDC",
    "amount": "5000", "assetId": "…", "evmChainId": 8453
  },
  "destination": {
    "key": "btc:BTC", "chain": "btc", "chainLabel": "Bitcoin", "symbol": "BTC",
    "assetId": "…", "addressKind": "btc"
  },
  "amountOut": "0.06439596",
  "amountOutUsd": "4986.694350",
  "amountInUsd": "5000.000000",
  "minAmountOut": "0.063752",
  "timeEstimateSec": 480,
  "slippageBps": 100,
  "feeNote": "Includes 1Click's 0.25% keyless routing fee.",
  "unavailableReason": "…",           // only when state = unavailable
  "quotedAt": "2026-11-01T00:19:48.065Z",
  "expiresHint": "Quote expires in about 30 minutes."
}
```

A short `text` block precedes it in chat. `amountOut` / `minAmountOut` are human decimal strings
(not base units). The UI owns the mainnet-funds warning and every confirm/deposit interaction.
