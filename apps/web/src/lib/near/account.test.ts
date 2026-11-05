import test from "node:test";
import assert from "node:assert/strict";

import { isValidNearAccountId, truncateNearAccount } from "./account.ts";

const IMPLICIT = "93a4f6f8c1a9d3b7e2f5a8c4d6b1e9f3a7c2d8b5e4f1a6c9d3b7e2f5a8c4d6b1";

test("NEAR account ids: named, subaccounts and implicit hex are valid", () => {
  assert.equal(isValidNearAccountId("sparkpoint2026.near"), true);
  assert.equal(isValidNearAccountId("app.rhea.finance"), true);
  assert.equal(isValidNearAccountId("my-account_1.near"), true);
  assert.equal(isValidNearAccountId(IMPLICIT), true);
  assert.equal(isValidNearAccountId("  sparkpoint2026.near  "), true);
});

test("NEAR account ids: uppercase, empty, separators and over-long names are rejected", () => {
  assert.equal(isValidNearAccountId(""), false);
  assert.equal(isValidNearAccountId("Sparkpoint2026.near"), false);
  assert.equal(isValidNearAccountId(".near"), false);
  assert.equal(isValidNearAccountId("a..b"), false);
  assert.equal(isValidNearAccountId("bad..near"), false);
  assert.equal(isValidNearAccountId("a/near"), false);
  assert.equal(isValidNearAccountId(IMPLICIT.slice(0, 63)), false);
  assert.equal(isValidNearAccountId(`${IMPLICIT}0`), false);
  assert.equal(isValidNearAccountId(IMPLICIT.toUpperCase()), false);
  assert.equal(isValidNearAccountId("a".repeat(65)), false);
  assert.equal(isValidNearAccountId("-bad"), false);
  // An EVM address is syntactically a valid NEAR named account — but accepting it would let a NEAR
  // account alias an EVM owner string in the chain-agnostic user key (Defender 076 high finding).
  assert.equal(isValidNearAccountId("0x1111111111111111111111111111111111111111"), false);
  assert.equal(isValidNearAccountId("0xAbCdEf0000000000000000000000000000000000"), false);
});

test("truncation keeps short named ids whole and shortens long implicit ids", () => {
  assert.equal(truncateNearAccount("sparkpoint2026.near"), "sparkpoint2026.near");
  assert.equal(truncateNearAccount("  sparkpoint2026.near  "), "sparkpoint2026.near");
  assert.equal(truncateNearAccount(IMPLICIT), "93a4f6f8c1…c4d6b1");
  assert.equal(truncateNearAccount("abcdefghijklmnopqrstuvwxyz"), "abcdefghij…uvwxyz");
  assert.equal(truncateNearAccount("", 4, 2), "");
});
