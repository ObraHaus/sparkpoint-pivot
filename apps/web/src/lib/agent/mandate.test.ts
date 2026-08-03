import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mandateView,
  mandateSummary,
  timelineLabel,
  mandateDrift,
  driftLabel,
  hasSavedMandate,
} from "./mandate.ts";

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

test("drift: matching is on-plan; exceeding is above-plan; missing is unknown", () => {
  assert.equal(mandateDrift(1, 1), "on_plan"); // tier-1 vault vs conservative
  assert.equal(mandateDrift(1, 3), "above_plan");
  assert.equal(mandateDrift(undefined, 1), "unknown");
  assert.equal(mandateDrift(1, undefined), "unknown");
  // 030 — holding BELOW the mandate used to be folded into "on plan", which hid the only case
  // the indicator could ever have flagged with one strategy live. It is now distinguishable.
  assert.equal(mandateDrift(3, 1), "below_plan");
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

// ── 030 · drift can finally say the thing that matters ────────────────────────

test("a growth plan holding only the tier-1 vault reads BELOW plan, not 'on plan'", () => {
  // The pre-030 rule was `realized > target`, so with one tier-1 strategy live it could only ever
  // say "on plan". The case it could not express is the one that matters most right now.
  assert.equal(mandateDrift(4, 1), "below_plan");
  assert.equal(mandateDrift(5, 1), "below_plan");
});

test("the other verdicts are unchanged", () => {
  assert.equal(mandateDrift(1, 1), "on_plan");
  assert.equal(mandateDrift(1, 4), "above_plan");
  assert.equal(mandateDrift(undefined, 1), "unknown");
  assert.equal(mandateDrift(1, undefined), "unknown");
});

test("below-plan copy observes; it never urges more risk", () => {
  const copy = driftLabel("below_plan").toLowerCase();
  for (const nudge of ["should", "consider taking", "increase your risk", "you could earn"]) {
    assert.ok(!copy.includes(nudge), `${nudge} in: ${copy}`);
  }
  assert.match(copy, /that's fine/);
});

test("every status has copy except unknown, which stays silent", () => {
  assert.ok(driftLabel("above_plan").length > 0);
  assert.ok(driftLabel("on_plan").length > 0);
  assert.equal(driftLabel("unknown"), "");
});

// ── 030 · one risk scale, and a summary that cannot contradict itself ─────────

test("mandate v6's exact stored contradiction never reaches the screen", () => {
  // Verbatim from GET /mandate on alpha: riskProfile "growth" with a stored summary reading
  // "High risk (5/5), capital-preservation-first." 029 fixed the code that WRITES summaries;
  // every existing row kept its stale string and the UI showed it verbatim.
  const v = mandateView({
    version: 6,
    active: true,
    riskProfile: "growth",
    summaryText: "High risk (5/5), capital-preservation-first.",
    riskParams: { maxSlippageBps: 50, drawdownTolerance: "high", horizonMonths: 48 },
  });
  assert.ok(v);
  assert.ok(!/capital-preservation/i.test(v.summary), v.summary);
  assert.match(v.summary, /growth-leaning|growth-first/);
  // The stored string is still available for reference, but it is not what the UI shows.
  assert.match(v.summaryText, /capital-preservation-first/);
});

test("the tier the user CHOSE wins over the profile's default tier", () => {
  // Three scales were in play: onboarding showed 1..5, the server stored three profiles, and
  // this module mapped growth back to 4 — so someone who picked 5 saw 5/5 and 4/5 at once.
  const chosen = mandateView({ riskProfile: "growth", riskTier: 5 });
  assert.equal(chosen?.tier, 5);
  assert.equal(chosen?.riskLabel, "High");
  assert.match(chosen!.summary, /High risk \(5\/5\)/);

  // A pre-030 mandate has no chosen tier and falls back to the profile mapping, as before.
  assert.equal(mandateView({ riskProfile: "growth" })?.tier, 4);
});

test("an out-of-range chosen tier falls back rather than rendering nonsense", () => {
  for (const bad of [0, 6, -1, NaN]) {
    assert.equal(mandateView({ riskProfile: "conservative", riskTier: bad })?.tier, 1, String(bad));
  }
});

test("no summary at any tier contradicts itself", () => {
  for (let tier = 1; tier <= 5; tier++) {
    const summary = mandateSummary(tier);
    assert.match(summary, new RegExp(`\\(${tier}/5\\)`));
    if (tier >= 3) assert.ok(!/capital-preservation/i.test(summary), summary);
  }
});

test("the new plan fields are absent when never stated — never zero", () => {
  const v = mandateView({ riskProfile: "conservative" });
  assert.equal(v?.exposureLimitUsdc, undefined);
  assert.equal(v?.goalTargetUsdc, undefined);
  assert.equal(v?.goalTargetDate, undefined);
  assert.equal(v?.contribution, undefined);
  assert.equal(v?.allowedProtocols, undefined);
});

test("stated plan fields are read back", () => {
  const v = mandateView({
    riskProfile: "growth",
    riskTier: 4,
    exposureLimitUsdc: "500000000",
    goalTargetUsdc: "10000000000",
    goalTargetDate: "2027-03-01",
    allowedProtocols: ["aave_v3"],
    contribution: { amountUsdc: "200000000", cadence: "monthly" },
  });
  assert.equal(v?.exposureLimitUsdc, "500000000");
  assert.equal(v?.goalTargetDate, "2027-03-01");
  assert.deepEqual(v?.allowedProtocols, ["aave_v3"]);
  assert.equal(v?.contribution?.cadence, "monthly");
});

test("a half-formed contribution is dropped rather than half-rendered", () => {
  assert.equal(mandateView({ contribution: { cadence: "monthly" } })?.contribution, undefined);
});
