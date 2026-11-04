/**
 * 068b — explorer links for cross-chain legs.
 *
 * The deposit/status card used to show a bare hash with no way to verify it. EVM legs resolve
 * through the shared chain registry (never a hard-coded basescan literal); non-EVM legs use the
 * canonical public explorer for that family. Unknown chains or missing hashes return `undefined`,
 * so the caller renders plain text instead of fabricating a URL.
 */

import { explorerAddressUrl, explorerTxUrl } from "../chain/explorer.ts";
import type { CrossChainAddressKind } from "./address";

const NON_EVM_TX: Record<Exclude<CrossChainAddressKind, "evm">, (hash: string) => string> = {
  btc: (hash) => `https://mempool.space/tx/${encodeURIComponent(hash)}`,
  sol: (hash) => `https://solscan.io/tx/${encodeURIComponent(hash)}`,
  near: (hash) => `https://nearblocks.io/txns/${encodeURIComponent(hash)}`,
  tron: (hash) => `https://tronscan.org/#/transaction/${encodeURIComponent(hash)}`,
};

const NON_EVM_ADDRESS: Record<Exclude<CrossChainAddressKind, "evm">, (address: string) => string> = {
  btc: (address) => `https://mempool.space/address/${encodeURIComponent(address)}`,
  sol: (address) => `https://solscan.io/account/${encodeURIComponent(address)}`,
  near: (address) => `https://nearblocks.io/address/${encodeURIComponent(address)}`,
  tron: (address) => `https://tronscan.org/#/address/${encodeURIComponent(address)}`,
};

export function crosschainTxUrl(
  kind: CrossChainAddressKind | null,
  evmChainId: number | null | undefined,
  hash: string | undefined,
): string | undefined {
  if (!hash) return undefined;
  if (kind === "evm") {
    return typeof evmChainId === "number" ? explorerTxUrl(evmChainId, hash as `0x${string}`) : undefined;
  }
  return kind === null ? undefined : NON_EVM_TX[kind](hash);
}

export function crosschainAddressUrl(
  kind: CrossChainAddressKind | null,
  evmChainId: number | null | undefined,
  address: string | undefined,
): string | undefined {
  if (!address) return undefined;
  if (kind === "evm") {
    return typeof evmChainId === "number" ? explorerAddressUrl(evmChainId, address) : undefined;
  }
  return kind === null ? undefined : NON_EVM_ADDRESS[kind](address);
}

/** A `{hash}` entry from a 1Click `swapDetails` hash array. */
export interface ChainTxHash {
  hash?: string;
}

/** The first usable hash from a 1Click hash array, or undefined. */
export function firstHash(hashes: readonly ChainTxHash[] | undefined): string | undefined {
  for (const entry of hashes ?? []) {
    if (typeof entry?.hash === "string" && entry.hash.trim()) return entry.hash.trim();
  }
  return undefined;
}

/** EVM chain id for a 1Click chain key (only the EVM families need one). */
export function evmChainIdForKey(key: string | undefined): number | undefined {
  switch ((key ?? "").trim().toLowerCase()) {
    case "base":
      return 8453;
    case "eth":
    case "ethereum":
      return 1;
    case "hood":
    case "robinhood":
      return 4663;
    default:
      return undefined;
  }
}
