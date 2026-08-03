import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_CHAIN_ID, resolveChainId } from "./identity.ts";

test("NaN — the value that actually shipped — never reaches the wire", () => {
  // The Aug-3 regression: wagmi reported NaN mid-reconnect, `?? DEFAULT` did not catch it, and
  // `x-chain-id: NaN` went out on 7/7 requests.
  assert.equal(resolveChainId(NaN), DEFAULT_CHAIN_ID);
  assert.equal(resolveChainId(Number("not-a-chain")), DEFAULT_CHAIN_ID);
});

test("absent / empty values fall back", () => {
  for (const v of [undefined, null, "", 0, -1]) {
    assert.equal(resolveChainId(v), DEFAULT_CHAIN_ID, String(v));
  }
});

test("non-integer and non-finite values fall back", () => {
  for (const v of [1.5, Infinity, -Infinity]) {
    assert.equal(resolveChainId(v), DEFAULT_CHAIN_ID, String(v));
  }
});

test("supported chains pass through untouched", () => {
  assert.equal(resolveChainId(8453), 8453); // Base
  assert.equal(resolveChainId(84532), 84532); // Base Sepolia
});

test("a numeric string is coerced, not rejected", () => {
  assert.equal(resolveChainId("84532"), 84532);
});

test("an unsupported network falls back rather than being asserted to the agent", () => {
  assert.equal(resolveChainId(1), DEFAULT_CHAIN_ID); // Ethereum mainnet is not a chat chain
  assert.equal(resolveChainId(999999), DEFAULT_CHAIN_ID);
});

test("an explicit fallback is honoured", () => {
  assert.equal(resolveChainId(NaN, 84532), 84532);
});

test("the result is ALWAYS a finite positive integer", () => {
  for (const v of [NaN, undefined, "x", {}, [], Infinity, 84532, "8453"]) {
    const out = resolveChainId(v);
    assert.ok(Number.isInteger(out) && out > 0, `${String(v)} → ${out}`);
    assert.ok(!String(out).includes("NaN"));
  }
});
