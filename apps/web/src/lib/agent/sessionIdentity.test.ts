import assert from "node:assert/strict";
import { test } from "node:test";

import { isClientAccountMismatched } from "./sessionIdentity.ts";

const LOWER = "0xbdda41d11014fdd9a656386e29af1a1349f94f13";
const CHECKSUM = "0xBddA41D11014FdD9a656386e29Af1a1349f94f13";
const OTHER = "0x1111111111111111111111111111111111111111";
const evmSession = (address: string) => ({ address, chain: "evm" as const });
const nearSession = (address: string) => ({ address, chain: "near" as const });

test("the same EVM wallet in checksum vs lowercase is accepted", () => {
  assert.equal(isClientAccountMismatched(evmSession(LOWER), CHECKSUM, CHECKSUM), false);
  assert.equal(isClientAccountMismatched(evmSession(CHECKSUM), LOWER, LOWER), false);
});

test("surrounding whitespace does not change the address", () => {
  assert.equal(isClientAccountMismatched(evmSession(LOWER), ` ${CHECKSUM} `, null), false);
});

test("a DIFFERENT EVM address is rejected (cannot act as another wallet)", () => {
  assert.equal(isClientAccountMismatched(evmSession(LOWER), OTHER, OTHER), true);
  assert.equal(isClientAccountMismatched(evmSession(LOWER), LOWER, OTHER), true);
  assert.equal(isClientAccountMismatched(evmSession(LOWER), OTHER, LOWER), true);
});

test("a client that asserts no identity is accepted (the BFF fills it from the session)", () => {
  assert.equal(isClientAccountMismatched(evmSession(LOWER), null, null), false);
  assert.equal(isClientAccountMismatched(evmSession(LOWER), CHECKSUM, null), false);
});

test("an empty/malformed account header is a mismatch, not a silent pass", () => {
  assert.equal(isClientAccountMismatched(evmSession(LOWER), "", null), true);
});

test("a NEAR session is not wagmi-bound, so an EVM client header is not a contradiction", () => {
  // Signed in with NEAR while MetaMask is also connected: the BFF still scopes to the NEAR account.
  assert.equal(isClientAccountMismatched(nearSession("sparkpoint2026.near"), CHECKSUM, CHECKSUM), false);
});

test("a pre-076 session without a chain is treated as EVM", () => {
  assert.equal(isClientAccountMismatched({ address: LOWER }, CHECKSUM, CHECKSUM), false);
  assert.equal(isClientAccountMismatched({ address: LOWER }, OTHER, OTHER), true);
});
