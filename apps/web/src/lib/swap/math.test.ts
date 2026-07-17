import { test } from "node:test";
import assert from "node:assert/strict";
import { amountOutMinimum, formatBpsPercent } from "./math.ts";

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
