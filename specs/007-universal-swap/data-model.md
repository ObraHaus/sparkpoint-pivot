# Data Model: Universal Swap (Phase 1)

No database entities (the swap is on-chain + client-only). These are the in-app shapes the feature adds or
changes. Field notes call out invariants that tests must enforce.

## SwapToken (extended — `apps/web/src/lib/swap/tokens.ts`)

The token a user can pay or receive.

| Field | Type | Notes |
|---|---|---|
| `symbol` | string | Sanitized on-chain `symbol()` (or `bytes32`-decoded, or a truncated address label). Display-only; never a trust signal. |
| `name` | string? | NEW. Sanitized on-chain `name()`. |
| `address` | `0x${string}` | The ERC-20 address used on-chain. For native ETH this is WETH (routing). |
| `decimals` | number | **On-chain value, authoritative for scaling.** Clamp/reject `> 36`; `0` allowed but flagged. |
| `isNative` | boolean | true ⇒ native ETH (balance native, no approve for ETH-in, unwrap for ETH-out). |
| `source` | `'recommended' \| 'imported' \| 'native'` | NEW. Drives the picker section + badge. |
| `verified` | boolean | NEW. true ⇒ present in the curated `tokenList.ts` for this chain. Not a gate. |

**Invariants**: `decimals` is never taken from wire/agent/cache for parsing. `symbol` is sanitized before
display and before any comparison. `address` `0x0` ⇒ unconfigured (rejected by `isConfiguredToken`).

## RouteResult (new — `apps/web/src/lib/swap/route.ts`)

The chosen way from `tokenIn` to `tokenOut`.

```ts
type RouteResult =
  | { kind: 'single'; fee: number; amountOut: bigint; via: null }
  | { kind: 'multi';  path: Hex;   amountOut: bigint; via: 'WETH' | 'USDC' }
```

| Field | Notes |
|---|---|
| `kind` | `single` = one pool at `fee`; `multi` = encoded `path` through a hop asset. |
| `fee` | Best fee tier for the single-hop route (uint24). |
| `path` | Uniswap V3 packed path (`token,fee,token[,fee,token]`) for the multi-hop route. |
| `amountOut` | Gross quoted output (base units of `tokenOut`), already net of LP fees, before the 0.20% routing fee. |
| `via` | Hop asset used (multi only) — for the honest route summary. |
| `priceImpactBps` | (on the quote result) 0–10000, or `undefined` when it can't be computed (shown "unavailable", not 0). |

**Invariants**: native normalized to WETH before enumeration; best = max `amountOut`; all candidates revert
⇒ `noRoute`; a transport error on any candidate with no successful candidate ⇒ retryable `isError`, not
`noRoute`.

## SwapExec (extended — `apps/web/src/lib/swap/useExecuteSwapTx.ts`)

The resolved, ready-to-sign intent. Adds `path` for multi-hop; all existing fields kept.

| Field | Change | Notes |
|---|---|---|
| `path?` | NEW | Present ⇒ execute `exactInput(path,…)`; absent ⇒ `exactInputSingle(fee,…)`. |
| `fee` | unchanged | Used for the single-hop route. |
| `amountOutMinimum` | unchanged | **Gross** floor = `amountOutMinimum(grossOut, slippage)` — passed to the pay-leg. Never the net value. |
| `feeBips` | unchanged | 20 where a fee applies, else 0. Clamped `[0,100]`. |
| `feeRecipient?` | semantics change | Now `swapFeeRecipient ?? vault.feeRecipient()`; must be non-zero to activate the fee. |
| `needsApprove` / `approveResetToZero?` | extended | NEW flag for USDT-style non-zero→non-zero approvals (reset-to-zero leg). |

## RoutingFeeConfig (new — `packages/shared/src/addresses/types.ts`)

| Field | Type | Notes |
|---|---|---|
| `swapFeeRecipient?` | `Address` | NEW `AddressBook` field. Plain optional field, **NOT** a policy `TargetRef` (no `TARGET_REF_FIELD` / parity impact). Per chain. |

Derived (client): `feeExpected = !!swapFeeRecipient || !!vault` (synchronous); `feeReady = !!resolvedRecipient`;
`feeCollectibleOnChain` = network exposes the on-chain fee-split (from the D6 probe). Fee rate is fixed at
`ROUTING_FEE_BIPS = 20` in `math.ts` (unchanged).

## ImportedTokenList (new — `apps/web/src/lib/swap/importedTokens.ts`)

`localStorage` key `sp.swap.imported.v1`, shape `{ [chainId: number]: SwapToken[] }`, LRU-capped (~20).
Operations: `getImported(chainId)`, `addImported(chainId, token)`, `removeImported(chainId, address)`.
SSR-guarded (`typeof window`). **Scoped by chainId** — the same address is a different contract per chain.

## ProposedSwap (extended wire — `packages/shared/src/schemas/action.ts`)

`ProposedActionSchema` gains optional, additive fields (kept `.strict()`-compatible via web-first tolerant
parse; `asset` retained for back-compat):

| Field | Type | Notes |
|---|---|---|
| `tokenIn?` | `{ address, decimals?, symbol? }` | Pay token. `decimals`/`symbol` are HINTS; web re-resolves on-chain. |
| `tokenOut?` | `{ address, decimals?, symbol? }` | Receive token. Treated as unverified by default. |
| `chainId?` | number | Target network; reconciled against the connected wallet before quoting. |

Python mirror: `services/agent/.../coordinator/chat_blocks.py` `proposed_action_wire`. Additive fields only
— no `Asset` enum / `TargetRef` change (Constitution II/IV).
