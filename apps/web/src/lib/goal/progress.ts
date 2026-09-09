/**
 * progress — how far along a user is toward the thing they said they were saving for.
 *
 * WHY THIS EXISTS (030). "Reach a target — hit a specific amount" was offered as a goal, chosen,
 * and stored as the bare label `"Reach a target"`. No amount, no date. Nothing in the product
 * could ever tell that user whether they were on track, because nothing knew what the target was.
 * Now that the plan holds both, this turns a balance into a story: a share of a target, a date,
 * and an honest word about whether the pace gets there.
 *
 * Every rule here is about NOT overclaiming, because a savings projection is exactly the kind of
 * number people plan around:
 *
 *  - A target already met reads as **met**, not as 103%.
 *  - A date already passed reads as **passed**, never as negative months.
 *  - A pace that does not reach the target states the shortfall **plainly**, rather than showing
 *    a hopeful percentage and letting the user discover it later.
 *  - Contribution is the user's STATED INTENT, not a scheduled transfer. It is included in the
 *    projection because that is what the user said they would do — but nothing here causes it,
 *    and the copy never implies it is automatic.
 *  - No probabilistic band, no confidence interval. The product does not have the data to make
 *    one honest, and a range would read as a promise.
 *
 * Amounts are USDC base units (6 dp) and arithmetic is integer-only. Leaf module: no imports,
 * no React.
 */

/** What the caller needs to render a goal line. `null` from {@link goalProgress} = no goal set. */
export interface GoalProgress {
  /** Share of the target already held, 0..100, clamped. */
  readonly pct: number;
  /** True when the balance already meets or exceeds the target. */
  readonly met: boolean;
  /** True when the target date is in the past. */
  readonly overdue: boolean;
  /** Whole months from `today` to the target date; 0 once passed. */
  readonly monthsRemaining: number;
  /** Base units still needed. 0 when met. */
  readonly shortfallBaseUnits: number;
  /**
   * Whether the stated contribution intent reaches the target by the date.
   * `"unknown"` when no contribution was stated — the honest answer, not a guess.
   */
  readonly pace: "on_track" | "short" | "unknown";
  /** Base units the pace falls short by, when it can be computed and is short. */
  readonly paceShortfallBaseUnits: number;
}

export interface GoalInput {
  /** Target amount in USDC base units. */
  readonly targetBaseUnits: number | null | undefined;
  /** Target date, ISO `YYYY-MM-DD`. */
  readonly targetDate: string | null | undefined;
  /** What the user holds now, USDC base units. */
  readonly balanceBaseUnits: number | null | undefined;
  /** Today, ISO `YYYY-MM-DD`. Passed in so this stays a pure function. */
  readonly today: string;
  /** The stated contribution intent, if any. */
  readonly contribution?: { amountBaseUnits: number; cadence: string } | null;
}

/** Contributions per year, by cadence. Anything unrecognised contributes nothing. */
const PER_YEAR: Record<string, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
  quarterly: 4,
};

/** Whole months between two ISO dates, floored at 0. Pure — no clock, no Date.now(). */
export function monthsBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso);
  const to = parseIsoDate(toIso);
  if (!from || !to) return 0;
  const months = (to.y - from.y) * 12 + (to.m - from.m) - (to.d < from.d ? 1 : 0);
  return Math.max(0, months);
}

function parseIsoDate(iso: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

/**
 * Progress toward a stated goal, or `null` when there is no goal to report on.
 *
 * `null` is deliberately distinct from "0% of nothing": the caller renders an invitation to set a
 * target rather than a fabricated figure (FR-019).
 */
export function goalProgress(input: GoalInput): GoalProgress | null {
  const target = input.targetBaseUnits;
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) return null;
  if (!input.targetDate || !parseIsoDate(input.targetDate)) return null;

  const balance =
    typeof input.balanceBaseUnits === "number" && Number.isFinite(input.balanceBaseUnits)
      ? Math.max(0, input.balanceBaseUnits)
      : 0;

  const met = balance >= target;
  const shortfall = met ? 0 : target - balance;
  const pct = met ? 100 : Math.floor((balance * 100) / target);

  const months = monthsBetween(input.today, input.targetDate);
  const overdue = months === 0 && !met && !sameOrBefore(input.today, input.targetDate);

  // The stated intent, projected over the remaining months. Not a schedule — see the header.
  let pace: GoalProgress["pace"] = "unknown";
  let paceShortfall = 0;
  const contribution = input.contribution;
  if (met) {
    pace = "on_track";
  } else if (contribution && PER_YEAR[contribution.cadence] && contribution.amountBaseUnits > 0) {
    const perMonth = Math.trunc((contribution.amountBaseUnits * PER_YEAR[contribution.cadence]) / 12);
    const projected = balance + perMonth * months;
    pace = projected >= target ? "on_track" : "short";
    paceShortfall = pace === "short" ? target - projected : 0;
  }

  return {
    pct: Math.max(0, Math.min(100, pct)),
    met,
    overdue,
    monthsRemaining: months,
    shortfallBaseUnits: shortfall,
    pace,
    paceShortfallBaseUnits: paceShortfall,
  };
}

function sameOrBefore(aIso: string, bIso: string): boolean {
  return aIso <= bIso; // ISO dates sort lexicographically
}
