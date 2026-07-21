# Internal Interface Contracts: Universal Swap (Phase 1)

This feature adds no HTTP endpoint. The "contracts" are (1) the internal TS module interfaces the two swap
surfaces depend on, (2) the on-chain ABI additions, and (3) the assistant proposed-action wire delta. Each
has a test obligation.

## 1. Token resolution — `apps/web/src/lib/swap/metadata.ts`

```ts
export interface ResolvedToken { address: `0x${string}`; symbol: string; name?: string; decimals: number }
export type ResolveResult = { ok: true; token: ResolvedToken } | { ok: false; reason: string }

// Reads decimals/symbol/name on-chain (multicall, allowFailure). Requires non-empty bytecode + readable
// decimals(). bytes32 fallback for symbol/name. Sanitizes strings. Clamps decimals (reject > 36).
export async function resolveErc20(chainId: number, address: `0x${string}`): Promise<ResolveResult>
export function sanitizeMetaString(raw: string): string   // strip control/zero-width, cap length, NFKC
```

**Contract test obligations**: resolves a normal ERC-20; decodes a `bytes32` symbol; **rejects** a non-
contract, a missing `decimals()`, and `decimals > 36`; sanitizes a homoglyph/zero-width/over-long symbol;
returns a truncated-address label when symbol+name both fail.

## 2. Path encoding — `apps/web/src/lib/swap/path.ts` (pure)

```ts
export function encodeDirect(tokenIn: Address, fee: number, tokenOut: Address): Hex        // 43 bytes
export function encodeTwoHop(a: Address, feeA: number, hop: Address, feeB: number, b: Address): Hex  // 66 bytes
```

**Contract test obligations**: byte-exact layout (`address|uint24|address[|uint24|address]`), directional
(tokenIn first), native→WETH substitution at the correct position for native-in / native-out.

## 3. Route selection — `apps/web/src/lib/swap/route.ts`

```ts
export interface RouteInput {
  chainId: number; quoter: Address; tokenIn: SwapToken; tokenOut: SwapToken;
  amountIn: bigint; weth: Address; usdc?: Address; usdcIsRoutingAsset: boolean;
}
export type RouteQuote =
  | { status: 'ok'; route: RouteResult; priceImpactBps?: number }
  | { status: 'noRoute' }
  | { status: 'error' };   // transport/RPC — retryable

export async function bestRoute(input: RouteInput): Promise<RouteQuote>
```

**Contract test obligations**: prefers the higher-output candidate; prunes via-WETH when a side is WETH and
via-USDC when `!usdcIsRoutingAsset`; `noRoute` only when all candidates revert; a transport error with no
successful candidate ⇒ `error` (not `noRoute`); native normalized before pruning.

## 4. Fee resolution — `apps/web/src/lib/swap/useSwapConfirm.ts`

```ts
// feeExpected is SYNCHRONOUS; only the recipient value is async.
feeExpected  = !!swapFeeRecipient || !!vault
feeRecipient = swapFeeRecipient ?? vaultFeeRecipientRead      // async
feeReady     = isNonZeroAddress(feeRecipient)
// exec is undefined while (feeExpected && !feeReady) — blocks, never a fee-free fallback.
```

**Contract test obligations**: fee chain with recipient pending ⇒ `exec === undefined` (Review/Confirm
disabled), NOT a fee-free swap; `swapFeeRecipient` set ⇒ fee path; unset + vault ⇒ vault fallback; unset +
no vault + no recipient ⇒ fee-free path with **no fee shown**; zero recipient ⇒ fee not activated.

## 5. ABI additions — `apps/web/src/lib/swap/abis.ts`

- `quoterV2Abi += quoteExactInput(bytes path, uint256 amountIn)` **nonpayable** →
  `(uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)`
  — **outputs are arrays** (per hop); decode accordingly.
- `swapRouter02Abi += exactInput((bytes path, address recipient, uint256 amountIn, uint256 amountOutMinimum))`
  **payable** → `uint256 amountOut` — no `deadline` field (deadline stays on `multicall`).

Existing `exactInputSingle`, `unwrapWETH9(+WithFee)`, `sweepTokenWithFee`, `refundETH`, `multicall`
unchanged.

## 6. Proposed-action wire delta — `packages/shared/src/schemas/action.ts` (+ Python mirror)

Additive optional fields (see data-model `ProposedSwap`). Retain `asset`. **Web deploys first**, tolerant
of the old single-asset shape. `inlineIntentFor(proposedAction)` forwards `{tokenIn, tokenOut, chainId}`
when present, else falls back to the recommended ETH↔USDC swap.

**Contract test obligations**: an old-shape block (asset only) still parses + renders (falls back); a
new-shape block forwards the pair; a proposal `chainId` ≠ wallet chain prompts a switch (no wrong-chain
quote); a proposed token is rendered unverified with its address.

## 7. On-chain probe (Phase C, 46630) — read-only

Verify the Synthra `SwapRouter02` (`0x3Ce9…58fE`) exposes `unwrapWETH9WithFee`, `sweepTokenWithFee`,
`exactInput`, and the `QuoterV2` exposes `quoteExactInput` (selector presence via `eth_getCode` /
`simulateContract` dry-run). Result gates whether the fee is taken in-swap, via fee-on-input, or the
network stays fee-free. No state change.
