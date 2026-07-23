import { test } from "node:test";
import assert from "node:assert/strict";
import { parseConfirmParams } from "./confirmParams.ts";

test("parses raw base-unit assets into a positive bigint", () => {
  const p = parseConfirmParams(new URLSearchParams("assets=1000000"));
  assert.equal(p.assets, 1_000_000n);
  assert.equal(p.shares, undefined);
  assert.equal(p.vaultSelected, null);
});

test("parses withdraw-by-shares + a vault selection", () => {
  const p = parseConfirmParams(new URLSearchParams("shares=5000000&vault=0xAbC"));
  assert.equal(p.shares, 5_000_000n);
  assert.equal(p.assets, undefined);
  assert.equal(p.vaultSelected, "0xAbC");
});

test("fails safe to undefined on missing / empty / non-integer / zero / negative amounts", () => {
  assert.equal(parseConfirmParams(new URLSearchParams("")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=0")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=1.5")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=-5")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=1e6")).assets, undefined);
  assert.equal(parseConfirmParams(new URLSearchParams("assets=abc")).assets, undefined);
});

test("tolerates surrounding whitespace in an otherwise-integer amount", () => {
  const p = parseConfirmParams(new URLSearchParams("assets=%20100%20"));
  assert.equal(p.assets, 100n);
});
