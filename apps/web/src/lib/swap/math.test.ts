import { test } from "node:test";
import assert from "node:assert/strict";
import { POLICY_ABSOLUTE_SLIPPAGE_CEILING_BPS, ROUTING_FEE_BIPS, afterFee, amountOutMinimum, clampProposedSlippageBps, formatBpsPercent, inputFee, netInput } from "./math.ts";

test("afterFee takes the routing fee (0.20%) as an exact integer floor", () => {
  assert.equal(ROUTING_FEE_BIPS, 20); // matches the /fees page 0.20%
  // 1000 USDC (6dp) − 0.20% = 998 USDC.
  assert.equal(afterFee(1_000_000_000n, 20), 998_000_000n);
  // The fee itself = gross − net = 2 USDC.
  assert.equal(1_000_000_000n - afterFee(1_000_000_000n, 20), 2_000_000n);
  // 0 fee → unchanged; floors (never rounds up against the user).
  assert.equal(afterFee(123_456n, 0), 123_456n);
  assert.equal(afterFee(101n, 20), 100n); // 101 × 0.998 = 100.798 → floors to 100
});

test("afterFee clamps feeBips to the Uniswap 100-bip (1%) cap", () => {
  assert.equal(afterFee(1_000n, 100), 990n); // 1% max
  assert.equal(afterFee(1_000n, 500), 990n); // clamped to 100
  assert.equal(afterFee(1_000n, -5), 1_000n); // clamped to 0
});

// W.7 fee-router: the fee is INPUT-side and the quote must see the NET input. These two helpers
// mirror `FeeRouter.swapExactInputSingle` exactly — floor(amount × bps / 10000), same dust rule.
test("inputFee mirrors the on-chain input-side fee (floor, 0.20%)", () => {
  assert.equal(inputFee(1_000_000_000n, 20), 2_000_000n); // 1000 USDC → 2 USDC
  assert.equal(inputFee(999n, 20), 1n); // floors, never rounds up against the user
  assert.equal(inputFee(499n, 20), 0n); // dust below one basis point → no fee
  assert.equal(inputFee(1_000n, 0), 0n);
});

test("netInput is what the router actually swaps after the input fee", () => {
  assert.equal(netInput(1_000_000_000n, 20), 998_000_000n);
  assert.equal(netInput(999n, 20), 998n);
  assert.equal(netInput(499n, 20), 499n);
});

test("inputFee/netInput clamp the bps to the router's 100-bip hard ceiling", () => {
  assert.equal(inputFee(1_000n, 10_000), 10n); // clamped to 1% = 10 base units
  assert.equal(netInput(1_000n, 10_000), 990n);
  assert.equal(inputFee(1_000n, -5), 0n);
});

test("amountOutMinimum applies the slippage floor as exact integer math (never a float)", () => {
  // 1000 USDC (6dp) at 0.5% slippage → min 995 USDC.
  assert.equal(amountOutMinimum(1_000_000_000n, 50), 995_000_000n);
  // 1% → 990.
  assert.equal(amountOutMinimum(1_000_000_000n, 100), 990_000_000n);
  // 3% → 970.
  assert.equal(amountOutMinimum(1_000_000_000n, 300), 970_000_000n);
  // 0% slippage → the full amount (no floor).
  assert.equal(amountOutMinimum(123_456n, 0), 123_456n);
});

test("amountOutMinimum clamps slippage to [0,10000] (never exceeds 100% / goes negative)", () => {
  assert.equal(amountOutMinimum(1_000n, 10_000), 0n); // 100% → floor is 0
  assert.equal(amountOutMinimum(1_000n, 999_999), 0n); // clamped to 100%
  assert.equal(amountOutMinimum(1_000n, -50), 1_000n); // clamped to 0%
});

test("amountOutMinimum rounds DOWN (floor), never rounding up against the user", () => {
  // 101 base units at 0.5% = 100.495 → floors to 100.
  assert.equal(amountOutMinimum(101n, 50), 100n);
});

test("formatBpsPercent renders whole + fractional percents", () => {
  assert.equal(formatBpsPercent(50), "0.5%");
  assert.equal(formatBpsPercent(100), "1%");
  assert.equal(formatBpsPercent(300), "3%");
  assert.equal(formatBpsPercent(125), "1.25%");
});

// ─────────────────────────────────────────────────────────────────────────────
// R1 medium #1 — an assistant-proposed slippage must be bounded by the policy
// ceiling before it can reach amountOutMinimum. Regression guard: unclamped,
// a prompt-injected agent proposing 9900bps yields minOut ~= 0.
// ─────────────────────────────────────────────────────────────────────────────

test("clampProposedSlippageBps bounds an over-ceiling agent proposal", () => {
  assert.equal(clampProposedSlippageBps(9900), POLICY_ABSOLUTE_SLIPPAGE_CEILING_BPS);
  assert.equal(clampProposedSlippageBps(10_000), POLICY_ABSOLUTE_SLIPPAGE_CEILING_BPS);
  assert.equal(clampProposedSlippageBps(301), POLICY_ABSOLUTE_SLIPPAGE_CEILING_BPS);
});

test("clampProposedSlippageBps leaves in-range values alone", () => {
  assert.equal(clampProposedSlippageBps(50), 50);
  assert.equal(clampProposedSlippageBps(300), 300);
  assert.equal(clampProposedSlippageBps(0), 0);
});

test("clampProposedSlippageBps passes undefined through, never a permissive default", () => {
  // The card must fall back to its own 50bps preset — a MISSING value must not become a loose one.
  assert.equal(clampProposedSlippageBps(undefined), undefined);
  assert.equal(clampProposedSlippageBps(Number.NaN), undefined);
  assert.equal(clampProposedSlippageBps(Number.POSITIVE_INFINITY), undefined);
});

test("clampProposedSlippageBps rejects negatives", () => {
  assert.equal(clampProposedSlippageBps(-500), 0);
});

test("the clamped worst case still protects the user in amountOutMinimum", () => {
  // Unclamped 9900bps => minOut 1% of quote (sandwichable). Clamped => 97% floor.
  const quote = 1_000_000n;
  const unclamped = amountOutMinimum(quote, 9900);
  const clamped = amountOutMinimum(quote, clampProposedSlippageBps(9900) as number);
  assert.equal(unclamped, 10_000n);
  assert.equal(clamped, 970_000n);
});
