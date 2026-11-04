import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_NEAR_NETWORK, parseNearNetwork, parseNearRpcUrl } from "./network.ts";

test("NEAR network parsing defaults to mainnet and never guesses testnet", () => {
  assert.equal(DEFAULT_NEAR_NETWORK, "mainnet");
  assert.equal(parseNearNetwork(undefined), "mainnet");
  assert.equal(parseNearNetwork(null), "mainnet");
  assert.equal(parseNearNetwork(""), "mainnet");
  assert.equal(parseNearNetwork("  "), "mainnet");
  assert.equal(parseNearNetwork("mainnet"), "mainnet");
  assert.equal(parseNearNetwork("MAINNET"), "mainnet");
  assert.equal(parseNearNetwork("testnet"), "testnet");
  assert.equal(parseNearNetwork(" TestNet "), "testnet");
  assert.equal(parseNearNetwork("betanet"), "mainnet");
  assert.equal(parseNearNetwork("test"), "mainnet");
});

test("NEAR RPC URL is optional and only an absolute http(s) URL is accepted", () => {
  assert.equal(parseNearRpcUrl(undefined), undefined);
  assert.equal(parseNearRpcUrl(""), undefined);
  assert.equal(parseNearRpcUrl("not a url"), undefined);
  assert.equal(parseNearRpcUrl("ftp://rpc.example"), undefined);
  assert.equal(parseNearRpcUrl("https://rpc.mainnet.near.org"), "https://rpc.mainnet.near.org/");
  assert.equal(parseNearRpcUrl("http://127.0.0.1:3030"), "http://127.0.0.1:3030/");
});
