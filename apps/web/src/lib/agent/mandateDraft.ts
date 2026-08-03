/**
 * Pure onboarding-answers → confirmed-mandate mapping (agent-service-api.md §3.1
 * `mandate_draft`). Extracted from the onboarding page so it is unit-testable with
 * node:test and carries NO JSX/React import. This is the SOURCE OF TRUTH the page
 * persists via POST /mandate: it must reflect the user's real answers (goal, the
 * 1..5 risk tier incl. the slider override, and timeline). The mandate is advisory
 * config — persisting it never authorizes moving funds.
 */

import type { MandateDraft } from "@/lib/agent/useAgent";

/** The locally-collected onboarding answers (mirrors the page's `Answers`). */
export interface OnboardingAnswers {
  experience: string | null;
  goal: string | null;
  timeline: string | null;
  riskAns: string | null;
  riskTier: number;
  /**
   * 030 — asked on the plan step, where the user is already reviewing and adjusting.
   *
   * `exposureLimit` is whole USDC. It is the field 029's advice boundary already tells users to
   * set ("how much you're willing to put at risk") and which, until now, the mandate could not
   * hold at all.
   *
   * A goal target is ATOMIC: an amount without a date is not a goal and is not sent. "Reach a
   * target — hit a specific amount" used to store the bare label, so nothing could ever say
   * whether the user was on track.
   */
  exposureLimit?: string;
  goalTargetAmount?: string;
  goalTargetDate?: string;
}

const TIER_NAMES: Record<number, string> = {
  1: "Lower risk",
  2: "Low risk",
  3: "Moderate",
  4: "Elevated",
  5: "High risk",
};

/**
 * The stance clause for each tier (029/FR-015).
 *
 * The summary used to end in a hardcoded "capital-preservation-first." for EVERY tier, so a user
 * who deliberately picked the highest risk setting was shown "High risk (5/5),
 * capital-preservation-first." as their own plan. A plan that contradicts itself is worse than a
 * blunt one: the user cannot tell which half the system will actually act on. The clause now
 * follows the tier they chose.
 */
export const TIER_STANCE: Record<number, string> = {
  1: "capital-preservation-first",
  2: "capital-preservation-first",
  3: "balanced between growth and protection",
  4: "growth-leaning, with more variability accepted",
  5: "growth-first, accepting larger swings",
};

/** The stance clause for a 1..5 tier — the single source of truth for this sentence. */
export function tierStance(tier: number): string {
  return TIER_STANCE[tier] ?? TIER_STANCE[1];
}

export function buildMandateDraft(a: OnboardingAnswers): MandateDraft {
  const tier = a.riskTier || 1;
  // Server accepts ONLY conservative | moderate | growth (api/mandate.py
  // _ALLOWED_RISK_PROFILES). "aggressive" would be a 400 VALIDATION_ERROR.
  const riskProfile = tier <= 2 ? "conservative" : tier <= 3 ? "moderate" : "growth";
  // Check "aggressive" BEFORE "grow" — "growth" contains "grow", so the old order
  // mislabeled "Aggressive growth" as grow_savings.
  const goalKind = a.goal?.toLowerCase().includes("aggressive")
    ? "aggressive_growth"
    : a.goal?.toLowerCase().includes("yield")
      ? "steady_yield"
      : a.goal?.toLowerCase().includes("grow")
        ? "grow_savings"
        : "reach_target";
  const horizonMonths = a.timeline?.includes("< 1")
    ? 6
    : a.timeline?.includes("3+")
      ? 48
      : a.timeline?.includes("1")
        ? 24
        : 12;
  return {
    goals: [{ kind: goalKind, label: a.goal ?? "Steady USDC yield" }],
    riskProfile,
    riskParams: {
      maxSlippageBps: 50,
      drawdownTolerance: tier <= 2 ? "low" : tier <= 3 ? "medium" : "high",
      horizonMonths,
    },
    summaryText: `${TIER_NAMES[tier]} (${tier}/5), ${TIER_STANCE[tier] ?? TIER_STANCE[1]}.`,
    version: 1,
    // 030 — the tier the user actually chose, so Settings and the summary can stop disagreeing
    // about whether "growth" means 4 or 5.
    riskTier: tier,
    ...(exposureBaseUnits(a.exposureLimit) ? { exposureLimitUsdc: exposureBaseUnits(a.exposureLimit)! } : {}),
    // Atomic: both, or neither reaches the wire.
    ...(goalBaseUnits(a.goalTargetAmount) && a.goalTargetDate
      ? { goalTargetUsdc: goalBaseUnits(a.goalTargetAmount)!, goalTargetDate: a.goalTargetDate }
      : {}),
  };
}

/** Whole USDC → base units (6 dp), or `undefined` when the field is blank or not a positive number. */
function exposureBaseUnits(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed) || Number(trimmed) <= 0) return undefined;
  return `${Number(trimmed) * 1_000_000}`;
}

const goalBaseUnits = exposureBaseUnits;
