import { test } from "node:test";
import assert from "node:assert/strict";
import { derivePortfolio } from "./derive.ts";

test("decimals are pinned: USDC + shares 6dp, ETH 18dp; ETH excluded from USD total", () => {
  const d = derivePortfolio({
    underlying: 1_500_000n, // 1.5 USDC (6dp)
    usdcBalance: 500_000n, // 0.5 USDC (6dp)
    shares: 1_500_000n, // 1.5 spvUSDC (6dp — the vault share token is 6-dp, == the USDC asset)
    ethWei: 2_000_000_000_000_000_000n, // 2 ETH (18dp)
  });
  assert.equal(d.vaultValue, 1.5);
  assert.equal(d.idleUsdc, 0.5);
  assert.equal(d.sharesNum, 1.5);
  assert.equal(d.ethBalance, 2);
  assert.equal(d.totalUsd, 2.0); // vault + idle USDC only — ETH is NOT converted/added
  assert.equal(d.vaultPct, 75);
  assert.equal(d.idlePct, 25);
});

test("empty state when there are no positions (guards total===0)", () => {
  const d = derivePortfolio({});
  assert.equal(d.hasPositions, false);
  assert.equal(d.totalUsd, 0);
  assert.equal(d.vaultPct, 0);
  assert.equal(d.idlePct, 0);
});

test("positions array: vault first (with shares), then idle", () => {
  const d = derivePortfolio({ underlying: 1_000_000n, usdcBalance: 0n, shares: 1_000_000n }); // 1.0 shares (6dp)
  assert.equal(d.positions.length, 2);
  assert.equal(d.positions[0].key, "vault");
  assert.equal(d.positions[0].valueUsd, 1);
  assert.equal(d.positions[0].shares, 1);
  assert.equal(d.positions[1].key, "idle");
  assert.equal(d.positions[1].valueUsd, 0);
});
