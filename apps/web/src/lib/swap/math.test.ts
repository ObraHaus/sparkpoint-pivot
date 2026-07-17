import { test } from "node:test";
import assert from "node:assert/strict";
import { afterFee, amountOutMinimum, formatBpsPercent, ROUTING_FEE_BIPS } from "./math.ts";

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
