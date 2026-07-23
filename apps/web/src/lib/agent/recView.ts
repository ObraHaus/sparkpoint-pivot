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
  /** Risk tier for the RiskChip (only the lower-risk Aave vault is live today). */
  risk: number;
  fit: string;
  signable: boolean;
  best: boolean;
  citations: RecCitation[];
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
    out.push({
      provider: o.provider,
      endpoint: typeof o.endpoint === "string" ? o.endpoint : "",
      field: typeof o.field === "string" ? o.field : "",
      value: o.value,
      asOf: typeof o.asOf === "string" ? o.asOf : "",
      stale: o.stale === true,
      ...(typeof o.url === "string" ? { url: o.url } : {}),
    });
  }
  return out;
}

/** Map one §3.4 `RecommendationItem` (`r`) at display index `i` to a `RecView`. */
export function toRecView(r: RecommendationDto, i: number): RecView {
  const isTop = r.rank === 1 || i === 0;
  return {
    id: r.recId ?? `rec_${i}`,
    rankLabel: isTop ? "Best fit · #1 vs your goal" : `#${r.rank ?? i + 1} vs your goal`,
    title: r.title ?? "Strategy",
    thesis: r.rationale ?? "",
    apy: typeof r.projectedApyBps === "number" ? r.projectedApyBps / 100 : 0,
    risk: 1,
    fit: isTop ? "Fits your plan: lower risk, steady yield." : "Conservative, capital-preservation-first.",
    // Non-custody: signable ⟺ the deterministic policy approved it (§2.7).
    signable: r.policy?.status === "approved",
    best: i === 0,
    citations: parseCitations(r.citations),
  };
}
