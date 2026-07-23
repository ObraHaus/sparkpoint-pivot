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
}

const TIER_NAMES: Record<number, string> = {
  1: "Lower risk",
  2: "Low risk",
  3: "Moderate",
  4: "Elevated",
  5: "High risk",
};

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
    summaryText: `${TIER_NAMES[tier]} (${tier}/5), capital-preservation-first.`,
    version: 1,
  };
}
