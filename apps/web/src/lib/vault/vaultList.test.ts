import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL,
  DASH,
  READING,
  UNAVAILABLE,
  balanceDisplay,
  chainDisplayName,
  chainKeyFromId,
  chainKeyFromSlug,
  collectFilterValues,
  emptyFilter,
  filterVaults,
  formatRawAmount,
  hasActiveFilter,
  liveDisplayName,
  matchesTagFilter,
  morphoPositionValue,
  protocolDisplayName,
  protocolKeyFromSource,
} from "./vaultList.ts";
import { availableWithdrawUsdc, USDC_TOKEN_ID } from "../near/burrow.ts";

const vaults = [
  { key: "rhea", chain: "near", protocol: "rhea", live: true },
  { key: "kamino", chain: "sol", protocol: "kamino", live: true },
  { key: "morpho", chain: "base", protocol: "morpho", live: true },
  { key: "morpho-preview", chain: "eth", protocol: "morpho", live: false },
];

test("chain and protocol tags use plain names", () => {
  assert.equal(chainKeyFromSlug("near"), "near");
  assert.equal(chainKeyFromSlug("sol"), "sol");
  assert.equal(chainKeyFromSlug("ethereum"), "eth");
  assert.equal(chainKeyFromId(8453), "base");
  assert.equal(chainKeyFromId(1), "eth");
  assert.equal(chainDisplayName("near"), "NEAR");
  assert.equal(chainDisplayName("base"), "Base");
  assert.equal(chainDisplayName("sol"), "Solana");
  assert.equal(chainDisplayName("eth"), "Ethereum");
  assert.equal(protocolKeyFromSource("morpho"), "morpho");
  assert.equal(protocolKeyFromSource(null), "morpho");
  assert.equal(protocolDisplayName("rhea"), "Rhea");
  assert.equal(protocolDisplayName("kamino"), "Kamino");
  assert.equal(protocolDisplayName("morpho"), "Morpho");
  assert.equal(liveDisplayName(true), "Live deposit");
  assert.equal(liveDisplayName(false), "Preview");
});

test("the default filter shows every vault", () => {
  assert.deepEqual(filterVaults(vaults, emptyFilter()), vaults);
  assert.equal(hasActiveFilter(emptyFilter()), false);
});

test("chain and protocol filters combine, and 'all' always clears", () => {
  const near = filterVaults(vaults, { chain: "near", protocol: ALL }).map((v) => v.key);
  assert.deepEqual(near, ["rhea"]);

  const base = filterVaults(vaults, { chain: "base", protocol: "morpho" }).map((v) => v.key);
  assert.deepEqual(base, ["morpho"]);

  const morpho = filterVaults(vaults, { chain: ALL, protocol: "morpho" }).map((v) => v.key);
  assert.deepEqual(morpho, ["morpho", "morpho-preview"]);

  const mismatch = filterVaults(vaults, { chain: "near", protocol: "kamino" });
  assert.deepEqual(mismatch, []);

  assert.equal(matchesTagFilter(vaults[0]!, { chain: ALL, protocol: ALL }), true);
  assert.equal(hasActiveFilter({ chain: "near", protocol: ALL }), true);
});

test("filter options are distinct and in list order", () => {
  assert.deepEqual(collectFilterValues(vaults, "chain"), ["near", "sol", "base", "eth"]);
  assert.deepEqual(collectFilterValues(vaults, "protocol"), ["rhea", "kamino", "morpho"]);
});

test("a balance is only dashed when that chain has no wallet", () => {
  assert.deepEqual(balanceDisplay({ connected: false }), { state: "disconnected", text: DASH });
  assert.deepEqual(
    balanceDisplay({ connected: true, loading: true, value: "1 USDC" }),
    { state: "loading", text: READING },
  );
  assert.deepEqual(
    balanceDisplay({ connected: true, error: true, value: "1 USDC" }),
    { state: "error", text: UNAVAILABLE },
  );
  assert.deepEqual(
    balanceDisplay({ connected: true, value: "0 USDC" }),
    { state: "value", text: "0 USDC" },
  );
  assert.deepEqual(
    balanceDisplay({ connected: true }),
    { state: "loading", text: READING },
  );
});

test("a value for a previous account is never shown after an account change", () => {
  assert.deepEqual(
    balanceDisplay({
      connected: true,
      valueAccount: "0xold",
      currentAccount: "0xnew",
      value: "42 USDC",
    }),
    { state: "loading", text: READING },
  );
  assert.deepEqual(
    balanceDisplay({
      connected: true,
      valueAccount: "0xsame",
      currentAccount: "0xsame",
      value: "42 USDC",
    }),
    { state: "value", text: "42 USDC" },
  );
});

test("Morpho shows converted asset value, never the raw share count", () => {
  // 2 shares (~2e18 raw at 18dp) are worth 1.5 USDC (6dp) according to convertToAssets.
  assert.equal(morphoPositionValue(2_000_000_000_000_000_000n, 1_500_000n, 6), "1.5");
  assert.equal(morphoPositionValue(1n, undefined, 6), null);
  assert.equal(morphoPositionValue(0n, undefined, 6), "0");
});

test("raw units format exactly without floats", () => {
  assert.equal(formatRawAmount(1_250_000n, 6), "1.25");
  assert.equal(formatRawAmount(0n, 6), "0");
  assert.equal(formatRawAmount(1n, 18), "0.000000000000000001");
});

test("Rhea Burrow supplied USDC still applies the 6+12 extra-decimal conversion", () => {
  const inner = 50_000_000_000_000_000n; // 0.05 USDC in Burrow inner units (6 + 12)
  assert.equal(
    availableWithdrawUsdc({ supplied: [{ token_id: USDC_TOKEN_ID, balance: inner.toString() }] }),
    "0.05",
  );
});
