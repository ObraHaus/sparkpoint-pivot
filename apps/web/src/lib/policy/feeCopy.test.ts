import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERFORMANCE_FEE_DISCLOSURE,
  feeBasisRecoverySentence,
  feeBasisShortLabel,
  feeCapEnforcementLabel,
  performanceFeeDisclosure,
  vaultFeeBasis,
} from "./feeCopy.ts";

test("PERFORMANCE_FEE_DISCLOSURE is the verbatim §3.7 canonical string", () => {
  assert.equal(
    PERFORMANCE_FEE_DISCLOSURE,
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on your " +
      "principal. We only earn when you earn — never on your principal, never by taking custody.",
  );
});

// ── 024/T024 — the fee basis must follow the vault's REAL mechanics ────────────────────────────

test("the legacy alias stays byte-identical to the high-water-mark disclosure (015/FR-006 parity)", () => {
  assert.equal(performanceFeeDisclosure("high_water_mark"), PERFORMANCE_FEE_DISCLOSURE);
});

test("vaultFeeBasis: SparkPoint's own vaults keep a real high-water mark", () => {
  assert.equal(vaultFeeBasis("first_party"), "high_water_mark");
  assert.equal(vaultFeeBasis("legacy_wrapper"), "high_water_mark");
});

test("vaultFeeBasis: a Morpho Vault V2 Fee Wrapper has NO high-water mark", () => {
  assert.equal(vaultFeeBasis("fee_wrapper"), "per_period_gain");
  // A passthrough carries no SparkPoint fee; the conservative basis prevents over-promising.
  assert.equal(vaultFeeBasis("external_4626"), "per_period_gain");
});

test("a Fee Wrapper disclosure never claims a high-water mark, and states the under-water charge", () => {
  const copy = performanceFeeDisclosure("per_period_gain");
  assert.doesNotMatch(copy, /high-water/i);
  assert.match(copy, /gain following an earlier loss is charged/);
  assert.match(copy, /below your previous high/);
  // What stays true on BOTH bases — never dropped.
  assert.match(copy, /never on your principal/);
  assert.match(copy, /never while it is flat or falling/);
});

test("the recovery sentence is opposite on the two bases — the load-bearing difference", () => {
  assert.match(feeBasisRecoverySentence("high_water_mark"), /you pay nothing until/);
  assert.doesNotMatch(feeBasisRecoverySentence("per_period_gain"), /pay nothing/);
  assert.match(feeBasisRecoverySentence("per_period_gain"), /charged even while you are below/);
});

test("the short basis label never says high-water mark for a Fee Wrapper", () => {
  assert.equal(feeBasisShortLabel("high_water_mark"), "over high-water mark");
  assert.doesNotMatch(feeBasisShortLabel("per_period_gain"), /high-water/i);
});

test("only a bytecode-capped vault may claim the cap is immutable", () => {
  assert.match(feeCapEnforcementLabel("high_water_mark"), /immutable/);
  // v3.0.0 downgraded this to a policy commitment on the Fee Wrapper path — claiming
  // immutability there would be false (amendment, "The one genuine weakening").
  assert.doesNotMatch(feeCapEnforcementLabel("per_period_gain"), /immutable/);
  assert.match(feeCapEnforcementLabel("per_period_gain"), /timelock/);
});
