"use client";

/**
 * importedTokens — the user's per-chain "imported / recently used" custom tokens (universal swap, 007).
 *
 * A small, LRU-capped list persisted in `localStorage`, SCOPED BY chainId because the same 0x address is a
 * DIFFERENT contract on another network (spec FR-006 + the chain-switch hazard). SSR-safe: every access
 * guards `typeof window`. Stored decimals are only a convenience for re-rendering the picker — the swap
 * path always re-reads `decimals()` on-chain (metadata.ts), so a stale cache can never mis-scale a swap.
 */

import type { SwapToken } from "./tokens";

const STORAGE_KEY = "sp.swap.imported.v1";
const CAP = 20;

type Store = Record<string, SwapToken[]>;

const eqAddr = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function write(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // storage full / disabled — a non-fatal convenience feature; ignore.
  }
}

/** The imported tokens for `chainId`, most-recent first (empty when none / SSR). */
export function getImported(chainId: number): SwapToken[] {
  const list = read()[String(chainId)];
  return Array.isArray(list) ? list : [];
}

/** Add (or bump to front) an imported token for `chainId`, LRU-capped. Deduped by address. */
export function addImported(chainId: number, token: SwapToken): void {
  const store = read();
  const key = String(chainId);
  const existing = Array.isArray(store[key]) ? store[key] : [];
  const deduped = existing.filter((t) => !eqAddr(t.address, token.address));
  store[key] = [{ ...token, source: "imported" as const }, ...deduped].slice(0, CAP);
  write(store);
}

/** Remove an imported token by address for `chainId`. */
export function removeImported(chainId: number, address: string): void {
  const store = read();
  const key = String(chainId);
  const existing = Array.isArray(store[key]) ? store[key] : [];
  store[key] = existing.filter((t) => !eqAddr(t.address, address));
  write(store);
}
