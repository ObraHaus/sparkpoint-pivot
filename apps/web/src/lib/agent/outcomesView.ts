/**
 * outcomesView — the pure, dependency-free mapper for the §018/US5 realized-outcomes ledger
 * (`GET /outcomes`). Wire → display view, with NO fabrication: it only formats the real signed
 * USD strings the agent derived from the indexed flows' exact average-cost replay, and it trusts
 * the agent's exact-integer `kind` (gain/loss/flat) for classification (so a sub-cent dust gain is
 * still a gain, and the header wins/losses can never disagree with the rows).
 *
 * Honesty contract: rows are surfaced ONLY when the agent says the history `reconciles`; otherwise
 * the view is `reconciles: false` with no rows — the page shows an honest empty/pending state, never
 * a partial-history guess. No `@/` runtime imports (type-only) so it stays unit-testable in isolation.
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

/** `GET /outcomes` body off the wire (all optional). */
export interface OutcomesResponseDto {
  stale?: boolean;
  reconciles?: boolean;
  netRealizedUsd?: string | null;
  wins?: number;
  losses?: number;
  outcomes?: OutcomeRowDto[];
}

export type OutcomeKind = "gain" | "loss" | "flat";

/** One display row — every value real; `txHash` is the withdrawal's on-chain proof. */
export interface OutcomeRowView {
  realizedText: string; // "+$10.00" | "−$5.00" | "$0.00"
  kind: OutcomeKind;
  amountText: string; // "$60.00" — assets received this withdrawal
  txHash: string;
  blockNumber: number;
}

/** The whole ledger view. `reconciles === false` ⇒ render the honest empty/pending state. */
export interface OutcomesView {
  rows: OutcomeRowView[];
  netRealizedText: string | null; // "−$27.86" | null (when not reconciled)
  netKind: OutcomeKind;
  wins: number;
  losses: number;
  reconciles: boolean;
  stale: boolean;
}

const UNICODE_MINUS = "−"; // − : the display minus (matches the design's copy), not ASCII "-"

function normalizeKind(kind: string | undefined, signed: string | undefined): OutcomeKind {
  if (kind === "gain" || kind === "loss" || kind === "flat") return kind;
  // Fallback classification from the signed string if the wire omitted `kind`.
  if (!signed) return "flat";
  if (signed.startsWith("-")) return "loss";
  return /^0(\.0+)?$/.test(signed) ? "flat" : "gain";
}

/** Format a signed USD string (e.g. "-5.00" / "10.00") for display by kind. */
function formatByKind(signed: string | undefined, kind: OutcomeKind): string {
  if (signed == null) return "—";
  const abs = signed.startsWith("-") ? signed.slice(1) : signed;
  if (kind === "gain") return `+$${abs}`;
  if (kind === "loss") return `${UNICODE_MINUS}$${abs}`;
  return `$${abs}`;
}

/**
 * Map the `GET /outcomes` wire body to the display view. When `reconciles` is not true, returns an
 * empty ledger (no rows, null net) so the page shows the honest empty state — never a partial guess.
 */
export function toOutcomesView(dto: OutcomesResponseDto | undefined | null): OutcomesView {
  const reconciles = dto?.reconciles === true;
  const stale = dto?.stale === true;
  if (!dto || !reconciles) {
    return { rows: [], netRealizedText: null, netKind: "flat", wins: 0, losses: 0, reconciles, stale };
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
  const netKind = normalizeKind(undefined, dto.netRealizedUsd ?? undefined);
  return {
    rows,
    netRealizedText: dto.netRealizedUsd != null ? formatByKind(dto.netRealizedUsd, netKind) : null,
    netKind,
    wins: typeof dto.wins === "number" ? dto.wins : 0,
    losses: typeof dto.losses === "number" ? dto.losses : 0,
    reconciles,
    stale,
  };
}
