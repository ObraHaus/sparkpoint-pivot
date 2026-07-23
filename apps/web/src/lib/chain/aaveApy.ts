/**
 * aaveApy — pure RAY→APY conversion + honest APY labels for the live Aave supply rate.
 * Dependency-free so it runs under the node:test runner; the wagmi read lives in the hook.
 * MIRRORS services/agent/src/sparkpoint_agent/chain/aave_rate.py — keep the two in sync.
 */
export const RAY = 10n ** 27n;
export const SECONDS_PER_YEAR = 31_536_000;
/** At/under 0.05% the live testnet rate reads as "≈0%" — honest, never a fabricated figure. */
export const ZERO_APY_BPS = 5;

/** Aave v3 currentLiquidityRate (RAY, annual APR) → compounded supply APY in bps
 * (per-second compounding, as Aave's UI). */
export function supplyApyBpsFromRay(rateRay: bigint): number {
  if (rateRay <= 0n) return 0;
  const apr = Number(rateRay) / Number(RAY); // display-precision only; relative error ~1e-16
  const apy = (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1;
  return Math.round(apy * 10_000);
}

/** Honest APY label. null ⇒ read unavailable ("—"); ~0 ⇒ "≈0% (testnet)"; else "x.xx%". */
export function apyLabel(bps: number | null, opts: { testnet: boolean }): string {
  if (bps === null) return "—";
  if (bps <= ZERO_APY_BPS) return opts.testnet ? "≈0% (testnet)" : "≈0%";
  return `${(bps / 100).toFixed(2)}%`;
}
