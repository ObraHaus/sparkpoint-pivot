/**
 * Block-explorer link builder (DISPLAY plane).
 *
 * Turns a `(chainId, txHash)` into the canonical BaseScan URL the confirm receipt
 * links to ("View transaction ↗"). Pure + display-only: it holds no key, reads no
 * chain state, and never gates anything. An unknown chain or a missing hash yields
 * `undefined` (the caller then renders the same non-linking cite as the mock), so a
 * chain we can't link never fabricates a URL.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T046 (surface the real tx hash
 * in the deposit/withdraw confirm receipt).
 */

import type { Hex } from "viem";

/** Explorer roots per chain id (Base mainnet 8453 · Base Sepolia 84532 · Robinhood testnet 46630). */
const EXPLORER_ROOT: Record<number, string> = {
  8453: "https://basescan.org",
  84532: "https://sepolia.basescan.org",
  46630: "https://explorer.testnet.chain.robinhood.com", // §B3 Blockscout (uses /tx/{hash})
  // 31337 (local Anvil fork) has no public explorer → undefined (no link rendered).
};

/** The explorer URL for a transaction, or `undefined` when the chain/hash can't be linked. */
export function explorerTxUrl(chainId: number | undefined, hash: Hex | undefined): string | undefined {
  if (chainId === undefined || hash === undefined) return undefined;
  const root = EXPLORER_ROOT[chainId];
  return root === undefined ? undefined : `${root}/tx/${hash}`;
}

/** The explorer URL for an address, or `undefined` when the chain/address can't be linked. */
export function explorerAddressUrl(
  chainId: number | undefined,
  address: string | undefined,
): string | undefined {
  if (chainId === undefined || !address) return undefined;
  const root = EXPLORER_ROOT[chainId];
  return root === undefined ? undefined : `${root}/address/${address}`;
}
