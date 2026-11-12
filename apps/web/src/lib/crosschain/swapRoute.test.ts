import test from "node:test";
import assert from "node:assert/strict";

import {
  buildCrossChainPreviewBlock,
  crossChainAmountError,
  crossChainQuoteKey,
  defaultSwapMode,
  isSwapConnected,
  routeIsCrossChain,
} from "./swapRoute.ts";
import { crossChainAssetByKey } from "./assets.ts";

const base = crossChainAssetByKey("base:USDC")!;
const sol = crossChainAssetByKey("sol:SOL")!;
const near = crossChainAssetByKey("near:wNEAR")!;

test("a connected NEAR account counts as connected on /swap", () => {
  assert.equal(isSwapConnected({ evmConnected: false, nearAccountId: "sparkpoint.near" }), true);
  assert.equal(isSwapConnected({ evmConnected: true, nearAccountId: null }), true);
  assert.equal(isSwapConnected({ evmConnected: false, nearAccountId: null }), false);
});

test("the same-chain EVM form is the default when an EVM wallet is connected", () => {
  assert.equal(defaultSwapMode({ evmConnected: true, nearConnected: false }), "same-chain");
  assert.equal(defaultSwapMode({ evmConnected: true, nearConnected: true }), "same-chain");
  assert.equal(defaultSwapMode({ evmConnected: false, nearConnected: true }), "cross-chain");
});

test("a NEAR origin or differing chains is a cross-chain route", () => {
  assert.equal(routeIsCrossChain(near, base), true);
  assert.equal(routeIsCrossChain(base, sol), true);
  assert.equal(routeIsCrossChain(base, base), false);
});

test("over-precise, zero and malformed cross-chain amounts are refused with plain language", () => {
  assert.equal(crossChainAmountError("5000", 6), null);
  assert.equal(crossChainAmountError("0.000001", 6), null);
  assert.equal(crossChainAmountError("0.0000001", 6)?.includes("decimal places"), true);
  assert.equal(crossChainAmountError("0", 6)?.includes("greater than zero"), true);
  assert.equal(crossChainAmountError("1e6", 6)?.includes("positive number"), true);
  assert.equal(crossChainAmountError("", 6)?.includes("Enter an amount"), true);
});

test("the preview block carries the selected assets and NO fabricated output", () => {
  const block = buildCrossChainPreviewBlock(near, base, "5");
  assert.equal(block.type, "crosschain_quote");
  assert.equal(block.state, "preview");
  assert.equal(block.origin.key, "near:wNEAR");
  assert.equal(block.origin.amount, "5");
  assert.equal(block.destination.key, "base:USDC");
  assert.equal(block.amountOut, undefined);
  assert.equal(block.minAmountOut, undefined);
});

test("the quote key changes with the route or the amount, so stale previews never render", () => {
  assert.equal(crossChainQuoteKey("near:wNEAR", "base:USDC", "5"), "near:wNEAR>base:USDC:5");
  assert.notEqual(
    crossChainQuoteKey("near:wNEAR", "base:USDC", "5"),
    crossChainQuoteKey("near:wNEAR", "base:USDC", "6"),
  );
});
