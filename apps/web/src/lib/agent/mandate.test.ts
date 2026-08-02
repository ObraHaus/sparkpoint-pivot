import { test } from "node:test";
import assert from "node:assert/strict";
import { mandateView, timelineLabel, mandateDrift, hasSavedMandate } from "./mandate.ts";

test("maps a conservative wire mandate to tier 1 + real goal/timeline/slippage", () => {
  const v = mandateView({
    version: 2,
    active: true,
    riskProfile: "conservative",
    riskParams: { maxSlippageBps: 50, drawdownTolerance: "low", horizonMonths: 12 },
    goals: [{ kind: "grow_savings", label: "Grow my savings safely" }],
    summaryText: "Conservative, capital-preservation focus.",
  });
  assert.ok(v);
  assert.equal(v!.tier, 1);
  assert.equal(v!.riskLabel, "Lower");
  assert.equal(v!.goal, "Grow my savings safely");
  assert.equal(v!.timeline, "1 year");
  assert.equal(v!.maxSlippageBps, 50);
  assert.equal(v!.active, true);
  assert.equal(v!.version, 2);
});

test("moderate → tier 3, growth → tier 4; unknown profile falls back to conservative", () => {
  assert.equal(mandateView({ riskProfile: "moderate" })!.tier, 3);
  assert.equal(mandateView({ riskProfile: "growth" })!.tier, 4);
  assert.equal(mandateView({ riskProfile: "reckless" })!.tier, 1);
});

test("null/garbled wire ⇒ null; missing goal falls back to summary then default", () => {
  assert.equal(mandateView(null), null);
  assert.equal(mandateView(undefined), null);
  assert.equal(mandateView({ summaryText: "My plan" })!.goal, "My plan");
  assert.equal(mandateView({})!.goal, "Steady USDC yield");
});

test("timelineLabel buckets months honestly", () => {
  assert.equal(timelineLabel(undefined), "—");
  assert.equal(timelineLabel(0), "—");
  assert.equal(timelineLabel(3), "3 months");
  assert.equal(timelineLabel(1), "1 month");
  assert.equal(timelineLabel(12), "1 year");
  assert.equal(timelineLabel(18), "1.5 years");
  assert.equal(timelineLabel(36), "3 years");
});

test("drift: realized ≤ target is on-plan; exceeding is above-plan; missing is unknown", () => {
  assert.equal(mandateDrift(1, 1), "on_plan"); // tier-1 vault vs conservative
  assert.equal(mandateDrift(3, 1), "on_plan"); // conservative vault under a moderate mandate
  assert.equal(mandateDrift(1, 3), "above_plan");
  assert.equal(mandateDrift(undefined, 1), "unknown");
  assert.equal(mandateDrift(1, undefined), "unknown");
});

test("hasSavedMandate: only a real persisted mandate counts as onboarded", () => {
  // §3.1 answers 200 with `{"mandate": null}` when the user has none — that is a NO, and it must
  // not be confused with the read having failed (the caller fails open on the latter).
  assert.equal(hasSavedMandate({ mandate: null }), false);
  assert.equal(hasSavedMandate({ mandate: { riskProfile: "conservative", version: 1 } }), true);
  assert.equal(hasSavedMandate({}), false);
  assert.equal(hasSavedMandate(undefined), false);
  assert.equal(hasSavedMandate(null), false);
  assert.equal(hasSavedMandate("nope"), false);
  assert.equal(hasSavedMandate({ mandate: "nope" }), false);
});

test("hasSavedMandate agrees with mandateView, so /verify and Settings can't disagree", () => {
  for (const wire of [null, undefined, {}, { riskProfile: "growth" }, { version: 3 }]) {
    assert.equal(hasSavedMandate({ mandate: wire }), mandateView(wire) !== null);
  }
});
