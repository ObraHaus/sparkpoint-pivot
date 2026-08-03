/**
 * Pure wire→view mapping for the user's persisted mandate (GET /agent/mandate, §3.1).
 *
 * The agent returns a risk PROFILE ("conservative" | "moderate" | "growth") plus goals,
 * horizon, and slippage. The UI renders a numeric risk TIER (RiskChip's 1..5 scale) plus
 * human-readable goal/timeline copy. This module is the single place that translation
 * lives, kept free of React/CSS imports so it is unit-testable under the strip-types test
 * runner (mirrors `lib/portfolio/derive.ts`). Every field is defensively parsed — a
 * partial/garbled wire mandate degrades to safe defaults, never throws.
 *
 * NON-CUSTODY: a mandate is advisory config. It only NARROWS the onchain allowlist; the
 * deterministic policy layer re-checks every action regardless. Nothing here is signable
 * and nothing here can move funds.
 */

/** The §3.1 wire mandate (all fields optional — parsed fail-closed). */
export interface MandateWire {
  id?: string;
  version?: number;
  active?: boolean;
  confirmedAt?: string | null;
  riskProfile?: string;
  riskParams?: { maxSlippageBps?: number; drawdownTolerance?: string; horizonMonths?: number };
  goals?: { kind?: string; label?: string }[];
  summaryText?: string;
}

/** The display view the mandate surfaces (settings tab, chat rail, portfolio drift) consume. */
export interface MandateView {
  version: number;
  active: boolean;
  /** "conservative" | "moderate" | "growth" (the raw profile). */
  riskProfile: string;
  /** RiskChip tier (1..5), mapped from the profile. */
  tier: number;
  /** Short tier word ("Lower" / "Moderate" / "Elevated"). */
  riskLabel: string;
  /** One-line risk posture ("capital-preservation-first"). */
  riskBlurb: string;
  /** Primary goal label (falls back to the summary, then a safe default). */
  goal: string;
  goals: { kind: string; label: string }[];
  /** Human timeline derived from horizonMonths ("1 year", "1.5 years", "—"). */
  timeline: string;
  maxSlippageBps?: number;
  drawdownTolerance?: string;
  summaryText: string;
}

/** riskProfile → { RiskChip tier, tier word, posture blurb }. The vault is conservative-only
 * today; a looser mandate never widens what policy allows. */
const RISK: Record<string, { tier: number; label: string; blurb: string }> = {
  conservative: { tier: 1, label: "Lower", blurb: "capital-preservation-first" },
  moderate: { tier: 3, label: "Moderate", blurb: "balanced growth & income" },
  growth: { tier: 4, label: "Elevated", blurb: "growth-oriented" },
};

/** A friendly timeline from an explicit horizon in months. Honest — never invents a value. */
export function timelineLabel(months: number | undefined): string {
  if (typeof months !== "number" || !Number.isFinite(months) || months <= 0) return "—";
  if (months < 12) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.round((months / 12) * 10) / 10;
  const text = Number.isInteger(years) ? String(years) : years.toFixed(1);
  return `${text} year${years === 1 ? "" : "s"}`;
}

/** Map the §3.1 wire mandate to the display view. `null` in ⇒ `null` out (no mandate yet). */
export function mandateView(wire: MandateWire | null | undefined): MandateView | null {
  if (!wire || typeof wire !== "object") return null;
  const profile = typeof wire.riskProfile === "string" ? wire.riskProfile : "conservative";
  const risk = RISK[profile] ?? RISK.conservative;
  const goals = Array.isArray(wire.goals)
    ? wire.goals
        .filter((g): g is { kind?: string; label: string } => !!g && typeof g.label === "string")
        .map((g) => ({ kind: typeof g.kind === "string" ? g.kind : "", label: g.label }))
    : [];
  const rp = wire.riskParams ?? {};
  return {
    version: typeof wire.version === "number" ? wire.version : 1,
    active: wire.active === true,
    riskProfile: profile,
    tier: risk.tier,
    riskLabel: risk.label,
    riskBlurb: risk.blurb,
    goal:
      goals[0]?.label ??
      (typeof wire.summaryText === "string" && wire.summaryText ? wire.summaryText : "Steady USDC yield"),
    goals,
    timeline: timelineLabel(rp.horizonMonths),
    maxSlippageBps: typeof rp.maxSlippageBps === "number" ? rp.maxSlippageBps : undefined,
    drawdownTolerance: typeof rp.drawdownTolerance === "string" ? rp.drawdownTolerance : undefined,
    summaryText: typeof wire.summaryText === "string" ? wire.summaryText : "",
  };
}

/**
 * `true` iff a raw `GET /mandate` body carries a real persisted mandate. §3.1 answers 200 with
 * `{"mandate": null}` when the user has none, so "no mandate" and "the read failed" are DIFFERENT
 * facts and only this one is a positive answer — callers that gate a CTA on it must fail open on
 * the other. Defensive: any unexpected shape ⇒ `false`. Agrees with `mandateView` by construction,
 * so /verify and the settings surface can never disagree about whether a plan exists.
 */
export function hasSavedMandate(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  const wire = (body as { mandate?: unknown }).mandate;
  return mandateView(wire as MandateWire | null | undefined) !== null;
}

/** Risk drift = live realized tier vs the mandate's target tier.
 *
 * 030 — this gained `below_plan`. The old rule was `realized > target`, so with only a tier-1
 * strategy live it could ONLY ever say "on plan", and the one case that matters right now — a
 * growth-mandate user sitting entirely in the most conservative product available — could not be
 * expressed at all. Holding below the mandate is not a violation and must never read as one;
 * see {@link driftLabel}. `unknown` when either input is absent. */
export type DriftStatus = "on_plan" | "above_plan" | "below_plan" | "unknown";

export function mandateDrift(
  targetTier: number | undefined,
  realizedTier: number | undefined,
): DriftStatus {
  if (typeof targetTier !== "number" || typeof realizedTier !== "number") return "unknown";
  if (realizedTier > targetTier) return "above_plan";
  if (realizedTier < targetTier) return "below_plan";
  return "on_plan";
}

/**
 * The sentence to show for a drift status.
 *
 * 030 — `below_plan` is new, and its wording matters more than the others. A user holding
 * something safer than their plan permits has done nothing wrong; the product's job is to note
 * the fact and point at the plan, NOT to suggest taking more risk. 029's advice boundary applies
 * here too — SparkPoint does not tell people how much risk to take.
 */
export function driftLabel(status: DriftStatus): string {
  switch (status) {
    case "above_plan":
      return "Above the risk level your plan allows.";
    case "below_plan":
      return "More conservative than your plan allows — that's fine, and you can adjust the plan.";
    case "on_plan":
      return "In line with your plan.";
    default:
      return "";
  }
}
