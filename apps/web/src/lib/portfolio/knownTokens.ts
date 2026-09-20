/**
 * 053 — the portfolio's token list, in two honest parts.
 *
 * KNOWN tokens are the ones this product can name on a chain without an indexer: the chain's
 * stablecoin and wrapped native (the address book), plus any curated wrapper share tokens (dynamic —
 * the wrapper fleet is served by the board, never a static list). They are read directly over RPC
 * (`balanceOf`/`decimals`/`symbol`), which works on every chain — including 4663, where the public
 * explorer is behind a Cloudflare challenge and cannot be enumerated from the app.
 *
 * ADDED tokens are what the user pastes in. A token address is validated for SHAPE here; whether it
 * is a real ERC-20 is decided by the probe read (symbol/decimals/balanceOf), never assumed. An added
 * token is display-only: it is never a policy target and never signable.
 *
 * PURE: no React, no fetch, no clock read.
 */

import type { Address } from "viem";

/** One token we can name on a chain. `decimals` is a hint — the RPC read is the authority. */
export interface KnownToken {
  readonly address: Address;
  readonly symbol: string;
  readonly name?: string;
  /** Optional hint; the live `decimals()` read overrides it when present. */
  readonly decimals?: number;
  /** True for the wrapper share tokens the board supplies (drives the "your vault shares" label). */
  readonly shares?: boolean;
}

/** The chain's stable + wrapped native from the address book (zero addresses excluded). */
export function chainKnownTokens(book: {
  usdc?: Address;
  weth?: Address;
} | undefined): KnownToken[] {
  if (!book) return [];
  const out: KnownToken[] = [];
  if (book.usdc && !isZeroAddress(book.usdc)) out.push({ address: book.usdc, symbol: "USDG" });
  if (book.weth && !isZeroAddress(book.weth)) out.push({ address: book.weth, symbol: "WETH" });
  return out;
}

/** Merge token lists, de-duplicated by lowercase address (first list wins). */
export function mergeTokens(...lists: readonly (readonly KnownToken[])[]): KnownToken[] {
  const seen = new Set<string>();
  const out: KnownToken[] = [];
  for (const list of lists) {
    for (const t of list) {
      const key = t.address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/** A well-formed 20-byte hex address — the ONLY thing shape validation may claim. */
export function isAddressShape(value: string): value is Address {
  return /^0x[0-9a-fA-F]{40}$/.test(value.trim());
}

export function isZeroAddress(value: string): boolean {
  return /^0x0{40}$/i.test(value);
}

/** Normalize a pasted address for storage/compare, or `null` when the shape is wrong. */
export function parseTokenAddress(value: string): Address | null {
  const trimmed = value.trim();
  if (!isAddressShape(trimmed) || isZeroAddress(trimmed)) return null;
  return trimmed as Address;
}

/** Stable local-storage key for a wallet's added tokens — chain + wallet scoped. */
export function addedTokensKey(chainId: number, account: string): string {
  return `sp:added-tokens:${chainId}:${account.toLowerCase()}`;
}

/** Parse a persisted added-token list (shape-checked; a corrupt entry is dropped, never thrown). */
export function parseAddedTokenList(raw: string | null): Address[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is Address => typeof v === "string" && parseTokenAddress(v) !== null);
  } catch {
    return [];
  }
}

/** Read the persisted added-token list for a wallet. */
export function readAddedTokens(chainId: number, account: string): Address[] {
  try {
    return parseAddedTokenList(localStorage.getItem(addedTokensKey(chainId, account)));
  } catch {
    return [];
  }
}

/** Persist the added-token list. Storage failures are non-fatal (the session still shows them). */
export function writeAddedTokens(chainId: number, account: string, tokens: readonly Address[]): void {
  try {
    localStorage.setItem(addedTokensKey(chainId, account), JSON.stringify(tokens));
  } catch {
    /* storage unavailable — the in-memory list still works for this session */
  }
}
