import assert from "node:assert/strict";
import { test } from "node:test";

import { crosschainChainIdHeader } from "./requestHeaders.ts";

const AGENT_CHAINS = ["8453", "84532", "4663", "46630"];

test("EVM SIWE on Robinhood (4663) uses the Base (8453) swap source chain", () => {
  // The reported bug: signed in on 4663, wallet swapped to Base for the deposit-address step.
  // The header must carry the SOURCE chain, not the session chain.
  assert.equal(crosschainChainIdHeader(8453, 4663), "8453");
});

test("EVM SIWE on Base (8453) uses the same Base source chain", () => {
  assert.equal(crosschainChainIdHeader(8453, 8453), "8453");
});

test("Robinhood source from a Base session is equally accepted", () => {
  assert.equal(crosschainChainIdHeader(4663, 8453), "4663");
});

test("a non-EVM origin falls back to the caller's connected chain", () => {
  // BTC/SOL/NEAR origins carry evmChainId=null; the header is transport scoping only.
  assert.equal(crosschainChainIdHeader(null, 8453), "8453");
  assert.equal(crosschainChainIdHeader(undefined, 4663), "4663");
});

test("an unsupported origin never reaches the wire", () => {
  assert.equal(crosschainChainIdHeader(1, 8453), "8453");
});

test("the local Anvil fork (31337) is never asserted to the agent", () => {
  // CHAIN_META knows 31337, but the agent's X-Chain-Id gate does not accept it.
  assert.equal(crosschainChainIdHeader(31337, 8453), "8453");
});

test("with no usable chain anywhere, the result is still an agent-accepted chain", () => {
  const value = crosschainChainIdHeader(null, undefined);
  assert.ok(AGENT_CHAINS.includes(value), `${value} is not in the agent's supported set`);
});

test("the value is always a decimal string — never NaN", () => {
  for (const [origin, fallback] of [
    [NaN, 8453],
    [Infinity, undefined],
    [null, null],
    ["8453", 8453],
  ] as const) {
    const value = crosschainChainIdHeader(origin as number | null, fallback as number | null);
    assert.match(value, /^\d+$/);
    assert.ok(AGENT_CHAINS.includes(value));
  }
});
