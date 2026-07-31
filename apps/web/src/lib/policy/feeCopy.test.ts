import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PERFORMANCE_FEE_DISCLOSURE,
  feeBasisRecoverySentence,
  feeBasisShortLabel,
  feeCapEnforcementLabel,
  performanceFeeDisclosure,
  vaultFeeBasis,
  vaultFeeChain,
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

// ── 024 / T052 — the stacked fee chain as three separate lines ────────────────────────────────────

test("vaultFeeChain always returns exactly three lines, in chain order", () => {
  const lines = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: 0 });
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => l.kind),
    ["sparkpoint", "native", "net"],
  );
});

test("T052: 'not read' and 'none' never render the same — the whole point of the model", () => {
  // undefined = we did not read it. 0 = we read it and it is genuinely zero. Collapsing these turns
  // an absence of knowledge into a confident claim, the same error class as showing 0% for an
  // unavailable APY.
  const unread = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: 0 });
  assert.equal(unread[1].value, "not yet read");
  assert.equal(unread[1].unknown, true);

  const measuredZero = vaultFeeChain({
    basis: "per_period_gain",
    sparkpointFeeBps: 0,
    nativePerformanceFeeBps: 0,
    nativeManagementFeeBps: 0,
  });
  assert.equal(measuredZero[1].value, "0% — the underlying charges nothing");
  assert.equal(measuredZero[1].unknown, false);
  assert.notEqual(unread[1].value, measuredZero[1].value);
});

test("T052: an unavailable net APY renders 'unavailable', NEVER 0%", () => {
  // On Base Sepolia this is the permanent answer: Morpho's API covers no testnet. A 0% here would be
  // a fabricated yield (Principle III / FR-013).
  const lines = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: 1000 });
  assert.equal(lines[2].value, "unavailable");
  assert.equal(lines[2].unknown, true);
  assert.ok(!lines[2].value.includes("0"), "must not render a zero for an unknown rate");

  const measured = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: 1000, netApyBps: 0 });
  assert.equal(measured[2].value, "0%", "a MEASURED 0% is legal and distinct from unavailable");
  assert.equal(measured[2].unknown, false);
});

test("T052: our own 0% fee is stated plainly, not hidden", () => {
  // The deployed Base-Sepolia V2 charges nothing today. Silence would read as "there is a fee we are
  // not showing"; "0% — none charged" is a checkable claim.
  const lines = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: 0 });
  assert.equal(lines[0].value, "0% — none charged");
  assert.equal(lines[0].unknown, false);
});

test("T052: the SparkPoint line carries the fee BASIS, so a V2 cannot inherit HWM wording", () => {
  const v2 = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: 1000 });
  assert.ok(v2[0].label.includes("on each period's gain"));
  assert.ok(!v2[0].label.includes("high-water"), "a V2 keeps no high-water mark");

  const launch = vaultFeeChain({ basis: "high_water_mark", sparkpointFeeBps: 1000 });
  assert.ok(launch[0].label.includes("over high-water mark"));
});

test("T052: an unread SparkPoint fee says so rather than defaulting to 10%", () => {
  // useVault deliberately leaves this undefined until the read resolves; the policy default of 1000
  // must never leak in here, or we would display a fee the vault never reported.
  const lines = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: undefined });
  assert.equal(lines[0].value, "not yet read");
  assert.equal(lines[0].unknown, true);
  assert.ok(!lines[0].value.includes("10"));
});

test("T052: a registry note explains an absent child leg instead of implying zero", () => {
  // Our Base-Sepolia V2 allocates straight into a Blue market, so there is no child VAULT to stack
  // on — which is a fact worth stating, not a zero to assert.
  const lines = vaultFeeChain({
    basis: "per_period_gain",
    sparkpointFeeBps: 0,
    nativeFeeNote: "No child vault — allocates directly into a Morpho Blue market, which charges no vault fee.",
  });
  assert.ok(lines[1].value.startsWith("No child vault"));
  assert.equal(lines[1].unknown, false);
});

test("T052: native performance and management fees are shown separately when both are real", () => {
  const lines = vaultFeeChain({
    basis: "per_period_gain",
    sparkpointFeeBps: 1000,
    nativePerformanceFeeBps: 500,
    nativeManagementFeeBps: 25,
  });
  assert.equal(lines[1].value, "5% performance + 0.25% management");
});

test("T052: bps render without float drift", () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [1000, "10%"],
    [2000, "20%"],
    [25, "0.25%"],
    [5, "0.05%"],
    [1, "0.01%"],
    [425, "4.25%"],
  ];
  for (const [bps, want] of cases) {
    const lines = vaultFeeChain({ basis: "high_water_mark", sparkpointFeeBps: 1000, netApyBps: bps });
    assert.equal(lines[2].value, want, `${bps} bps`);
  }
});

test("T052: a negative net APY survives — a vault can lose money", () => {
  const lines = vaultFeeChain({ basis: "per_period_gain", sparkpointFeeBps: 1000, netApyBps: -120 });
  assert.equal(lines[2].value, "-1.2%");
  assert.equal(lines[2].unknown, false);
});
