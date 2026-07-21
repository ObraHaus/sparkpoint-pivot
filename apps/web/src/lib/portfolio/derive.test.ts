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

// ── T028/T032: multi-vault — branded Morpho wrappers coexist with the launch Aave vault ──

const WRAPPER = "0x00000000000000000000000000000000000000Ab" as const;

test("launch vault stays default: no wrappers ⇒ byte-identical shape (vault, idle only)", () => {
  const d = derivePortfolio({ underlying: 1_500_000n, usdcBalance: 500_000n, shares: 1_500_000n });
  assert.equal(d.positions.length, 2);
  assert.equal(d.positions[0].key, "vault");
  assert.equal(d.positions[1].key, "idle");
  assert.equal(d.wrapperValue, 0);
  assert.equal(d.totalUsd, 2.0);
  assert.equal(d.vaultPct, 75);
  assert.equal(d.idlePct, 25);
});

test("wrapper carries vaultAddress + label + external, keyed ext:<addr>, and folds USDC value into total", () => {
  const d = derivePortfolio({
    underlying: 1_000_000n, // launch vault: 1.0 USDC
    usdcBalance: 0n,
    shares: 1_000_000n,
    vaultAddress: "0x00000000000000000000000000000000000000AA",
    wrappers: [
      { vaultAddress: WRAPPER, label: "SparkPoint · Steakhouse USDC", underlying: 3_000_000n, shares: 3_000_000n },
    ],
  });
  // Launch vault + one wrapper + idle.
  assert.equal(d.positions.length, 3);
  const ext = d.positions.find((p) => p.key === `ext:${WRAPPER.toLowerCase()}`);
  assert.ok(ext, "wrapper position present under its ext:<addr> key");
  assert.equal(ext!.label, "SparkPoint · Steakhouse USDC");
  assert.equal(ext!.vaultAddress, WRAPPER);
  assert.equal(ext!.external, true);
  assert.equal(ext!.valueUsd, 3);
  // The launch vault position carries its own address and is NOT flagged external.
  assert.equal(d.positions[0].key, "vault");
  assert.equal(d.positions[0].vaultAddress, "0x00000000000000000000000000000000000000AA");
  assert.notEqual(d.positions[0].external, true);
  // USDC-priced wrapper value folds into the USD total: 1.0 launch + 3.0 wrapper = 4.0.
  assert.equal(d.wrapperValue, 3);
  assert.equal(d.totalUsd, 4);
  assert.equal(d.vaultPct, 25); // 1.0 / 4.0
  assert.equal(d.idlePct, 0);
});

test("wrapper reads its own decimals (not hardcoded 6dp)", () => {
  const d = derivePortfolio({
    wrappers: [
      // An 18-dp wrapper asset: 2e18 base units == 2.0 units.
      { vaultAddress: WRAPPER, label: "18dp wrapper", underlying: 2_000_000_000_000_000_000n, decimals: 18 },
    ],
  });
  const ext = d.positions.find((p) => p.key === `ext:${WRAPPER.toLowerCase()}`);
  assert.equal(ext!.valueUsd, 2);
  assert.equal(d.totalUsd, 2);
});

test("unknown-price wrapper asset is NOT folded into the USD total (no oracle invented)", () => {
  const d = derivePortfolio({
    underlying: 1_000_000n, // launch vault 1.0 USDC
    wrappers: [
      { vaultAddress: WRAPPER, label: "exotic", underlying: 5_000_000n, usdPriced: false },
    ],
  });
  // The exotic wrapper value is excluded from net worth; only the launch vault's 1.0 counts.
  assert.equal(d.wrapperValue, 0);
  assert.equal(d.totalUsd, 1);
});
