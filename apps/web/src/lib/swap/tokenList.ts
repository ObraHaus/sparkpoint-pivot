/**
 * tokenList — the curated "verified" set per chain (universal swap, feature 007).
 *
 * A token is "verified" ONLY if its ADDRESS is in this curated set — never because of its symbol string
 * (symbols are attacker-controlled). The canonical USDC + WETH always come from the shared address book
 * (single source of truth); a small hand-curated extra set can be added per chain over time. This drives
 * the ✓/⚠ badge and the "this is NOT the official {SYMBOL}" duplicate-symbol warning; it is NOT a gate —
 * a user can still import and swap any address (spec FR-005/FR-018).
 */

import type { Address } from "viem";
import { getAddresses } from "@sparkpoint/shared/addresses";
import { RH_STOCK_TOKENS } from "@/lib/swap/tokens";

export interface VerifiedToken {
  readonly symbol: string;
  readonly address: Address;
}

/**
 * Hand-curated extras beyond the address-book USDC/WETH. Kept intentionally empty until each address is
 * verified on-chain — a wrong "verified" address is a safety bug, so we only assert what we can confirm.
 */
const CURATED_EXTRA: Record<number, readonly VerifiedToken[]> = {
  // 8453 (Base mainnet): add well-known majors (DAI, WBTC, cbETH) here once each address is confirmed.
  // Robinhood Chain 4663: the canonical Stock Tokens (official RH registry + on-chain verified; see
  // RH_STOCK_TOKENS). Derived here so the verified set can never drift from the picker's list.
  4663: RH_STOCK_TOKENS.map((t) => ({ symbol: t.symbol, address: t.address })),
};

const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** The verified tokens for `chainId`: canonical USDC + WETH from the book, plus any curated extras. */
export function verifiedTokens(chainId: number): VerifiedToken[] {
  let book;
  try {
    book = getAddresses(chainId);
  } catch {
    return [];
  }
  const base: VerifiedToken[] = [
    { symbol: "USDC", address: book.usdc },
    { symbol: "WETH", address: book.weth },
  ];
  return [...base, ...(CURATED_EXTRA[chainId] ?? [])];
}

/** True iff `address` is in the curated verified set for this chain (address-based, never symbol-based). */
export function isVerifiedAddress(chainId: number, address: string): boolean {
  return verifiedTokens(chainId).some((t) => eqAddr(t.address, address));
}

/**
 * The verified token whose symbol equals `symbol` (case-insensitive) — used to warn when a pasted token
 * borrows a trusted symbol at a DIFFERENT address ("this is NOT the official USDC").
 */
export function findVerifiedBySymbol(chainId: number, symbol: string): VerifiedToken | undefined {
  const s = symbol.trim().toLowerCase();
  return verifiedTokens(chainId).find((t) => t.symbol.toLowerCase() === s);
}
