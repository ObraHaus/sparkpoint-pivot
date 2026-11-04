import test from "node:test";
import assert from "node:assert/strict";

import {
  crosschainAddressUrl,
  crosschainTxUrl,
  evmChainIdForKey,
  firstHash,
} from "./explorer.ts";

test("EVM legs use the shared registry explorer, never a literal", () => {
  assert.equal(
    crosschainTxUrl("evm", 8453, "0xabc"),
    "https://basescan.org/tx/0xabc",
  );
  assert.equal(
    crosschainAddressUrl("evm", 8453, "0x1111111111111111111111111111111111111111"),
    "https://basescan.org/address/0x1111111111111111111111111111111111111111",
  );
  assert.equal(crosschainTxUrl("evm", undefined, "0xabc"), undefined);
});

test("non-EVM legs use the canonical public explorer", () => {
  assert.equal(crosschainTxUrl("btc", null, "deadbeef"), "https://mempool.space/tx/deadbeef");
  assert.equal(crosschainTxUrl("sol", null, "sig"), "https://solscan.io/tx/sig");
  assert.equal(crosschainAddressUrl("near", null, "alice.near"), "https://nearblocks.io/address/alice.near");
});

test("missing values never fabricate a URL", () => {
  assert.equal(crosschainTxUrl(null, null, "abc"), undefined);
  assert.equal(crosschainTxUrl("btc", null, undefined), undefined);
  assert.equal(crosschainAddressUrl("sol", null, ""), undefined);
});

test("the first usable 1Click hash is selected, and no upstream URL is trusted", () => {
  const hashes = [{ hash: "" }, { hash: " bbb " }, { hash: "ccc" }];
  assert.equal(firstHash(hashes), "bbb");
  assert.equal(firstHash(undefined), undefined);
});

test("EVM chain keys resolve for destination links", () => {
  assert.equal(evmChainIdForKey("base"), 8453);
  assert.equal(evmChainIdForKey("eth"), 1);
  assert.equal(evmChainIdForKey("sol"), undefined);
});
