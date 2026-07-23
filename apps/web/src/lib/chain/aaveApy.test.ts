import { test } from "node:test";
import assert from "node:assert/strict";
import { supplyApyBpsFromRay, apyLabel, RAY } from "./aaveApy.ts";

test("supplyApyBpsFromRay: zero / negative → 0", () => {
  assert.equal(supplyApyBpsFromRay(0n), 0);
  assert.equal(supplyApyBpsFromRay(-1n), 0);
});

test("supplyApyBpsFromRay: 4.3% APR (RAY) compounds to ~4.39% APY (~439 bps)", () => {
  const rate = (43n * RAY) / 1000n; // 0.043 * 1e27
  const bps = supplyApyBpsFromRay(rate);
  assert.ok(bps >= 435 && bps <= 445, `expected ~439, got ${bps}`);
});

test("apyLabel: null → '—'; ~0 testnet → '≈0% (testnet)'; else 'x.xx%'", () => {
  assert.equal(apyLabel(null, { testnet: true }), "—");
  assert.equal(apyLabel(0, { testnet: true }), "≈0% (testnet)");
  assert.equal(apyLabel(3, { testnet: true }), "≈0% (testnet)");
  assert.equal(apyLabel(3, { testnet: false }), "≈0%");
  assert.equal(apyLabel(387, { testnet: true }), "3.87%");
  assert.equal(apyLabel(439, { testnet: false }), "4.39%");
});
