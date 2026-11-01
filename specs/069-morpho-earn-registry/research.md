# Research — Morpho vaults, 1Click Earn and Aurora Intents Connect (verified 2026-11-01)

All facts below were verified from live **read-only** calls (Morpho GraphQL, 1Click `GET /tokens`
and `POST /quote` with `"dry": true`). No key, secret or env value is printed. No transaction was
signed or sent.

## 1. Morpho API (`https://api.morpho.org/graphql`)

- `vaults` (V1 / MetaMorpho) fields: `address name symbol listed chain{id network}
  asset{address symbol decimals} state{totalAssetsUsd netApy}`.
- `vaultV2s` (V2) fields: `address name symbol listed chain{id network} asset{address symbol
  decimals} totalAssetsUsd netApy avgNetApy` — **top-level, NOT under `state`**.
- Query V1 and V2 in **separate requests**; a combined query fails as a whole on `NOT_FOUND`.
- Paginate `first:N skip:M`, filter with `where:{chainId_in:[…]}`.
- Universe on 2026-11-01: **5,209 vaults** (V1 1,410 + V2 3,799), **317 listed**. Listed on Base
  **57**, Ethereum **166**.
- **Complexity finding:** V2 with `avgNetApy` costs ~1,725 complexity per item. `first:1000`
  (even for one chain) returns HTTP 403 `Query is too complex` (1,725,000 > 1,000,000). `first:500`
  is accepted, so V2 paginates at 500. V1 at 1,000 is fine.
- Enabled-chain fetch on 2026-11-01: V1 985 (Base + Ethereum), V2 3,237. After the shipped filters
  (`listed_only`, TVL ≥ $1M, USDC/WETH/USDT/cbBTC): **116 vaults** (Base 31, Ethereum 85; USDC 79,
  USDT 17, WETH 18, cbBTC 2).

## 2. 1Click Earn (`docs.near-intents.org`, `https://1click.chaindefuser.com/v0`)

- Earn is an ordinary `/v0/quote`: `destinationAsset` is an ERC-4626 **receipt** token for a deposit
  (or `originAsset` is the receipt for a withdraw). `recipientType` is `DESTINATION_CHAIN` or
  `INTENTS`.
- Receipt tokens are NEAR-issued ERC-4626 wrappers whose `asset()` is the **Morpho vault**, not the
  Morpho share. Four Morpho-backed receipts exist in `GET /v0/tokens` today (all 18 dp):

| receipt | asset id | chain | underlying Morpho vault |
|---|---|---|---|
| `gtUSDCp` | `nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near` | Base | Gauntlet USDC Prime V1 `0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61` |
| `mwUSDC` | `nep141:base-0x3388d158fdcc31398b99478420e6945cdaace009.omft.near` | Base | Moonwell Flagship USDC `0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca` |
| `sparkUSDC` | `nep141:base-0x7429743f8adbbe932b27bc02267b0e70f1ba688b.omft.near` | Base | Spark USDC `0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A` |
| `steakUSDC` | `nep141:eth-0xaf08e292d62df255f7953665a44ed65f0380aa60.omft.near` | Ethereum | Steakhouse USDC `0xBEEF01735c132Ada46AA9aA4c54623cAA92A64CB` |

- **Live today:** only `gtUSDCp`. A dry $100 Base USDC → `gtUSDCp` quote returned 201, ~89.15
  receipt units, ~52 s. `mwUSDC`, `sparkUSDC` and `steakUSDC` all returned
  `400 {"message":"No liquidity available"}`. A withdraw round trip on `gtUSDCp` was ~0.9%
  including 1Click's 0.25% keyless routing fee.
- Cloudflare blocks the default Python user agent; every request sends
  `User-Agent: sparkpoint-agent/1.0`.

## 3. Aurora Intents Deposits / Intents Connect

- Aurora **Intents Deposits** has no vault action yet ("Custom actions: coming soon").
- Aurora **Intents Connect** (`https://intents-connect-api.aurora.dev`): `POST
  /api/v1/executions/{wallet}` with an `x-api-key` from `studio.aurora.dev`; `dry:true` is supported.
  `GET /api/v1/supported_tokens` is public. It runs ≤30 EVM steps
  `{to, functionSignature, parameters, value, metadata}` from an MPC intermediary on the destination
  chain. `{MIN_AMOUNT_OUT}` is the post-fee amount; at least one step must call the destination
  token; the fee is in the destination token.
- For **any ERC-4626 Morpho vault**, `approve(address,uint256)(vault,{MIN_AMOUNT_OUT})` on the asset
  + `deposit(uint256,address)({MIN_AMOUNT_OUT}, userAddress)` on the vault produce native Morpho
  shares.
- Supported chains: Base, Ethereum, Arbitrum, Optimism, Polygon, Monad. **Not covered:** HyperEVM,
  Katana, Unichain, World Chain, Robinhood (coming soon), Tempo, Arc, Stable.
- Joined estimate: ~200 listed vaults (Base 48, Ethereum 130) whose asset Intents Connect can
  deliver; **127 with TVL ≥ $1M**.
- Same-chain: a Base wallet holding Base USDC can deposit into **any** Base Morpho vault directly
  with plain ERC-4626 — no intents and no receipt.

## 4. "Can we support all Morpho vaults?" — answer table

| Reach | Vaults | Rail | What the user gets |
|---|---|---|---|
| All Morpho vaults, same chain | 5,209 indexed (317 listed) | `direct` (ERC-4626) | Native Morpho vault share; no intents, no extra fee |
| Via 1Click Earn receipt | **1 live** (`gtUSDCp` → Gauntlet USDC Prime) of 4 configured receipts | `oneclick_earn` | NEAR-issued receipt, ~0.25% keyless fee, ~1 min |
| Via Aurora Intents Connect | ~200 listed (Base 48, Eth 130); **127 ≥ $1M** | `intents_connect` (needs key) | Native Morpho share; MPC intermediary runs approve+deposit |
| Enabled-chain snapshot in this deployment | 116 (Base 31, Eth 85) | direct + one receipt | The honest, currently-actionable list |

**Conclusion:** "all Morpho vaults" is a data/config question, not a code change. The registry
already indexes every V1/V2 vault; enabling a chain is a JSON edit, adding a 1Click receipt is a
JSON entry, and Aurora Intents Connect can reach any ERC-4626 Morpho vault on its six chains once a
key is provisioned — no per-vault code.

## Sources

- Morpho GraphQL: `https://api.morpho.org/graphql` (introspected + paginated reads, 2026-11-01).
- 1Click API docs: `https://docs.near-intents.org/integration/distribution-channels/1click-api/earn`
  and live `/v0/tokens` + `/v0/quote` (`dry:true`).
- Aurora Intents Connect: `https://intents-connect-api.aurora.dev` (public `GET /supported_tokens`
  documented; no POST was made — no API key exists).
- Repo: `data/morpho_api.py` (schema note + rate-limit warning), `api/vault_apy_poller.py`
  (background-refresh posture).

## Open questions for the client

1. **More 1Click receipts:** only one Morpho receipt has liquidity today. Should the client ask
   NEAR to wrap more Morpho vaults, or is the one receipt enough for the demo?
2. **Aurora key/procurement:** should we request Intents Connect access (covers ~127 vaults ≥ $1M),
   and is the MPC intermediary acceptable for a "non-custodial" flow?
3. **Chain enablement:** enable Arbitrum/Optimism/Polygon/Monad now (direct + Intents Connect), or
   keep Base + Ethereum only until the UI ships?
4. **Filter defaults:** is the $1M TVL floor and the USDC/WETH/USDT/cbBTC asset set right, or should
   the list include smaller/curated vaults for the demo?
5. **Fee copy:** confirm "0.25% keyless routing fee" is what the client wants shown, and whether a
   configured 1Click API key should be used in production.
