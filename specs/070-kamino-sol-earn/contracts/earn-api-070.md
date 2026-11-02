# Contract — `/earn/*` additions (feature 070)

The 069 contract (`specs/069-morpho-earn-registry/contracts/earn-api.md`) is unchanged and
backward compatible. This file documents the additive fields and filters.

## Additive wire fields

- **Vault rows** may include `"protocol": "kamino"` (or `"morpho"`). The field is omitted for
  Morpho rows so the 069 fixtures stay byte-identical; a missing `protocol` means `"morpho"`.
  Kamino rows also use `"chain":"sol"`, `"chainId":0`, `"version":"kvault"`, and
  `"asset": {address:<Solana mint>, symbol:"SOL"|"USDC", decimals:...}`.
- **Receipt objects** may include `"protocol":"kamino"` and `"receiptKind":"native_shares"`.
  Both are omitted for the 069 Morpho wrapper defaults.
- **`earn_quote`** may include `"receiptKind":"native_shares"` and
  `"walletSupport": {"recipient":"paste_solana_address", "deposit":"evm_wallet"|"copy_address"}`.
  Omitted for Morpho wrapper previews.

Solana addresses are **case-sensitive** base58. `GET /earn/vaults/sol/{address}` and receipt
matching are exact for non-`0x` values.

## `GET /earn/vaults`

Adds `protocol=morpho|kamino`; `chain=sol` is now valid. Example:

```bash
GET /earn/vaults?chain=sol&protocol=kamino
```

```json
{
  "featureEnabled": true,
  "snapshot": {"state": "ready", "source": "persisted", "ageMinutes": 3},
  "count": 1,
  "vaults": [
    {
      "chain": "sol",
      "chainId": 0,
      "address": "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
      "version": "kvault",
      "name": "SOL Balanced",
      "symbol": "kV",
      "asset": {
        "address": "So11111111111111111111111111111111111111112",
        "symbol": "SOL",
        "decimals": 9
      },
      "listed": true,
      "tvlUsd": "2443425.6255213174393",
      "netApy": "4.451523617597486",
      "source": "kamino_api",
      "fetchedAt": "2026-11-01T02:32:00+00:00",
      "curatedDefault": true,
      "protocol": "kamino",
      "rails": {
        "available": ["oneclick_earn"],
        "direct": {
          "available": false,
          "reason": "Direct Kamino deposits require a Solana wallet, which the beta does not support yet.",
          "note": "The beta has no Solana wallet connection, so 1Click Earn is the only rail."
        },
        "oneclickEarn": {
          "available": true,
          "liveness": "live",
          "receipt": {
            "symbol": "kV-gtSOLb",
            "assetId": "nep141:sol-0xa69a….omdep.near",
            "decimals": 9,
            "chain": "sol",
            "wrapperAddress": "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
            "underlyingVault": "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
            "protocol": "kamino",
            "receiptKind": "native_shares"
          },
          "note": "This route delivers the native Kamino kVault share token on Solana — the receipt IS the vault share (not a NEAR-issued wrapper). …",
          "feeNote": "Includes 1Click's 0.25% keyless routing fee."
        },
        "intentsConnect": {
          "available": false,
          "reason": "Intents Connect cannot deliver SOL on this chain for this vault."
        }
      }
    }
  ]
}
```

## `POST /earn/preview`

Adds an optional body field `recipient` (≤80 chars). When the matched receipt is on `sol`, it must
be a base58 Solana address; an EVM `0x…` address returns
`400 VALIDATION_ERROR "recipient must be a base58 Solana address (32–44 characters)"`. When
omitted, a configured dry-probe address is used for the dry quote. `dry` remains `true`-only.

```json
{
  "chain": "sol",
  "vaultAddress": "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
  "originKey": "base:USDC",
  "amount": "100",
  "recipient": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

Response additions on the `earn_quote` block:

```json
{
  "type": "earn_quote",
  "state": "preview",
  "rail": "oneclick_earn",
  "receiptKind": "native_shares",
  "walletSupport": {"recipient": "paste_solana_address", "deposit": "evm_wallet"},
  "receiptNote": "This route delivers the native Kamino kVault share token on Solana …"
}
```

A 1Click `400 {"message":"No liquidity available"}` remains an HTTP `200` `state="unavailable"`
card. Transport failures remain `503 UPSTREAM_UNAVAILABLE`.

## Routes

068 `routes.json` adds `sol:USDC` (`nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near`,
6 dp, `address_kind:"sol"`) so a Solana-USDC origin is quotable. Existing route keys are unchanged.
