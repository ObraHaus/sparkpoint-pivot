/**
 * Curated per-chain token list for the swap page.
 *
 * The repo has no token-metadata structure, so this is the small, honest source of truth for the
 * two tokens the alpha swaps on Base Sepolia: NATIVE ETH (routed through WETH) and the vault's
 * USDC (the Aave-market test token — the one you can then DEPOSIT into the vault). Addresses come
 * from the shared registry (`getAddresses`); symbols/decimals are pinned here (ETH 18dp; USDC 6dp on
 * Base, 18dp on Robinhood testnet — see USDC_DECIMALS).
 */

import { getAddresses } from "@sparkpoint/shared/addresses";

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

/** Where a {@link SwapToken} came from — drives the picker section + the verified/unverified badge. */
export type TokenSource = "recommended" | "imported" | "native";

export interface SwapToken {
  readonly symbol: string;
  /** Decimals of the token amount the user enters/receives (native ETH + WETH are 18; USDC 6). Always
   * the ON-CHAIN value for a pasted token (resolved via metadata.ts) — never a wire/agent/cached hint. */
  readonly decimals: number;
  /** The ERC-20 address used on-chain — for the native-ETH pseudo-token this is WETH (routing). */
  readonly address: `0x${string}`;
  /** true ⇒ NATIVE ETH: balance is native, ETH-in needs no ERC-20 approve, ETH-out is unwrapped. */
  readonly isNative: boolean;
  /** Human name (`name()`), when known — display only. */
  readonly name?: string;
  /** Provenance: native ETH, a curated recommended token, or a user-imported custom token. */
  readonly source?: TokenSource;
  /** true ⇒ the ADDRESS is in the curated verified set (tokenList). Never inferred from the symbol. */
  readonly verified?: boolean;
}

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
  ];
}

/**
 * The recommended (one-tap) tokens for `chainId` — the honest alias the universal-swap picker uses. Same
 * output as {@link swapTokens}; kept as a clearer name now that arbitrary imported tokens also exist.
 */
export const recommendedTokens = swapTokens;

/** Zero address sentinel used to detect an unconfigured token (a chain whose book leaves it at 0x0). */
export function isConfiguredToken(t: SwapToken): boolean {
  return !/^0x0{40}$/i.test(t.address);
}
