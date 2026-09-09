/**
 * Pure path-encoding + route planning + selection (universal swap, feature 007 · US2).
 *
 * Self-contained (only a type-only viem import, erased at runtime) so it unit-tests under
 * `node --experimental-strip-types` — the test runner can't resolve extensionless relative imports, so the
 * pure core has no relative deps. `encodeDirect`/`encodeTwoHop` build Uniswap V3 packed paths;
 * `planCandidates` decides WHICH routes to quote (direct across fee tiers + 2-hop via WETH/USDC, pruned);
 * `pickBest` chooses the highest output. Native ETH must already be normalized to WETH by the caller.
 */

import type { Address, Hex } from "viem";

/** V3 fee tiers probed for a direct pool: 0.05% · 0.3% · 1%. */
export const FEE_TIERS = [500, 3000, 10000] as const;
/** Hop-leg tiers for a 2-hop route — restricted to the deep tiers to bound RPC fan-out. */
export const HOP_TIERS = [500, 3000] as const;

// ── Uniswap V3 path encoding: token (20) | fee (uint24, 3) | token (20) [| fee | token …] ──
const body = (a: string) => a.replace(/^0x/i, "").toLowerCase();
const feeHex = (fee: number) => (fee & 0xffffff).toString(16).padStart(6, "0");

/** Direct single-hop path (43 bytes): `tokenIn | fee | tokenOut`. */
export function encodeDirect(tokenIn: Address, fee: number, tokenOut: Address): Hex {
  return `0x${body(tokenIn)}${feeHex(fee)}${body(tokenOut)}` as Hex;
}

/** Two-hop path (66 bytes): `tokenIn | feeA | hop | feeB | tokenOut`. */
export function encodeTwoHop(tokenIn: Address, feeA: number, hop: Address, feeB: number, tokenOut: Address): Hex {
  return `0x${body(tokenIn)}${feeHex(feeA)}${body(hop)}${feeHex(feeB)}${body(tokenOut)}` as Hex;
}

export type Candidate =
  | { readonly kind: "single"; readonly fee: number; readonly via: null }
  | { readonly kind: "multi"; readonly path: Hex; readonly via: "WETH" | "USDC"; readonly feeA: number; readonly feeB: number };

export interface PlanInput {
  readonly tokenIn: Address;
  readonly tokenOut: Address;
  readonly weth: Address;
  readonly usdc?: Address;
  /** false on chains where "USDC" isn't a real routing asset (e.g. Base Sepolia's Aave test token). */
  readonly usdcIsRoutingAsset: boolean;
}

const eq = (a?: string, b?: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/**
 * The routes worth quoting for this pair: direct across all fee tiers, plus 2-hop via WETH and (where it
 * is a real routing asset) USDC. A hop asset that equals either side is skipped (no degenerate leg).
 */
export function planCandidates(input: PlanInput): Candidate[] {
  const { tokenIn, tokenOut, weth, usdc, usdcIsRoutingAsset } = input;
  const out: Candidate[] = [];

  for (const fee of FEE_TIERS) out.push({ kind: "single", fee, via: null });

  const twoHop = (hop: Address, via: "WETH" | "USDC") => {
    if (eq(hop, tokenIn) || eq(hop, tokenOut)) return; // hop must be a genuine intermediary
    for (const feeA of HOP_TIERS)
      for (const feeB of HOP_TIERS)
        out.push({ kind: "multi", path: encodeTwoHop(tokenIn, feeA, hop, feeB, tokenOut), via, feeA, feeB });
  };

  twoHop(weth, "WETH");
  if (usdc && usdcIsRoutingAsset && !eq(usdc, weth)) twoHop(usdc, "USDC");

  return out;
}

/** The candidate with the greatest output (ties keep the first — direct routes are planned first). */
export function pickBest<T extends { amountOut: bigint }>(candidates: readonly T[]): T | undefined {
  let best: T | undefined;
  for (const c of candidates) if (best === undefined || c.amountOut > best.amountOut) best = c;
  return best;
}
