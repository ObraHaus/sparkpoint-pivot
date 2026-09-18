import { test } from "node:test";
import assert from "node:assert/strict";
import { RH_STOCK_TOKENS, formatSeedAmount, isConfiguredToken } from "./tokens.pure.ts";

// Robinhood Chain 4663 — the curated recommended list. Addresses are canonical (official RH asset
// registry) and were pool-verified on-chain; these tests guard the invariants that make that claim
// safe to make in the UI: configured addresses, honest decimals, no duplicates.

test("every 4663 curated stock token is a configured, unique, checksum-plausible 18dp address", () => {
  assert.ok(RH_STOCK_TOKENS.length >= 14, "more defaults than ETH + USDG + SPCX");
  const seen = new Set<string>();
  for (const t of RH_STOCK_TOKENS) {
    assert.ok(isConfiguredToken(t), `${t.symbol} has a zero address`);
    assert.match(t.address, /^0x[0-9a-fA-F]{40}$/);
    const key = t.address.toLowerCase();
    assert.ok(!seen.has(key), `${t.symbol} duplicates ${key}`);
    seen.add(key);
    assert.ok(t.symbol.length > 0);
    assert.equal(t.decimals, 18);
    assert.equal(t.isNative, false);
    assert.equal(t.verified, true);
    assert.ok(t.name && t.name.length > 0, `${t.symbol} has no display name`);
  }
  // The tokens the beta already knew + the majors the operator asked for.
  for (const sym of ["SPCX", "SPY", "NVDA", "TSLA", "AAPL", "MSFT", "GOOGL", "META", "AMZN", "COIN"]) {
    assert.ok(RH_STOCK_TOKENS.some((t) => t.symbol === sym), `${sym} missing`);
  }
});

test("formatSeedAmount scales the assistant's base-unit amount with the resolved token", () => {
  const eth = { symbol: "ETH", decimals: 18, address: "0x" as const, isNative: true };
  const usdg = { symbol: "USDG", decimals: 6, address: "0x" as const, isNative: false };
  // The chat "swap 0.001 ETH to USDG" case: 1e15 base units, 18dp.
  assert.equal(formatSeedAmount(10n ** 15n, eth), "0.001");
  // A 6dp stable input: 100.5 USDG.
  assert.equal(formatSeedAmount(100_500_000n, usdg), "100.5");
  // Whole numbers don't keep trailing zeros; empty/absent/unresolved stay blank.
  assert.equal(formatSeedAmount(10n ** 18n, eth), "1");
  assert.equal(formatSeedAmount(0n, eth), "");
  assert.equal(formatSeedAmount(undefined, eth), "");
  assert.equal(formatSeedAmount(10n ** 15n, undefined), "");
});

test("formatSeedAmount preserves every digit (no rounding, truncation is exact)", () => {
  const usdg = { symbol: "USDG", decimals: 6, address: "0x" as const, isNative: false };
  assert.equal(formatSeedAmount(1n, usdg), "0.000001");
  assert.equal(formatSeedAmount(123_456_789n, usdg), "123.456789");
});
