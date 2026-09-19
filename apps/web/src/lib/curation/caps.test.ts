import assert from "node:assert/strict";
import { test } from "node:test";

import { CAP_DEFAULTS, toRawCaps } from "./caps.ts";

test("whole units convert at the asset's decimals", () => {
  assert.equal(toRawCaps("5000", 6), "5000000000");
  assert.equal(toRawCaps("1", 6), "1000000");
  assert.equal(toRawCaps("0", 6), "0");
  assert.equal(toRawCaps("1", 18), "1000000000000000000");
});

test("decimal input pads to the asset's precision and never over-pads", () => {
  assert.equal(toRawCaps("1.5", 6), "1500000");
  assert.equal(toRawCaps("0.000001", 6), "1");
  assert.equal(toRawCaps("0.0000001", 6), null); // more precise than the asset
});

test("thousands separators are accepted", () => {
  assert.equal(toRawCaps("5,000", 6), "5000000000");
  assert.equal(toRawCaps("1,000,000", 6), "1000000000000");
});

test("malformed input is refused rather than guessed at", () => {
  for (const bad of ["", "abc", "-1", "1e6", ".5", "1.", "1.2.3", "1,000.0000000"]) {
    assert.equal(toRawCaps(bad, 6), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test("the defaults are the policy defaults", () => {
  assert.equal(toRawCaps(CAP_DEFAULTS.perUser, 6), "5000000000");
  assert.equal(toRawCaps(CAP_DEFAULTS.total, 6), "1000000000000");
});
