"use client";

/**
 * bestRoute — the on-chain half of universal routing (feature 007 · US2).
 *
 * Quotes the pure-planned candidates (direct across fee tiers + 2-hop via WETH/USDC) on the direct-RPC
 * read plane (QuoterV2, `simulateContract`/`readContract` — never the agent) and returns the highest-output
 * route, honestly fail-closed. A pool that doesn't exist / has no liquidity REVERTS → that candidate is
 * dropped; a transport/RPC error with no successful candidate surfaces as a retryable `error` (never a
 * false `noRoute`). Price impact is measured by re-quoting a tiny reference trade along the WINNING route.
 */

import { BaseError, type Address, type Hex } from "viem";
import { getPublicClient } from "@/lib/chain/clients";
import { feeRouterAbi } from "@sparkpoint/shared/abis";
import { quoterV2Abi } from "./abis";
import { CHAIN_IDS } from "@sparkpoint/shared/chains";
import { planCandidates, pickBest, FEE_TIERS, FEE_TIER_1BP, type Candidate } from "./route.pure";

export type RouteResult =
  | { readonly kind: "single"; readonly fee: number; readonly amountOut: bigint; readonly via: null }
  | { readonly kind: "multi"; readonly path: Hex; readonly amountOut: bigint; readonly via: "WETH" | "USDC" };

export interface RouteInput {
  readonly chainId: number;
  readonly quoter: Address;
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly amountIn: bigint;
  readonly weth: Address;
  readonly usdc?: Address;
  readonly usdcIsRoutingAsset: boolean;
  /** true ⇒ quote direct pools only (the W.7 fee-router is single-hop by design). */
  readonly singleHopOnly?: boolean;
  /**
   * W.7 fix — when the chain routes through the FeeRouter, quote by SIMULATING that exact call
   * instead of QuoterV2. Robinhood Chain 4663 has NO working QuoterV2 (the address-book entry is a
   * dead stub), and the FeeRouter simulation is strictly better anyway: it is the very call that
   * will execute, so fee, wrapping/unwrapping and the pool all participate. `amountIn` is the GROSS
   * input (the router takes the fee itself).
   */
  readonly feeRouter?: Address;
  /** Simulation `from`/output recipient (the connected account). Required with `feeRouter`. */
  readonly recipient?: Address;
  /** Native-in swaps simulate with `msg.value = amountIn` (the router wraps it). */
  readonly fromNative?: boolean;
}

export type RouteQuote =
  | { readonly status: "ok"; readonly route: RouteResult; readonly priceImpactBps?: number }
  | { readonly status: "noRoute" }
  | { readonly status: "error" };

/**
 * A CONTRACT revert (the pool/tier doesn't exist or has no liquidity) means "skip this candidate". Any
 * OTHER error (transport/timeout/rate-limit) must propagate so the caller shows a retryable state instead
 * of a false "no liquidity". viem raises reverts as a `BaseError` chain; transport errors are not reverts.
 */
function isPoolRevert(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const walked = err.walk();
  const name = (walked as { name?: string })?.name ?? err.name;
  const msg = err.shortMessage ?? err.message ?? "";
  return /ContractFunction|Revert/i.test(name) || /revert|out of gas|no data/i.test(msg);
}

type Client = ReturnType<typeof getPublicClient>;

/**
 * Quote one direct pool.
 *
 * Default: `QuoterV2.quoteExactInputSingle` (nonpayable ⇒ simulateContract).
 * Fee-router chains (see {@link RouteInput.feeRouter}): simulate the router's own
 * `swapExactInputSingle`, which is the exact call that will execute — the only working quote
 * source on 4663.
 */
async function quoteSingle(
  client: Client,
  i: RouteInput,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  fee: number,
): Promise<bigint | undefined> {
  try {
    if (i.feeRouter && i.recipient) {
      const { result } = await client.simulateContract({
        address: i.feeRouter,
        abi: feeRouterAbi,
        functionName: "swapExactInputSingle",
        args: [
          {
            tokenIn,
            tokenOut,
            fee,
            recipient: i.recipient,
            // `amountIn` is the GROSS input: the router charges the 0.20% itself and swaps the net.
            amountIn,
            amountOutMinimum: 0n,
            deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
          },
        ],
        value: i.fromNative ? amountIn : 0n,
        account: i.recipient,
      });
      const out = result as bigint;
      return out > 0n ? out : undefined;
    }
    const { result } = await client.simulateContract({
      address: i.quoter,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    const out = result[0];
    return out > 0n ? out : undefined;
  } catch (err) {
    if (isPoolRevert(err)) return undefined;
    throw err;
  }
}

/** Quote one multi-hop path (QuoterV2.quoteExactInput; outputs are ARRAYS — amountOut is result[0]). */
async function quotePath(client: Client, quoter: Address, path: Hex, amountIn: bigint): Promise<bigint | undefined> {
  try {
    const { result } = await client.simulateContract({
      address: quoter,
      abi: quoterV2Abi,
      functionName: "quoteExactInput",
      args: [path, amountIn],
    });
    const out = result[0];
    return out > 0n ? out : undefined;
  } catch (err) {
    if (isPoolRevert(err)) return undefined;
    throw err;
  }
}

const quoteCandidate = (client: Client, i: RouteInput, c: Candidate, amountIn: bigint): Promise<bigint | undefined> =>
  c.kind === "single"
    ? quoteSingle(client, i, i.tokenIn, i.tokenOut, amountIn, c.fee)
    : quotePath(client, i.quoter, c.path, amountIn);

/** Best route for the pair + amount, or an honest `noRoute` / `error`. */
export async function bestRoute(input: RouteInput): Promise<RouteQuote> {
  const client = getPublicClient(input.chainId);
  // Robinhood mainnet's WETH/USDG pool is the 1bp (0.01%) tier, so probe it THERE — without adding a
  // tier to every other chain's quote (Base / Base Sepolia stay on the default FEE_TIERS, unchanged).
  const feeTiers =
    input.chainId === CHAIN_IDS.robinhoodMainnet ? [FEE_TIER_1BP, ...FEE_TIERS] : undefined;
  const candidates = planCandidates({
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    weth: input.weth,
    usdc: input.usdc,
    usdcIsRoutingAsset: input.usdcIsRoutingAsset,
    feeTiers,
    singleHopOnly: input.singleHopOnly,
  });

  const settled = await Promise.allSettled(
    candidates.map((c) => quoteCandidate(client, input, c, input.amountIn).then((out) => ({ c, out }))),
  );
  const scored = settled
    .filter((s): s is PromiseFulfilledResult<{ c: Candidate; out: bigint | undefined }> => s.status === "fulfilled")
    .map((s) => s.value)
    .filter((x): x is { c: Candidate; out: bigint } => x.out !== undefined)
    .map((x) => ({ ...x, amountOut: x.out }));

  const best = pickBest(scored);
  if (best === undefined) {
    if (settled.some((s) => s.status === "rejected")) return { status: "error" }; // transport → retryable
    return { status: "noRoute" }; // every candidate reverted → genuinely no liquidity
  }

  const route: RouteResult =
    best.c.kind === "single"
      ? { kind: "single", fee: best.c.fee, amountOut: best.amountOut, via: null }
      : { kind: "multi", path: best.c.path, amountOut: best.amountOut, via: best.c.via };

  // Price impact vs a tiny reference (0.1% of the trade, min 1 base unit) along the WINNING route.
  let priceImpactBps: number | undefined;
  const refIn = input.amountIn / 1000n > 0n ? input.amountIn / 1000n : 1n;
  if (refIn < input.amountIn) {
    const refOut =
      route.kind === "single"
        ? await quoteSingle(client, input, input.tokenIn, input.tokenOut, refIn, route.fee).catch(() => undefined)
        : await quotePath(client, input.quoter, route.path, refIn).catch(() => undefined);
    if (refOut !== undefined && refOut > 0n) {
      const num = route.amountOut * refIn;
      const den = refOut * input.amountIn;
      if (den > 0n) {
        const ratioBps = Number((num * 10_000n) / den);
        priceImpactBps = Math.max(0, 10_000 - ratioBps);
      }
    }
  }

  return { status: "ok", route, priceImpactBps };
}
