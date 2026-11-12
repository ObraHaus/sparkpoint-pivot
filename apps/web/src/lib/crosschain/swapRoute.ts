/**
 * Pure routing decisions for the manual /swap page.
 *
 * `/swap` has two legitimate rails and must choose between them honestly:
 *   • same-chain EVM → the existing Uniswap V3 quote/execute path;
 *   • anything cross-chain, or a NEAR-origin swap → 1Click (quote → deposit → status).
 *
 * These helpers are pure so the selection, the amount guard and the synthetic preview block are
 * testable without a wallet, a network or React.
 */

import type { CrossChainQuoteBlock } from "@sparkpoint/shared/schemas";

import type { CrossChainAsset } from "./assets.ts";

export type SwapMode = "same-chain" | "cross-chain";

/** Connected on /swap means an EVM wallet OR a NEAR wallet — never only wagmi. */
export function isSwapConnected(input: {
  evmConnected: boolean;
  nearAccountId: string | null | undefined;
}): boolean {
  return input.evmConnected || !!input.nearAccountId;
}

/**
 * Default rail: an EVM wallet gets the same-chain form; otherwise (NEAR-only, or nothing yet) the
 * cross-chain form, which is the only rail a NEAR wallet can sign for.
 */
export function defaultSwapMode(input: {
  evmConnected: boolean;
  nearConnected: boolean;
}): SwapMode {
  return input.evmConnected ? "same-chain" : "cross-chain";
}

/** True when the two legs are not the same asset on the same chain. */
export function routeIsCrossChain(
  origin: Pick<CrossChainAsset, "key" | "chain">,
  destination: Pick<CrossChainAsset, "key" | "chain">,
): boolean {
  return origin.key !== destination.key || origin.chain !== destination.chain;
}

/**
 * A human amount is quotable only when it is positive and no more precise than the origin asset.
 * Returns a user-facing reason, or null when it is fine.
 */
export function crossChainAmountError(amount: string, decimals: number): string | null {
  const clean = amount.replace(/,/g, "").trim();
  if (!clean) return "Enter an amount to quote.";
  if (!/^\d+(?:\.\d+)?$/.test(clean)) return "Enter a positive number.";
  const [, fraction = ""] = clean.split(".");
  if (fraction.length > decimals) {
    return `${fraction.length} decimal places is more than this asset supports (${decimals}).`;
  }
  if (Number(clean) <= 0) return "Enter an amount greater than zero.";
  return null;
}

/**
 * Build the `preview` block the shared cross-chain card renders from a dry quote request. It carries
 * NO fabricated output — `amountOut`/`minAmountOut` are only ever filled from the agent's real quote
 * response, never by this builder.
 */
export function buildCrossChainPreviewBlock(
  origin: CrossChainAsset,
  destination: CrossChainAsset,
  amount: string,
): CrossChainQuoteBlock {
  return {
    type: "crosschain_quote",
    state: "preview",
    origin: {
      key: origin.key,
      chain: origin.chain,
      chainLabel: origin.chainLabel,
      symbol: origin.symbol,
      amount,
      assetId: origin.assetId,
      evmChainId: origin.evmChainId,
    },
    destination: {
      key: destination.key,
      chain: destination.chain,
      chainLabel: destination.chainLabel,
      symbol: destination.symbol,
      assetId: destination.assetId,
      addressKind: destination.addressKind,
    },
  };
}

/** Keys that identify an in-flight/target quote, so stale results never render for new inputs. */
export function crossChainQuoteKey(originKey: string, destinationKey: string, amount: string): string {
  return `${originKey}>${destinationKey}:${amount.trim()}`;
}
