import test from "node:test";
import assert from "node:assert/strict";

import { canSendFromWallet, humanToBaseUnits } from "./walletSend.ts";

test("wallet-send is offered only for an EVM origin this build registered", () => {
  assert.equal(canSendFromWallet(4663, [4663]), true);
  assert.equal(canSendFromWallet(8453, [8453, 84532, 46330]), true);
  assert.equal(canSendFromWallet(1, [8453, 84532, 46330]), false);
  assert.equal(canSendFromWallet(null, [4663]), false);
  assert.equal(canSendFromWallet(undefined, [4663]), false);
});

test("human amounts convert to exact base units (commas and short fractions too)", () => {
  assert.equal(humanToBaseUnits("5000", 6), 5_000_000_000n);
  assert.equal(humanToBaseUnits("5,000.50", 6), 5_000_500_000n);
  assert.equal(humanToBaseUnits("0.000001", 6), 1n);
  assert.equal(humanToBaseUnits("1", 0), 1n);
});

test("an over-precise, zero or malformed amount is refused, never rounded", () => {
  assert.equal(humanToBaseUnits("0.0000001", 6), null);
  assert.equal(humanToBaseUnits("0", 6), null);
  assert.equal(humanToBaseUnits("-5", 6), null);
  assert.equal(humanToBaseUnits("1e6", 6), null);
  assert.equal(humanToBaseUnits("", 6), null);
});
