# Research — Kamino kVaults and 1Click Earn (verified 2026-11-01)

All facts below come from live **read-only** calls: 1Click `GET /v0/tokens` and
`POST /v0/quote` with `"dry": true`, and Kamino's public `GET /kvaults/vaults` /
`GET /kvaults/{address}/metrics`. No key, secret or env value is printed; no transaction was signed
or sent.

## 1. 1Click Earn receipts

`GET /v0/tokens` (210 tokens) contains exactly **one** Kamino receipt:

| field | value |
|---|---|
| symbol | `kV-gtSOLb` |
| assetId | `nep141:sol-0xa69aa1bcb03a369e338156a8718ad60271145803.omdep.near` |
| blockchain | `sol` |
| decimals | 9 |
| contractAddress (Solana mint) | `5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK` |
| price (then) | ~$100.8 |

That mint is the **sharesMint of Kamino kVault** `DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg`
(name "SOL Balanced", `tokenMint` = `So11111111111111111111111111111111111111112` = SOL, 9 dp,
management/performance fee 0). The user therefore receives **native Kamino vault shares** — unlike
069's Morpho receipts, which are NEAR-issued ERC-4626 wrappers.

**No Kamino USDC vault is in 1Click Earn today.** `sUSDC` on `sol` in `/v0/tokens` is "Spicy
USDC", **not** Kamino — do not map it.

### Dry quotes observed (2026-11-01)

| route | result |
|---|---|
| Base USDC 100 → `kV-gtSOLb`, recipient Solana, `DESTINATION_CHAIN` | `201`, ~0.984 kV (~$99.2), ~47 s; INTENTS: 0.9868 |
| SOL 1 → `kV-gtSOLb` | `201`, ~0.9407 kV, ~32 s |
| Solana USDC 100 → `kV-gtSOLb` | `201`, ~0.9835 kV |
| `kV-gtSOLb` 1 → SOL | `201`, ~1.0506 SOL |
| `kV-gtSOLb` 1 → Base USDC | `201`, ~100.24 USDC, ~37 s |
| Base USDC 500 → `kV-gtSOLb` | OK |
| Base USDC 700 / 1000 → `kV-gtSOLb` | `400 {"message":"No liquidity available"}` |

The keyless 0.25% routing fee applies. Surface the size cap as an `unavailable` card with the hint
"try a smaller amount".

### Wallet support in the beta

The web uses wagmi `injected()` (EVM only) and has **no Solana wallet adapter**. A Solana recipient
must be a **pasted base58 address** (068 `sol` kind). SOL-origin deposits and kV withdrawals use the
068 copy-address deposit fallback. A Base-USDC-origin deposit can be paid from the connected EVM
wallet, but the recipient must still be a Solana address; `refundTo` is the origin-chain address.
An EVM `0x…` recipient is **not** valid for a `sol` receipt.

## 2. Kamino public API (`https://api.kamino.finance`)

`GET /kvaults/vaults` → JSON list, **194 vaults**, ~400 KB. Fields used: `address`,
`state{name, tokenMint, tokenMintDecimals, sharesMint, sharesMintDecimals, sharesIssued, prevAum,
managementFeeBps, performanceFeeBps, depositCap, …}`. Mint distribution: **110** have
the USDC mint (public Solana USDC mint address EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v) as their deposit mint, **23** have SOL.

`GET /kvaults/{address}/metrics` → `{apy (fraction string), apy7d, apy30d, apy90d,
tokensInvestedUsd, tokensPerShare, sharePrice, tokenPrice, numberOfHolders, …}`. For `DcCRSd…` on
2026-11-01: `apy="0.04451523617597486"`, `tokensInvestedUsd="2443425.6255213174393"`,
`sharePrice="100.5717"`, 338 holders.

The list endpoint must only be called from the background refresher / snapshot script, never from a
request handler.

## 3. Design conclusions

- The registry already answers "which vaults can this deployment reach"; Kamino is one more
  protocol with its own fetcher and the same snapshot/rails.
- The one actionably live Kamino route is a native-share deposit into SOL Balanced via
  `kV-gtSOLb`. A Kamino USDC vault becomes available by adding it to `kamino.vaults` **and** adding
  a 1Click receipt — both data edits.
- The 069 Morpho wrapper note must not be reused for Kamino; label the native share honestly.

## Sources

- 1Click live `GET /v0/tokens` + `POST /v0/quote` (`dry:true`), 2026-11-01.
- Kamino `https://api.kamino.finance/kvaults/vaults` and
  `/kvaults/DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg/metrics`, 2026-11-01.
- 1Click Earn docs: `https://docs.near-intents.org/integration/distribution-channels/1click-api/earn`.
- Repo: 069 `research.md`, `crosschain/addresses.py` (sol base58), `earn/registry.py` snapshot
  posture.

## Open questions for the owner

1. **Kamino USDC:** no 1Click receipt exists. Ask NEAR to wrap a Kamino USDC kVault, or keep SOL
   Balanced as the demo until one is listed?
2. **Size cap:** $500 quotes, $700/$1000 answer no liquidity. Should the UI cap the input or just
   show the honest "try a smaller amount" message?
3. **Fee copy:** keep "0.25% keyless routing fee", and should production use a configured 1Click
   key?
4. **Phase C wallet:** when a Solana wallet adapter ships, should direct kVault deposits replace the
   1Click receipt path, or coexist?
