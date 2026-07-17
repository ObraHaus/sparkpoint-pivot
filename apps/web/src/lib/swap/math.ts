/**
 * Pure swap math — the slippage floor + deadline used to build a `SwapExec`. Kept separate + pure so
 * it's unit-testable (node:test) and identical everywhere the swap is quoted vs executed.
 */

/** Default deadline horizon: the swap must land within 20 minutes of signing. */
export const DEFAULT_DEADLINE_SECONDS = 20 * 60;

/** Slippage presets (bps) offered in the UI. 0.5% · 1% · 3% (thin pools want the higher end). */
export const SLIPPAGE_PRESETS_BPS = [50, 100, 300] as const;

/** A price impact at/above this (bps) gets a prominent warning (the Sepolia pool is thin). */
export const HIGH_IMPACT_BPS = 300;

/**
 * The minimum output to accept = `amountOut × (1 − slippageBps/10000)`, floored (integer, never a
 * float). `slippageBps` is clamped to [0, 10000]. This is the ONLY value protecting the user from
 * the thin-pool price movement between quote and execution, so it is always set.
 */
export function amountOutMinimum(amountOut: bigint, slippageBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(10_000, Math.round(slippageBps))));
  return (amountOut * (10_000n - bps)) / 10_000n;
}

/** Human "0.5%" / "1.25%" from bps (for the slippage + price-impact chips). Trailing zeros trimmed. */
export function formatBpsPercent(bps: number): string {
  const pct = bps / 100;
  return `${parseFloat(pct.toFixed(2))}%`;
}
