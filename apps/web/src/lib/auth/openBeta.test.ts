import { test } from "node:test";
import assert from "node:assert/strict";
import { betaGateOpen } from "./openBeta.ts";

test("an explicit true opens the beta (case/whitespace-insensitive)", () => {
  assert.equal(betaGateOpen("true"), true);
  assert.equal(betaGateOpen("TRUE"), true);
  assert.equal(betaGateOpen("True"), true);
  assert.equal(betaGateOpen(" true "), true);
});

test("unset / empty / anything else keeps the allowlist in force (fail-closed)", () => {
  assert.equal(betaGateOpen(undefined), false);
  assert.equal(betaGateOpen(null), false);
  assert.equal(betaGateOpen(""), false);
  assert.equal(betaGateOpen("   "), false);
  assert.equal(betaGateOpen("false"), false);
  assert.equal(betaGateOpen("1"), false);
  assert.equal(betaGateOpen("yes"), false);
  assert.equal(betaGateOpen("opens"), false); // a typo'd value must not open it
});
