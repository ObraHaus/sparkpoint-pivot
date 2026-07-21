"use client";

/**
 * useSwapQuote — the READ half of the swap surface (feature 007 · US2: single-hop AND multi-hop).
 *
 * Delegates route-finding to `bestRoute` (QuoterV2 over direct + 2-hop-via-WETH/USDC candidates on the
 * direct-RPC read plane — never the agent). Keeps the fail-closed contract: a genuine no-liquidity result
 * is `noRoute`; a transport/RPC error is a retryable `isError` (never a false `noRoute`). Returns the
 * winning `route` so the caller can build the exact `SwapExec` (single `fee` vs multi `path`).
 */

import { useQuery } from "@tanstack/react-query";
import { type Address } from "viem";
import { bestRoute, type RouteResult } from "./route";

export interface SwapQuoteResult {
  /** Best-route output (base units of tokenOut), or `undefined` when there's no route/quote. */
  readonly amountOut?: bigint;
  /** The pool fee tier for a SINGLE-hop route; `undefined` for a multi-hop route (uses `route.path`). */
  readonly fee?: number;
  /** The winning route (single or multi) — fed into the `SwapExec`. */
  readonly route?: RouteResult;
  /** Price impact in basis points (0–10000) vs a tiny reference trade; `undefined` when unknown. */
  readonly priceImpactBps?: number;
  /** No candidate had a usable pool for this pair — honest "no liquidity" (not an error). */
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
  /** WETH (the universal hop asset) for this chain — required to enumerate multi-hop routes. */
  readonly weth: Address | undefined;
  /** USDC for this chain (a secondary hop asset) — omitted where it isn't a real routing asset. */
  readonly usdc?: Address;
  readonly usdcIsRoutingAsset: boolean;
  readonly enabled: boolean;
}

export function useSwapQuote(params: QuoteParams): SwapQuoteResult {
  const { chainId, quoter, tokenIn, tokenOut, amountIn, weth, usdc, usdcIsRoutingAsset, enabled } = params;
  const ready =
    enabled &&
    chainId !== undefined &&
    quoter !== undefined &&
    tokenIn !== undefined &&
    tokenOut !== undefined &&
    weth !== undefined &&
    amountIn !== undefined &&
    amountIn > 0n &&
    tokenIn.toLowerCase() !== tokenOut.toLowerCase();

  const query = useQuery({
    queryKey: ["swap-route", chainId, quoter, tokenIn, tokenOut, amountIn?.toString(), weth, usdc, usdcIsRoutingAsset],
    enabled: ready,
    staleTime: 10_000,
    retry: false,
    queryFn: async () => {
      const r = await bestRoute({
        chainId: chainId!,
        quoter: quoter!,
        tokenIn: tokenIn!,
        tokenOut: tokenOut!,
        amountIn: amountIn!,
        weth: weth!,
        usdc,
        usdcIsRoutingAsset,
      });
      if (r.status === "error") throw new Error("quote_unavailable"); // → isError (retryable), not noRoute
      return r; // "ok" | "noRoute"
    },
  });

  const data = query.data;
  const route = data?.status === "ok" ? data.route : undefined;
  return {
    amountOut: route?.amountOut,
    fee: route?.kind === "single" ? route.fee : undefined,
    route,
    priceImpactBps: data?.status === "ok" ? data.priceImpactBps : undefined,
    noRoute: ready && query.isSuccess && data?.status === "noRoute",
    isLoading: ready && query.isLoading,
    isError: query.isError,
    refetch: () => void query.refetch(),
  };
}
