import assert from "node:assert/strict";
import { test } from "node:test";

import { tipLabel } from "./tipLabel.ts";

test("the identifiers that actually leaked on screen are never shown raw", () => {
  // All three were photographed above tip cards during the Aug-3 battery.
  for (const slug of ["vault_safety", "what_are_vault_shares", "vault_apy"]) {
    const label = tipLabel(slug);
    assert.ok(!label.includes("_"), `${slug} → ${label}`);
    assert.notEqual(label, slug);
  }
});

test("known topics read as questions a person would ask", () => {
  assert.equal(tipLabel("what_is_apy"), "What is APY?");
  assert.equal(tipLabel("what_is_a_performance_fee"), "What is a performance fee?");
  assert.equal(tipLabel("what_is_non_custodial"), "What does non-custodial mean?");
});

test("an unknown topic is humanised rather than dumped", () => {
  assert.equal(tipLabel("some_new_topic"), "Some new topic");
  assert.ok(!tipLabel("a_brand_new_thing").includes("_"));
});

test("acronyms survive humanising", () => {
  assert.equal(tipLabel("usdc_basics"), "USDC basics");
  assert.equal(tipLabel("apy_vs_apr"), "APY vs APR");
});

test("a missing or empty topic gets a neutral heading, never a blank bar", () => {
  for (const v of [undefined, null, "", "   "]) {
    assert.equal(tipLabel(v), "Good to know");
  }
});

test("no output ever contains an underscore", () => {
  for (const v of ["a_b_c", "x", "WHAT_IS_APY", "trailing_", "_leading"]) {
    assert.ok(!tipLabel(v).includes("_"), v);
  }
});
