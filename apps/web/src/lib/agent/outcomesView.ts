/**
 * outcomesView — the pure, dependency-free mapper for the §018/US5 realized-outcomes ledger
 * (`GET /outcomes`) and the §020/US5 per-recommendation attribution surface (`recommendations[]`
 * on `GET /outcomes`, and the detail `GET /outcomes/{recId}`). Wire → display view, with NO
 * fabrication: it only formats the real signed USD strings the agent derived from the indexed
 * flows' exact FIFO/average-cost replay, and it trusts the agent's exact-integer `kind`/`label`
 * for classification (so a sub-cent dust gain is still a gain, and the header wins/losses can never
 * disagree with the rows).
 *
 * Honesty contract (Principle III — provable, not promised): rows are surfaced ONLY when the agent
 * says the history `reconciles`; otherwise the view is `reconciles: false` with no rows AND no
 * recommendations — the page shows an honest empty/pending state, never a partial-history guess.
 * A per-recommendation row is shown only for advice the user ACTED on, and the link is the explicit
 * build→sign transaction (`attributionMethod: 'intent_log'`), never inferred. A `shared` lot is
 * labelled as the user's share of a blended position — never a fabricated split. No `@/` runtime
 * imports (type-only) so it stays unit-testable in isolation.
 */

/** One realized-withdrawal row off the wire (all fields optional — defensive parsing). */
export interface OutcomeRowDto {
  realizedUsd?: string;
  kind?: string; // 'gain' | 'loss' | 'flat'
  amountUsd?: string;
  txHash?: string;
  blockNumber?: number;
  tsApprox?: string;
}

/** One acted-on recommendation's outcome off the wire (`GET /outcomes` `recommendations[]`, §020). */
export interface RecommendationOutcomeDto {
  recId?: string;
  title?: string;
  strategyKind?: string;
  actedTxHash?: string; // the deposit tx — on-chain proof of acting on the advice
  entryBlock?: number;
  entryUsd?: string; // this rec's deposit cost (unsigned)
  realizedUsd?: string; // FIFO-realized on this rec's lot (signed)
  unrealizedUsd?: string; // current mark of the lot's remaining shares − remaining cost (signed)
  label?: string; // 'open' | 'win' | 'loss' | 'flat'
  attributionMethod?: string; // 'intent_log' (the explicit build→sign link)
  shared?: boolean; // the position is blended across ≥2 deposit lots
  reconstructable?: boolean;
}

/** `GET /outcomes/{recId}` detail body off the wire (all optional). Superset of the row (§020). */
export interface RecommendationOutcomeDetailDto extends RecommendationOutcomeDto {
  rationale?: string;
  proposedAction?: Record<string, unknown>;
  status?: string;
  realizedApyBps?: number | null; // annualized realized return for a CLOSED lot; null while open/flat
  asOfBlock?: number;
}

/** `GET /outcomes` body off the wire (all optional). */
export interface OutcomesResponseDto {
  stale?: boolean;
  reconciles?: boolean;
  netRealizedUsd?: string | null;
  wins?: number;
  losses?: number;
  outcomes?: OutcomeRowDto[];
  recommendations?: RecommendationOutcomeDto[];
}

export type OutcomeKind = "gain" | "loss" | "flat";
export type OutcomeLabel = "open" | "win" | "loss" | "flat";

/** One display row — every value real; `txHash` is the withdrawal's on-chain proof. */
export interface OutcomeRowView {
  realizedText: string; // "+$10.00" | "−$5.00" | "$0.00"
  kind: OutcomeKind;
  amountText: string; // "$60.00" — assets received this withdrawal
  txHash: string;
  blockNumber: number;
}

/** One acted-on recommendation's outcome — the credibility-loop row (real figures, provable link). */
export interface RecommendationOutcomeView {
  recId: string;
  title: string;
  strategyKind: string;
  actedTxHash: string; // deposit tx — on-chain proof of acting on the advice ("" when absent)
  entryBlock: number;
  entryText: string; // "$5.00"
  realizedText: string; // signed "+$0.12" | "−$0.03" | "$0.00"
  realizedKind: OutcomeKind;
  unrealizedText: string;
  unrealizedKind: OutcomeKind;
  label: OutcomeLabel; // open | win | loss | flat
  shared: boolean; // your share of a position blended across ≥2 deposits (never a fabricated split)
  /** Honest provenance line for the link method; "" when unknown (never inferred). */
  attributionLabel: string;
}

/** One recommendation's full outcome detail (`GET /outcomes/{recId}`). */
export interface RecommendationOutcomeDetailView extends RecommendationOutcomeView {
  rationale: string;
  status: string;
  /** Annualized realized APY for a CLOSED lot; null while open/flat (never extrapolated). */
  realizedApyText: string | null; // "+12.34%/yr" | "−3.10%/yr" | null
  asOfBlock: number;
  /** Compact, honest one-line summary of the proposed action (or "" when none is parseable). */
  proposedActionSummary: string;
}

/** The whole ledger view. `reconciles === false` ⇒ render the honest empty/pending state. */
export interface OutcomesView {
  rows: OutcomeRowView[];
  /** One row per ACTED-ON recommendation (§020). Empty when not reconciled or no acted-on advice. */
  recommendations: RecommendationOutcomeView[];
  netRealizedText: string | null; // "−$27.86" | null (when not reconciled)
  netKind: OutcomeKind;
  wins: number;
  losses: number;
  reconciles: boolean;
  stale: boolean;
}

const UNICODE_MINUS = "−"; // − : the display minus (matches the design's copy), not ASCII "-"

/** True when a signed USD string is zero-magnitude ("0", "0.00", "-0.00") — display it as flat. */
function isZeroMagnitude(signed: string): boolean {
  return /^-?0(\.0+)?$/.test(signed.trim());
}

function normalizeKind(kind: string | undefined, signed: string | undefined): OutcomeKind {
  if (kind === "gain" || kind === "loss" || kind === "flat") return kind;
  // Fallback classification from the signed string if the wire omitted `kind`.
  if (!signed) return "flat";
  // A zero-magnitude value is flat even when the wire renders it "-0.00" (honest, not a red loss).
  if (isZeroMagnitude(signed)) return "flat";
  return signed.startsWith("-") ? "loss" : "gain";
}

function normalizeLabel(
  label: string | undefined,
  realized: string | undefined,
): OutcomeLabel {
  if (label === "open" || label === "win" || label === "loss" || label === "flat") return label;
  // Defensive fallback (the wire always sets `label`): don't claim a realized win/loss we can't see.
  if (realized && !isZeroMagnitude(realized)) return realized.startsWith("-") ? "loss" : "win";
  return "open";
}

/** Format a signed USD string (e.g. "-5.00" / "10.00") for display by kind. */
function formatByKind(signed: string | undefined, kind: OutcomeKind): string {
  if (signed == null) return "—";
  const abs = signed.startsWith("-") ? signed.slice(1) : signed;
  if (kind === "gain") return `+$${abs}`;
  if (kind === "loss") return `${UNICODE_MINUS}$${abs}`;
  return `$${abs}`;
}

/** Format annualized realized APY (bps) for a CLOSED lot; null while open/flat (never extrapolated). */
function formatApyBps(bps: number | null | undefined): string | null {
  if (bps == null || !Number.isFinite(bps)) return null;
  const pct = bps / 100; // 1234 bps → 12.34%
  const abs = Math.abs(pct).toFixed(2);
  const sign = pct > 0 ? "+" : pct < 0 ? UNICODE_MINUS : "";
  return `${sign}${abs}%/yr`;
}

/**
 * Scale a non-negative base-unit integer STRING by `decimals` to a human decimal string, using exact
 * string math (never `Number` — an 18-decimal amount overflows float precision). "5000000"/6 → "5";
 * "5250000"/6 → "5.25". Returns null on any non-integer/odd input (so the caller omits it, never
 * showing a raw base-unit figure — Principle III).
 */
function formatBaseUnits(amount: string, decimals: number): string | null {
  if (!/^\d+$/.test(amount)) return null; // base units are non-negative integers
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  if (decimals === 0) return amount.replace(/^0+(?=\d)/, "");
  const padded = amount.padStart(decimals + 1, "0");
  const intPart = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, "");
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return frac ? `${intPart}.${frac}` : intPart;
}

/**
 * A compact, honest one-line summary of the stored `proposedAction` (§2.7/§3.5 `ProposedAction` wire:
 * `{type, asset, decimals, amount(base-units str), …}`). Shows the humanised action `type` and the
 * DECIMAL-scaled amount (never the raw base-unit integer, and never a fabricated token symbol — we
 * only carry the asset ADDRESS, not a name). "" when nothing parseable. Defensive throughout.
 */
function summarizeProposedAction(action: Record<string, unknown> | undefined): string {
  if (!action || typeof action !== "object") return "";
  // The wire key is `type`; `kind` is a defensive legacy fallback (the agent never emits it today).
  const rawType =
    typeof action.type === "string"
      ? action.type
      : typeof action.kind === "string"
        ? action.kind
        : "";
  const label = rawType ? rawType.replace(/_/g, " ") : "";
  const amount =
    typeof action.amount === "string" && typeof action.decimals === "number"
      ? formatBaseUnits(action.amount, action.decimals)
      : null;
  return [label, amount].filter(Boolean).join(" · ");
}

/** Map one acted-on recommendation wire row to its display view (real figures only). */
export function toRecommendationOutcome(o: RecommendationOutcomeDto): RecommendationOutcomeView {
  const realizedKind = normalizeKind(undefined, o.realizedUsd);
  const unrealizedKind = normalizeKind(undefined, o.unrealizedUsd);
  return {
    recId: typeof o.recId === "string" ? o.recId : "",
    title: typeof o.title === "string" && o.title ? o.title : "Recommendation",
    strategyKind: typeof o.strategyKind === "string" ? o.strategyKind : "",
    actedTxHash: typeof o.actedTxHash === "string" ? o.actedTxHash : "",
    entryBlock: typeof o.entryBlock === "number" ? o.entryBlock : 0,
    entryText: o.entryUsd != null ? `$${o.entryUsd}` : "—",
    realizedText: formatByKind(o.realizedUsd, realizedKind),
    realizedKind,
    unrealizedText: formatByKind(o.unrealizedUsd, unrealizedKind),
    unrealizedKind,
    label: normalizeLabel(o.label, o.realizedUsd),
    shared: o.shared === true,
    // Only the explicit build→sign link is honest attribution; anything else stays unlabelled.
    attributionLabel:
      o.attributionMethod === "intent_log" ? "Linked to the transaction you signed" : "",
  };
}

/**
 * Map the `GET /outcomes` wire body to the display view. When `reconciles` is not true, returns an
 * empty ledger (no rows, no recommendations, null net) so the page shows the honest empty state —
 * never a partial guess. The `recommendations[]` mirror the backend's own `reconciles` gate.
 */
export function toOutcomesView(dto: OutcomesResponseDto | undefined | null): OutcomesView {
  const reconciles = dto?.reconciles === true;
  const stale = dto?.stale === true;
  if (!dto || !reconciles) {
    return {
      rows: [],
      recommendations: [],
      netRealizedText: null,
      netKind: "flat",
      wins: 0,
      losses: 0,
      reconciles,
      stale,
    };
  }
  const rows: OutcomeRowView[] = (Array.isArray(dto.outcomes) ? dto.outcomes : []).map((o) => {
    const kind = normalizeKind(o.kind, o.realizedUsd);
    return {
      realizedText: formatByKind(o.realizedUsd, kind),
      kind,
      amountText: o.amountUsd != null ? `$${o.amountUsd}` : "—",
      txHash: typeof o.txHash === "string" ? o.txHash : "",
      blockNumber: typeof o.blockNumber === "number" ? o.blockNumber : 0,
    };
  });
  const recommendations: RecommendationOutcomeView[] = (
    Array.isArray(dto.recommendations) ? dto.recommendations : []
  ).map(toRecommendationOutcome);
  const netKind = normalizeKind(undefined, dto.netRealizedUsd ?? undefined);
  return {
    rows,
    recommendations,
    netRealizedText: dto.netRealizedUsd != null ? formatByKind(dto.netRealizedUsd, netKind) : null,
    netKind,
    wins: typeof dto.wins === "number" ? dto.wins : 0,
    losses: typeof dto.losses === "number" ? dto.losses : 0,
    reconciles,
    stale,
  };
}

/**
 * Map the `GET /outcomes/{recId}` detail body to its view. `null` in ⇒ `null` out (offline / no
 * detail). Every figure is the real signed string the agent derived; the realized APY is shown ONLY
 * for a fully-closed lot (the wire sends `null` while open/flat — never extrapolated here).
 */
export function toOutcomeDetailView(
  d: RecommendationOutcomeDetailDto | undefined | null,
): RecommendationOutcomeDetailView | null {
  if (!d) return null;
  return {
    ...toRecommendationOutcome(d),
    rationale: typeof d.rationale === "string" ? d.rationale : "",
    status: typeof d.status === "string" ? d.status : "",
    realizedApyText: formatApyBps(d.realizedApyBps),
    asOfBlock: typeof d.asOfBlock === "number" ? d.asOfBlock : 0,
    proposedActionSummary: summarizeProposedAction(d.proposedAction),
  };
}
