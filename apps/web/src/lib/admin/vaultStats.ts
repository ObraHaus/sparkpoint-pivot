/**
 * Pure formatters for the admin "money view" — on-chain vault stats rendered honestly.
 *
 * No React, no viem: this module is dependency-free so it can be unit-tested in isolation under
 * `node --experimental-strip-types --test`. The live reads themselves live in `./useVaultStats`.
 * The vault's asset is USDC (6 decimals) on Base Sepolia; `totalAssets()` / `depositCap()` are
 * denominated in that asset.
 */

/** The vault's underlying asset (USDC) has 6 decimals on Base. */
export const USDC_DECIMALS = 6;

/**
 * A USDC base-unit amount → a compact USD string ("$12.0M" / "$1.4K" / "$5.00").
 * `undefined` (a read still in flight) renders as an ellipsis — never a fabricated "$0".
 */
export function formatUsdCompact(baseUnits: bigint | undefined): string {
  if (baseUnits === undefined) return "…";
  const n = Number(baseUnits) / 10 ** USDC_DECIMALS;
  if (n >= 1e6) return "$" + (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return "$" + (n / 1e3).toFixed(1) + "K";
  return "$" + n.toFixed(2);
}

/**
 * Cap utilization as a percent (TVL / cap × 100), or `null` when the cap is unknown or zero
 * (i.e. no cap is set — utilization is undefined, not 0%).
 */
export function capUtilizationPct(tvl: bigint | undefined, cap: bigint | undefined): number | null {
  if (tvl === undefined || cap === undefined || cap === 0n) return null;
  return (Number(tvl) / Number(cap)) * 100;
}

/** `0x0A21…d720` — a short, honest address label. `undefined` → ellipsis. */
export function shortAddr(a: string | undefined): string {
  if (!a) return "…";
  return a.length <= 12 ? a : `${a.slice(0, 6)}…${a.slice(-4)}`;
}
