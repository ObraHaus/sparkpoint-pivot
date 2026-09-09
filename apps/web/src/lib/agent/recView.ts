/**
 * recView — the pure DTO→view mapping for GET /recommendations (§3.4), extracted
 * from useAgent so it can be unit-tested without React/wagmi (mirrors lib/portfolio/derive).
 *
 * Maps the agent's wire RecommendationItem — the live plain-language `rationale` +
 * the real Obsidian `citations` (agent-service-api.md §2.6/§3.4) — into the shape the
 * /strategies cards render. Every field is parsed defensively/fail-closed: a partial or
 * malformed wire row degrades to a safe default, never a throw (the strategies screen
 * always keeps rendering).
 */

import type { Citation } from "@sparkpoint/shared/schemas";

/** One provenance record under a rec — structurally the shared §2.6 wire `Citation`. */
export type RecCitation = Citation;

/** The §3.4 `RecommendationItem` wire shape this view consumes (only the fields we read). */
export interface RecommendationDto {
  recId?: string;
  rank?: number;
  title?: string;
  rationale?: string;
  protocol?: string;
  projectedApyBps?: number;
  grossApyBps?: number;
  performanceFeeBps?: number;
  policy?: { status?: string };
  /** §2.6 provenance set — real Obsidian citations (or on-chain reads). */
  citations?: unknown;
  /** 030 — the STRATEGY's own 1..5 risk tier. Absent on a pre-030 agent. */
  riskTier?: number;
  /** 030 — `"managed_fee"` | `"no_platform_fee"`. */
  feeStance?: string;
  /** 030 — `"sparkpoint"` | `"self"`. */
  managedBy?: string;
  /** The action the card would build, read for its amount. */
  proposedAction?: { amount?: string; type?: string };
}

/**
 * One ranked strategy card, mapped into the shape the /strategies screen renders.
 * `signable` mirrors `cards.isSignable` (policy `approved`) — the SOLE gate on the
 * actionable "Review this move" affordance. `citations` is the real provenance set,
 * surfaced as the source chip + the "Why this?" sources list; empty when none cleared.
 */
export interface RecView {
  id: string;
  rankLabel: string;
  title: string;
  thesis: string;
  /** Net (projected) APY %, 0 ⇒ rendered as "no yield (cash)". */
  apy: number;
  /** The STRATEGY's own risk tier for the RiskChip. */
  risk: number;
  /** How this strategy sits against the user's saved plan — derived, never asserted. */
  fit: string;
  /** What it costs and who runs it — the only real difference between the live strategies. */
  cost: string;
  /** The amount the card would deposit, in base units, carried into the confirm step. */
  amountBaseUnits?: string;
  signable: boolean;
  best: boolean;
  citations: RecCitation[];
  /** True ⇔ the wire carried a measured `projectedApyBps` (a real yield, possibly ~0 on testnet).
   * false ⇒ no yield figure at all → the card reads "no yield (cash)" rather than a fabricated %. */
  apyKnown: boolean;
}

/** Parse the wire `citations` array fail-closed: drop malformed rows, default optionals. */
export function parseCitations(raw: unknown): RecCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: RecCitation[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object") continue;
    const o = c as Record<string, unknown>;
    // provider + value are the load-bearing display fields; a row missing either is unusable.
    if (typeof o.provider !== "string" || typeof o.value !== "string") continue;
    // The url is rendered as an anchor href — allowlist http(s): ONLY. A `javascript:`/`data:`
    // url passes `typeof === "string"` (and even `new URL()`), so gate the scheme here to
    // close a DOM-XSS vector if a citation source is ever attacker-influenceable.
    const url = typeof o.url === "string" && /^https?:\/\//i.test(o.url.trim()) ? o.url : undefined;
    out.push({
      provider: o.provider,
      endpoint: typeof o.endpoint === "string" ? o.endpoint : "",
      field: typeof o.field === "string" ? o.field : "",
      value: o.value,
      asOf: typeof o.asOf === "string" ? o.asOf : "",
      stale: o.stale === true,
      ...(url ? { url } : {}),
    });
  }
  return out;
}

/**
 * What a strategy costs and who runs it.
 *
 * 030 — this is the ONLY real difference between the two live strategies: both supply USDC to
 * Aave v3, and the vault adds a fee and management rather than risk or return. Before this the
 * page had no way to say so, so the model invented a difference instead ("leveraging vault
 * aggregation … rather than passive lending", on a passive lending position).
 */
function costLine(feeStance: string | undefined): string {
  if (feeStance === "managed_fee") {
    return "Managed for you · 10% of yield, profit only, 0% on your principal";
  }
  if (feeStance === "no_platform_fee") {
    return "No SparkPoint fee · you manage the position yourself";
  }
  return "";
}

/**
 * How this strategy sits against the plan the user actually set.
 *
 * 030 — this string used to be hardcoded, so a wallet whose mandate was GROWTH was told
 * "Fits your plan: lower risk, steady yield". The page's entire promise is "ranked against your
 * plan"; it was delivered by a sentence that never read the plan.
 *
 * The wording is deliberately careful in the below-plan case: sitting in something safer than
 * your mandate permits is an observation, never a prompt to take more risk (029's advice
 * boundary still applies).
 */
function fitLine(strategyTier: number, mandateTier: number | undefined, isTop: boolean): string {
  if (typeof mandateTier !== "number" || !Number.isFinite(mandateTier)) {
    return isTop ? "Ranked best against the strategies available." : "An alternative posture.";
  }
  if (strategyTier > mandateTier) {
    return "Above the risk level your plan allows.";
  }
  if (strategyTier < mandateTier) {
    return `More conservative than your plan allows (${strategyTier}/5 vs your ${mandateTier}/5).`;
  }
  return `Matches your plan's risk level (${mandateTier}/5).`;
}

/**
 * Map one §3.4 `RecommendationItem` (`r`) at display index `i` to a `RecView`.
 *
 * `mandateTier` is the user's saved plan tier. It is optional so a signed-out or plan-less view
 * still renders — but when it is present, the fit line and the risk comparison follow it rather
 * than a constant.
 */
export function toRecView(r: RecommendationDto, i: number, mandateTier?: number): RecView {
  const isTop = r.rank === 1 || i === 0;
  // 030: the strategy's OWN tier. A pre-030 agent omits it; fall back to 1, which is what the
  // page hardcoded anyway, so an old agent degrades to the old display rather than to a wrong one.
  const risk = typeof r.riskTier === "number" && r.riskTier >= 1 && r.riskTier <= 5 ? r.riskTier : 1;
  return {
    id: r.recId ?? `rec_${i}`,
    rankLabel: isTop ? "Best fit · #1 vs your goal" : `#${r.rank ?? i + 1} vs your goal`,
    title: r.title ?? "Strategy",
    thesis: r.rationale ?? "",
    apy: typeof r.projectedApyBps === "number" ? r.projectedApyBps / 100 : 0,
    risk,
    fit: fitLine(risk, mandateTier, isTop),
    cost: costLine(r.feeStance),
    amountBaseUnits:
      typeof r.proposedAction?.amount === "string" ? r.proposedAction.amount : undefined,
    // Non-custody: signable ⟺ the deterministic policy approved it (§2.7).
    signable: r.policy?.status === "approved",
    best: i === 0,
    citations: parseCitations(r.citations),
    apyKnown: typeof r.projectedApyBps === "number",
  };
}
