import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMandateDraft, type OnboardingAnswers } from "./mandateDraft.ts";

const SERVER_RISK_PROFILES = new Set(["conservative", "moderate", "growth"]);

function answers(patch: Partial<OnboardingAnswers>): OnboardingAnswers {
  return { experience: null, goal: null, timeline: null, riskAns: null, riskTier: 1, ...patch };
}

test("aggressive growth + slider tier 5 → server-valid 'growth', real goal kept", () => {
  const m = buildMandateDraft(
    answers({ goal: "Aggressive growth", timeline: "3+ years", riskAns: "Buy more while it's low", riskTier: 5 }),
  );
  assert.equal(m.riskProfile, "growth"); // NOT the rejected "aggressive"
  assert.ok(SERVER_RISK_PROFILES.has(m.riskProfile));
  assert.equal(m.goals[0].kind, "aggressive_growth"); // ordering bug fixed (not "grow_savings")
  assert.equal(m.goals[0].label, "Aggressive growth");
  assert.equal(m.riskParams.drawdownTolerance, "high");
  assert.equal(m.riskParams.horizonMonths, 48);
});

test("steady yield + short horizon + tier 1 → conservative, 6-month horizon", () => {
  const m = buildMandateDraft(answers({ goal: "Steady yield", timeline: "< 1 year", riskTier: 1 }));
  assert.equal(m.riskProfile, "conservative");
  assert.equal(m.goals[0].kind, "steady_yield");
  assert.equal(m.riskParams.horizonMonths, 6);
  assert.equal(m.riskParams.drawdownTolerance, "low");
});

test("grow savings + medium horizon + tier 3 → moderate, 24-month horizon", () => {
  const m = buildMandateDraft(answers({ goal: "Grow my savings", timeline: "1–3 years", riskTier: 3 }));
  assert.equal(m.riskProfile, "moderate");
  assert.equal(m.goals[0].kind, "grow_savings");
  assert.equal(m.riskParams.horizonMonths, 24);
  assert.equal(m.riskParams.drawdownTolerance, "medium");
});

test("reach a target maps to reach_target and keeps the label", () => {
  const m = buildMandateDraft(answers({ goal: "Reach a target", timeline: "3+ years", riskTier: 2 }));
  assert.equal(m.goals[0].kind, "reach_target");
  assert.equal(m.goals[0].label, "Reach a target");
  assert.equal(m.riskParams.horizonMonths, 48);
});

test("every slider tier 1..5 yields a server-accepted riskProfile (never 'aggressive')", () => {
  for (let t = 1; t <= 5; t++) {
    const m = buildMandateDraft(answers({ goal: "Steady yield", riskTier: t }));
    assert.ok(SERVER_RISK_PROFILES.has(m.riskProfile), `tier ${t} → ${m.riskProfile}`);
    assert.notEqual(m.riskProfile, "aggressive");
  }
});

test("summary reflects the shown tier; slippage + version are stable/advisory", () => {
  const m = buildMandateDraft(answers({ goal: "Steady yield", riskTier: 4 }));
  assert.equal(m.version, 1);
  assert.equal(m.riskParams.maxSlippageBps, 50);
  assert.match(m.summaryText, /4\/5/);
});
