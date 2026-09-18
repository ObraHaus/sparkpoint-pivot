/**
 * Curated per-chain token list for the swap page.
 *
 * The repo has no token-metadata structure, so this is the small, honest source of truth for the
 * two tokens the alpha swaps on Base Sepolia: NATIVE ETH (routed through WETH) and the vault's
 * USDC (the Aave-market test token — the one you can then DEPOSIT into the vault). Addresses come
 * from the shared registry (`getAddresses`); symbols/decimals are pinned here (ETH 18dp; USDC 6dp on
 * Base, 18dp on Robinhood testnet — see USDC_DECIMALS).
 *
 * The pure data + helpers live in `tokens.pure.ts` (re-exported here) so node:test can load them
 * without the address-book bundle; this module adds the per-chain lookups.
 */

import { getAddresses } from "@sparkpoint/shared/addresses";
import { RH_STOCK_TOKENS, type SwapToken } from "./tokens.pure";

export type { SwapToken, TokenSource } from "./tokens.pure";
export { RH_STOCK_TOKENS, formatSeedAmount, isConfiguredToken } from "./tokens.pure";

/**
 * USDC decimals PER CHAIN. Base Sepolia / Base mainnet USDC is 6dp, but Robinhood testnet's (Synthra
 * pool) "USDC" is 18dp — verified on-chain. Getting this wrong mis-scales every amount by 1e12.
 */
const USDC_DECIMALS: Record<number, number> = {
  46630: 18, // Robinhood Chain Testnet — this token reports decimals() == 18
  4663: 6, // Robinhood Chain mainnet — the stable is USDG, 6dp (verified on-chain 2026-09-10)
};
const DEFAULT_USDC_DECIMALS = 6;

// The stablecoin's SYMBOL per chain. On Robinhood mainnet (4663) the stable is USDG, not USDC —
// naming it honestly (never claiming "USDC" for a different token) is Principle III.
const STABLE_SYMBOL: Record<number, string> = {
  4663: "USDG", // Robinhood Chain mainnet
};
const DEFAULT_STABLE_SYMBOL = "USDC";

// Curated one-tap tokens beyond ETH + the stable, per chain — ONLY addresses verified on-chain with a
// live Uniswap V3 pool (never fabricated; a wrong "verified" address is a safety bug). Any other ERC-20
// is still paste-importable. See `RH_STOCK_TOKENS` for the 4663 Stock Token provenance + checks.
const CURATED_ONETAP: Record<number, readonly SwapToken[]> = {
  4663: RH_STOCK_TOKENS,
};

/**
 * The tokens offered on `chainId`, or `[]` when the chain isn't a supported swap chain (fail-closed
 * — `getAddresses` throws on unsupported chains, so we never fabricate a token).
 */
export function swapTokens(chainId: number | undefined): SwapToken[] {
  if (chainId === undefined) return [];
  let book;
  try {
    book = getAddresses(chainId);
  } catch {
    return [];
  }
  // Native ETH (routed via WETH) + USDC. USDC decimals are chain-specific (6 on Base, 18 on 46630).
  // Both are recommended + verified (their addresses come from the shared registry, the source of truth).
  return [
    { symbol: "ETH", decimals: 18, address: book.weth, isNative: true, source: "native", verified: true },
    {
      symbol: STABLE_SYMBOL[chainId] ?? DEFAULT_STABLE_SYMBOL,
      decimals: USDC_DECIMALS[chainId] ?? DEFAULT_USDC_DECIMALS,
      address: book.usdc,
      isNative: false,
      source: "recommended",
      verified: true,
    },
    ...(CURATED_ONETAP[chainId] ?? []),
  ];
}

/**
 * The recommended (one-tap) tokens for `chainId` — the honest alias the universal-swap picker uses. Same
 * output as {@link swapTokens}; kept as a clearer name now that arbitrary imported tokens also exist.
 */
export const recommendedTokens = swapTokens;
