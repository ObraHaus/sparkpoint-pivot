/**
 * Curated per-chain token list for the swap page.
 *
 * The repo has no token-metadata structure, so this is the small, honest source of truth for the
 * two tokens the alpha swaps on Base Sepolia: NATIVE ETH (routed through WETH) and the vault's
 * USDC (the Aave-market test token — the one you can then DEPOSIT into the vault). Addresses come
 * from the shared registry (`getAddresses`); symbols/decimals are pinned here (USDC 6dp, ETH 18dp).
 */

import { getAddresses } from "@sparkpoint/shared/addresses";

export interface SwapToken {
  readonly symbol: string;
  /** Decimals of the token amount the user enters/receives (native ETH + WETH are 18; USDC 6). */
  readonly decimals: number;
  /** The ERC-20 address used on-chain — for the native-ETH pseudo-token this is WETH (routing). */
  readonly address: `0x${string}`;
  /** true ⇒ NATIVE ETH: balance is native, ETH-in needs no ERC-20 approve, ETH-out is unwrapped. */
  readonly isNative: boolean;
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
  // The vault's USDC (== Aave reserve on testnet) and native ETH (routed via WETH).
  return [
    { symbol: "ETH", decimals: 18, address: book.weth, isNative: true },
    { symbol: "USDC", decimals: 6, address: book.usdc, isNative: false },
  ];
}

/** Zero address sentinel used to detect an unconfigured token (e.g. Robinhood testnet's zero USDC). */
export function isConfiguredToken(t: SwapToken): boolean {
  return !/^0x0{40}$/i.test(t.address);
}
