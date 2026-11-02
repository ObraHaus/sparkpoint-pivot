import test from "node:test";
import assert from "node:assert/strict";

import {
  addressKindForOrigin,
  expectedAddressDescription,
  isValidAddress,
} from "./address.ts";

test("EVM addresses are exactly 20 bytes with a 0x prefix", () => {
  assert.equal(isValidAddress("0x0000000000000000000000000000000000000001", "evm"), true);
  assert.equal(isValidAddress("0xAbCdEf0000000000000000000000000000000001", "evm"), true);
  assert.equal(isValidAddress("0x000000000000000000000000000000000000001", "evm"), false);
  assert.equal(isValidAddress("0000000000000000000000000000000000000001", "evm"), false);
});

test("Bitcoin accepts bech32 (bc1/tb1) and base58", () => {
  assert.equal(isValidAddress("bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "btc"), true);
  assert.equal(isValidAddress("tb1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq", "btc"), true);
  assert.equal(isValidAddress("1BoatSLRHtKNngkdXEeobR76b53LETtpyT", "btc"), true);
  assert.equal(isValidAddress("not-a-bitcoin-address", "btc"), false);
});

test("Solana, Tron and NEAR mirror the backend shapes", () => {
  assert.equal(isValidAddress("So11111111111111111111111111111111111111112", "sol"), true);
  assert.equal(isValidAddress("0OIl", "sol"), false);
  assert.equal(isValidAddress("TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7", "tron"), true);
  assert.equal(isValidAddress("Tla2f6VPqDgRE67v1736s7bJ8Ray5wYjU7", "tron"), false);
  assert.equal(isValidAddress("sparkpoint.near", "near"), true);
  assert.equal(isValidAddress("SparkPoint.near", "near"), false);
});

test("surrounding whitespace is trimmed, an empty string is invalid", () => {
  assert.equal(isValidAddress("  0x0000000000000000000000000000000000000001  ", "evm"), true);
  assert.equal(isValidAddress("   ", "evm"), false);
});

test("the origin address family is inferred without adding a wire field", () => {
  assert.equal(addressKindForOrigin("base", 8453), "evm");
  assert.equal(addressKindForOrigin("eth", 1), "evm");
  assert.equal(addressKindForOrigin("btc", null), "btc");
  assert.equal(addressKindForOrigin("sol", null), "sol");
  assert.equal(addressKindForOrigin("tron", null), "tron");
  assert.equal(addressKindForOrigin("near", null), "near");
  assert.equal(addressKindForOrigin("unknown", null), null);
});

test("descriptions match the agent's validation messages", () => {
  assert.match(expectedAddressDescription("evm"), /20-byte 0x/);
  assert.match(expectedAddressDescription("btc"), /bech32 or base58/);
  assert.match(expectedAddressDescription("sol"), /32–44/);
  assert.match(expectedAddressDescription("tron"), /T \+ 33/);
  assert.match(expectedAddressDescription("near"), /NEAR account/);
});
