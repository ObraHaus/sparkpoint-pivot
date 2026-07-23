/**
 * portfolioPnl — pure DTO→view mapping for the derived PnL of GET /portfolio (§3.3/§B2),
 * extracted from useAgent so it is unit-testable without React/react-query (mirrors recView).
 * Every field is optional/fail-closed; a null/absent wire figure ⇒ undefined ("pending"), never 0.
 */

const numeric = (v: unknown): number | undefined => {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

export interface PositionPnl {
  costBasisUsd?: number;
  unrealizedPnlUsd?: number;
  realizedPnlUsd?: number;
}
export interface PortfolioPnlWire {
  series?: { ts?: string; valueUsd?: string }[];
  realizedUsd?: string | null;
  unrealizedUsd?: string | null;
}
export interface PositionPnlWire {
  positionId?: string;
  costBasisUsd?: string | null;
  unrealizedPnlUsd?: string | null;
  realizedPnlUsd?: string | null;
}
export interface PortfolioPnlView {
  series?: number[];
  pnl?: { abs: number; pct: number };
  history: { t: number; v: number }[];
  realizedUsd?: number;
  unrealizedUsd?: number;
  positionPnl: Record<string, PositionPnl>;
}

export function toPortfolioPnl(
  pnl: PortfolioPnlWire | undefined,
  positions: PositionPnlWire[] | undefined,
): PortfolioPnlView {
  const rawSeries = Array.isArray(pnl?.series)
    ? pnl!.series.map((p) => numeric(p?.valueUsd)).filter((n): n is number => n !== undefined)
    : undefined;
  const series = rawSeries && rawSeries.length >= 2 ? rawSeries : undefined;

  let out: { abs: number; pct: number } | undefined;
  if (series) {
    const first = series[0];
    const last = series[series.length - 1];
    const abs = last - first;
    const pct = first > 0 ? Math.round((abs / first) * 10000) / 100 : 0;
    out = { abs: Math.round(abs * 100) / 100, pct };
  }

  const history = Array.isArray(pnl?.series)
    ? pnl!.series
        .map((p) => ({ t: Date.parse(p?.ts ?? ""), v: numeric(p?.valueUsd) }))
        .filter((p): p is { t: number; v: number } => !Number.isNaN(p.t) && p.v !== undefined)
    : [];

  const positionPnl: Record<string, PositionPnl> = {};
  for (const p of positions ?? []) {
    if (!p?.positionId) continue;
    positionPnl[p.positionId] = {
      costBasisUsd: numeric(p.costBasisUsd),
      unrealizedPnlUsd: numeric(p.unrealizedPnlUsd),
      realizedPnlUsd: numeric(p.realizedPnlUsd),
    };
  }
  return {
    series,
    pnl: out,
    history,
    realizedUsd: numeric(pnl?.realizedUsd),
    unrealizedUsd: numeric(pnl?.unrealizedUsd),
    positionPnl,
  };
}
