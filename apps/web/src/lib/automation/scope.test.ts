import { test } from "node:test";
import assert from "node:assert/strict";

import { toFunctionSelector } from "viem";

import { buildRevokeTx, revokeSessionKeyCalldata } from "./scope.ts";

const ACCOUNT = "0x1111111111111111111111111111111111111111";
const SESSION = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
// The on-chain selector the server also uses (sessions.py `_REVOKE_SELECTOR`).
const REVOKE_SELECTOR = "0x84f4fc6a";

test("revokeSessionKeyCalldata selector matches revokeSessionKey(address) (server parity)", () => {
  const data = revokeSessionKeyCalldata(SESSION);
  assert.equal(data.slice(0, 10), REVOKE_SELECTOR);
  assert.equal(data.slice(0, 10), toFunctionSelector("revokeSessionKey(address)"));
});

test("revokeSessionKeyCalldata ABI-encodes the session address (left-padded)", () => {
  const data = revokeSessionKeyCalldata(SESSION);
  assert.equal(data.length, 10 + 64); // selector + one 32-byte word
  assert.ok(data.toLowerCase().endsWith(SESSION.slice(2).toLowerCase()));
});

test("buildRevokeTx targets the user's OWN account, value 0 (a self-signed sacred exit)", () => {
  const tx = buildRevokeTx(ACCOUNT, SESSION, 84532);
  assert.ok(tx);
  assert.equal(tx!.to, ACCOUNT);
  assert.equal(tx!.value, "0");
  assert.equal(tx!.chainId, 84532);
  assert.equal(tx!.data, revokeSessionKeyCalldata(SESSION));
});

test("buildRevokeTx returns null when the account isn't known (caller falls back to /revoke/build)", () => {
  assert.equal(buildRevokeTx(undefined, SESSION, 84532), null);
});
