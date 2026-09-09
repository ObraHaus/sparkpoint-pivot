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

test("the plan summary never contradicts the risk tier the user chose (029/FR-015)", () => {
  // Shipped verbatim to a tester: "High risk (5/5), capital-preservation-first."
  const high = buildMandateDraft({
    experience: null,
    goal: "Aggressive growth",
    timeline: "3+ years",
    riskAns: "Buy more",
    riskTier: 5,
  });
  assert.match(high.summaryText, /High risk \(5\/5\)/);
  assert.ok(
    !/capital-preservation/i.test(high.summaryText),
    `a high-risk plan must not claim capital preservation: ${high.summaryText}`,
  );
  assert.match(high.summaryText, /growth-first/);
});

test("a conservative plan still says capital-preservation-first", () => {
  const low = buildMandateDraft({
    experience: null,
    goal: "Steady USDC yield",
    timeline: "1-3 years",
    riskAns: "Hold",
    riskTier: 1,
  });
  assert.match(low.summaryText, /Lower risk \(1\/5\), capital-preservation-first\./);
});

test("every tier produces a summary that is internally consistent", () => {
  for (const riskTier of [1, 2, 3, 4, 5]) {
    const m = buildMandateDraft({
      experience: null,
      goal: "Steady USDC yield",
      timeline: "1-3 years",
      riskAns: "Hold",
      riskTier,
    });
    assert.match(m.summaryText, new RegExp(`\\(${riskTier}/5\\)`));
    if (riskTier >= 3) {
      assert.ok(!/capital-preservation/i.test(m.summaryText), m.summaryText);
    }
  }
});

// ── 030 · the plan finally carries what the assistant asks users to set ───────

const BASE = {
  experience: null,
  goal: "Reach a target",
  timeline: "1–3 years",
  riskAns: "Hold",
  riskTier: 4,
};

test("an exposure limit reaches the wire in base units", () => {
  const m = buildMandateDraft({ ...BASE, exposureLimit: "500" });
  assert.equal(m.exposureLimitUsdc, "500000000");
});

test("a goal is atomic — an amount without a date is not sent at all", () => {
  // "Reach a target — hit a specific amount" used to store the bare label with no amount and no
  // date. Half a goal is worse than none, because it looks set.
  const amountOnly = buildMandateDraft({ ...BASE, goalTargetAmount: "10000" });
  assert.equal(amountOnly.goalTargetUsdc, undefined);
  assert.equal(amountOnly.goalTargetDate, undefined);

  const dateOnly = buildMandateDraft({ ...BASE, goalTargetDate: "2027-03-01" });
  assert.equal(dateOnly.goalTargetUsdc, undefined);

  const both = buildMandateDraft({
    ...BASE,
    goalTargetAmount: "10000",
    goalTargetDate: "2027-03-01",
  });
  assert.equal(both.goalTargetUsdc, "10000000000");
  assert.equal(both.goalTargetDate, "2027-03-01");
});

test("blank and malformed fields mean NOT STATED, never zero", () => {
  for (const bad of ["", "   ", "0", "-5", "12.5", "abc"]) {
    const m = buildMandateDraft({ ...BASE, exposureLimit: bad });
    assert.equal(m.exposureLimitUsdc, undefined, bad);
  }
  const none = buildMandateDraft(BASE);
  assert.equal(none.exposureLimitUsdc, undefined);
  assert.equal(none.goalTargetUsdc, undefined);
});

test("the chosen tier is carried so Settings and the summary agree", () => {
  assert.equal(buildMandateDraft({ ...BASE, riskTier: 5 }).riskTier, 5);
  assert.equal(buildMandateDraft({ ...BASE, riskTier: 5 }).riskProfile, "growth");
});
