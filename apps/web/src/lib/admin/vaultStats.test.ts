import { test } from "node:test";
import assert from "node:assert/strict";
import { capUtilizationPct, formatUsdCompact, shortAddr, USDC_DECIMALS } from "./vaultStats.ts";

test("USDC_DECIMALS is 6 (Base USDC)", () => {
  assert.equal(USDC_DECIMALS, 6);
});

test("formatUsdCompact: honest scaling from USDC base units", () => {
  // A read still in flight must never render as a fabricated zero.
  assert.equal(formatUsdCompact(undefined), "…");
  assert.equal(formatUsdCompact(0n), "$0.00");
  assert.equal(formatUsdCompact(5_000000n), "$5.00"); // 5 USDC (the SC-010 e2e deposit magnitude)
  assert.equal(formatUsdCompact(250_500000n), "$250.50");
  assert.equal(formatUsdCompact(1_400_000000n), "$1.4K"); // 1,400 USDC
  assert.equal(formatUsdCompact(12_000_000_000000n), "$12.00M"); // 12M USDC
});

test("capUtilizationPct: null when the cap is unknown or unset, real percent otherwise", () => {
  assert.equal(capUtilizationPct(undefined, 100_000000n), null);
  assert.equal(capUtilizationPct(5_000000n, undefined), null);
  assert.equal(capUtilizationPct(5_000000n, 0n), null); // no cap set ⇒ utilization undefined, not 0%
  assert.equal(capUtilizationPct(5_000000n, 100_000000n), 5); // 5 of 100 USDC ⇒ 5%
  assert.equal(capUtilizationPct(48_000000n, 100_000000n), 48);
});

test("shortAddr: honest short label, ellipsis when absent", () => {
  assert.equal(shortAddr(undefined), "…");
  assert.equal(shortAddr("0x0A21A9B4c2cd2d6a68EC828188826B673572d720"), "0x0A21…d720");
  assert.equal(shortAddr("0xabcd"), "0xabcd"); // too short to truncate
});
