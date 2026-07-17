"use client";

/**
 * useSwapQuote — the READ half of the swap surface (Uniswap V3 QuoterV2).
 *
 * `quoteExactInputSingle` is `nonpayable`, so it can't use wagmi `useReadContract`; it's called via
 * the direct-RPC viem client (`getPublicClient(chainId).simulateContract`) — the same READ plane the
 * `/exit` path uses, never the agent/backend. It quotes ALL fee tiers and keeps the best output, and
 * measures price impact against a tiny reference trade (critical: the Base-Sepolia pool is thin).
 * Fail-closed: if no tier has a pool/liquidity it returns `noRoute` — never a fabricated number.
 */

import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { getPublicClient } from "@/lib/chain/clients";
import { quoterV2Abi } from "./abis";

/** Uniswap V3 fee tiers to probe (bps ×100): 0.05% · 0.3% · 1%. */
const FEE_TIERS: number[] = [500, 3000, 10000];

export interface SwapQuoteResult {
  /** Best-tier output (base units of tokenOut), or `undefined` when there's no route/quote. */
  readonly amountOut?: bigint;
  /** The fee tier (of FEE_TIERS) that produced the best output. */
  readonly fee?: number;
  /** Price impact in basis points (0–10000) vs a tiny reference trade; `undefined` when unknown. */
  readonly priceImpactBps?: number;
  /** No fee tier had a usable pool for this pair — honest "no liquidity" (not an error). */
  readonly noRoute: boolean;
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly refetch: () => void;
}

interface QuoteParams {
  readonly chainId: number | undefined;
  readonly quoter: Address | undefined;
  readonly tokenIn: Address | undefined;
  readonly tokenOut: Address | undefined;
  readonly amountIn: bigint | undefined;
  /** Decimals of tokenIn — sets the tiny reference size (0.001 token) for the price-impact estimate. */
  readonly decimalsIn: number;
  readonly enabled: boolean;
}

async function quoteOneTier(
  chainId: number,
  quoter: Address,
  tokenIn: Address,
  tokenOut: Address,
  amountIn: bigint,
  fee: number,
): Promise<bigint | undefined> {
  try {
    const client = getPublicClient(chainId);
    const { result } = await client.simulateContract({
      address: quoter,
      abi: quoterV2Abi,
      functionName: "quoteExactInputSingle",
      args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
    });
    const amountOut = result[0];
    return amountOut > 0n ? amountOut : undefined;
  } catch {
    return undefined; // no pool / no liquidity / revert on this tier — skip it
  }
}

export function useSwapQuote(params: QuoteParams): SwapQuoteResult {
  const { chainId, quoter, tokenIn, tokenOut, amountIn, decimalsIn, enabled } = params;
  const ready =
    enabled &&
    chainId !== undefined &&
    quoter !== undefined &&
    tokenIn !== undefined &&
    tokenOut !== undefined &&
    amountIn !== undefined &&
    amountIn > 0n &&
    tokenIn.toLowerCase() !== tokenOut.toLowerCase();

  const query = useQuery({
    queryKey: [
      "swap-quote",
      chainId,
      quoter,
      tokenIn,
      tokenOut,
      amountIn?.toString(),
    ],
    enabled: ready,
    staleTime: 10_000,
    retry: false,
    queryFn: async (): Promise<{ amountOut?: bigint; fee?: number; priceImpactBps?: number }> => {
      // Quote every tier; keep the best output.
      const outs = await Promise.all(
        FEE_TIERS.map((fee) =>
          quoteOneTier(chainId!, quoter!, tokenIn!, tokenOut!, amountIn!, fee).then((out) => ({
            fee,
            out,
          })),
        ),
      );
      const best = outs
        .filter((x): x is { fee: number; out: bigint } => x.out !== undefined)
        .sort((a, b) => (a.out < b.out ? 1 : -1))[0];
      if (best === undefined) return {};

      // Price impact vs a tiny reference trade (0.001 token) at the SAME best tier.
      let priceImpactBps: number | undefined;
      const refIn = 10n ** BigInt(decimalsIn) / 1000n;
      if (refIn > 0n && refIn < amountIn!) {
        const refOut = await quoteOneTier(chainId!, quoter!, tokenIn!, tokenOut!, refIn, best.fee);
        if (refOut !== undefined && refOut > 0n) {
          // impact = 1 − (out/amountIn)/(refOut/refIn) = 1 − (out·refIn)/(refOut·amountIn)
          const num = best.out * refIn;
          const den = refOut * amountIn!;
          if (den > 0n) {
            const ratioBps = Number((num * 10_000n) / den); // (executed/marginal) in bps
            priceImpactBps = Math.max(0, 10_000 - ratioBps);
          }
        }
      }
      return { amountOut: best.out, fee: best.fee, priceImpactBps };
    },
  });

  return {
    amountOut: query.data?.amountOut,
    fee: query.data?.fee,
    priceImpactBps: query.data?.priceImpactBps,
    noRoute: ready && query.isSuccess && query.data?.amountOut === undefined,
    isLoading: ready && query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
