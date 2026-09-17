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

/** The SparkPoint routing fee (bips) taken INSIDE a swap — matches the /fees page (0.20%). The
 * Uniswap fee helpers cap feeBips at 100 (1%); 20 is well under. Paid to the vault's feeRecipient. */
export const ROUTING_FEE_BIPS = 20;

/** The amount the user actually receives AFTER the routing fee = amount × (10000 − feeBips)/10000,
 * floored (exact integer math). Mirrors the on-chain sweep/unwrap-with-fee split. */
export function afterFee(amount: bigint, feeBips: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(100, Math.round(feeBips))));
  return (amount * (10_000n - bps)) / 10_000n;
}

/**
 * §fee-router (W.7) — the fee the custom router takes on the **input side**: `floor(amount ×
 * feeBips / 10000)`, the EXACT expression `FeeRouter.swapExactInputSingle` computes on-chain. The
 * bps are read live from the router (`feeBps()`), never hardcoded, so the disclosed number is the
 * charged number.
 */
export function inputFee(amount: bigint, feeBps: number): bigint {
  const bps = BigInt(Math.max(0, Math.min(100, Math.round(feeBps))));
  return (amount * bps) / 10_000n;
}

/** The input amount the fee-router actually swaps: `amount − inputFee(amount, feeBps)`. */
export function netInput(amount: bigint, feeBps: number): bigint {
  return amount - inputFee(amount, feeBps);
}

/**
 * The policy layer's ABSOLUTE slippage ceiling in bps (policy-schema.md §5 — `absoluteCeilingBps`).
 *
 * Defined locally rather than imported so this module stays a leaf (node:test loads it directly —
 * see the same note in `lib/automation/coverage.ts`); `packages/shared/src/policy/constants.ts` is
 * the source of truth and a drift here would be a real defect.
 */
export const POLICY_ABSOLUTE_SLIPPAGE_CEILING_BPS = 300;

/**
 * Bound an ASSISTANT-PROPOSED slippage to the policy ceiling before it can reach
 * {@link amountOutMinimum} (alpha security audit R1, medium #1).
 *
 * The chat-inline swap card takes its slippage from the agent's `proposedAction.params`. Unclamped,
 * a prompt-injected or compromised agent proposing e.g. 9900 bps produces `minOut ≈ 0` — a
 * sandwichable trade whose bound was chosen by the MODEL rather than the user. `amountOutMinimum`
 * clamps only to [0, 10000] (100%), which is no protection at all.
 *
 * `undefined` passes through so the caller falls back to the UI's own 50 bps preset: a missing value
 * must never become a permissive one.
 */
export function clampProposedSlippageBps(proposed: number | undefined): number | undefined {
  if (proposed === undefined || !Number.isFinite(proposed)) return undefined;
  return Math.max(0, Math.min(POLICY_ABSOLUTE_SLIPPAGE_CEILING_BPS, Math.round(proposed)));
}

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
