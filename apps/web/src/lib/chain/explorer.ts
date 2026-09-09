/**
 * Block-explorer link builder (DISPLAY plane).
 *
 * Turns a `(chainId, txHash)` into the canonical explorer URL the confirm receipt
 * links to ("View transaction ↗"). Pure + display-only: it holds no key, reads no
 * chain state, and never gates anything. An unknown chain or a missing hash yields
 * `undefined` (the caller then renders the same non-linking cite as the mock), so a
 * chain we can't link never fabricates a URL.
 *
 * 024 — the explorer roots are NO LONGER declared here. They live once, alongside the rest of a
 * chain's metadata, in `@sparkpoint/shared/chains`. Before that this app carried THREE independent
 * chainId→root maps (here, `lib/network.tsx`, and per-file helpers in `ExecutionDrawer.tsx` /
 * `app/exit/page.tsx`) — exactly the shape of duplication that lets one chain's explorer quietly go
 * stale or wrong while the others look fine.
 *
 * This module remains the app's import site so the existing call sites need no churn, and because
 * the `Hex` typing is a web concern: the shared module is dependency-free on purpose so it stays
 * value-importable from `node --experimental-strip-types` unit tests, and importing viem there would
 * break that.
 *
 * Grounding: specs/001-sparkpoint-pivot-mvp/tasks.md T046 (surface the real tx hash
 * in the deposit/withdraw confirm receipt).
 */

import type { Hex } from "viem";
import {
  explorerAddressUrl as sharedExplorerAddressUrl,
  explorerRoot as sharedExplorerRoot,
  explorerTxUrl as sharedExplorerTxUrl,
} from "@sparkpoint/shared/chains";

/**
 * The explorer root for `chainId`, or `undefined` when the chain has no public explorer
 * (31337, the local Anvil fork). Exposed so the hard-coded `https://sepolia.basescan.org`
 * literals scattered across the app have one place to migrate onto.
 */
export function explorerRoot(chainId: number | undefined): string | undefined {
  return sharedExplorerRoot(chainId);
}

/** The explorer URL for a transaction, or `undefined` when the chain/hash can't be linked. */
export function explorerTxUrl(chainId: number | undefined, hash: Hex | undefined): string | undefined {
  return sharedExplorerTxUrl(chainId, hash);
}

/** The explorer URL for an address, or `undefined` when the chain/address can't be linked. */
export function explorerAddressUrl(
  chainId: number | undefined,
  address: string | undefined,
): string | undefined {
  return sharedExplorerAddressUrl(chainId, address);
}
