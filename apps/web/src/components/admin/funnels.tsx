"use client";

/**
 * Funnel + risk-distribution bar widgets for the admin Users screen — now driven by REAL data from
 * `GET /admin/users/analytics` (was a 1:1 port of the hardcoded design mock). Presentational only.
 */

import { STREAM } from "./charts";

export interface FunnelStep {
  step: string;
  count: number;
}
export interface RiskTier {
  tier: string;
  count: number;
  pct: number;
}

/** Onboarding funnel bars — cumulative counts (each step ⊇ the next), from the analytics endpoint. */
export function Funnel({ steps }: { steps: FunnelStep[] }) {
  const max = steps[0]?.count || 1;
  return (
    <div style={{ marginTop: 8 }}>
      {steps.map((s, i) => (
        <div key={s.step} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>{s.step}</span>
            <span className="tnum" style={{ color: "var(--muted-foreground)" }}>
              {s.count.toLocaleString()} · {((s.count / max) * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ height: 18, borderRadius: 5, background: "var(--muted)" }}>
            <div
              style={{
                height: "100%",
                borderRadius: 5,
                width: `${(s.count / max) * 100}%`,
                background: i === steps.length - 2 ? "var(--caution)" : STREAM.swap,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** risk_tier enum → [display label, CSS colour var]. Unknown tiers fall back to risk-4. */
const RISK_META: Record<string, [string, string]> = {
  conservative: ["Conservative", "--risk-1"],
  moderate: ["Moderate", "--risk-2"],
  growth: ["Growth", "--risk-3"],
};

/** Risk-tier distribution bars — from each user's latest CONFIRMED mandate. */
export function RiskDist({ tiers }: { tiers: RiskTier[] }) {
  if (tiers.length === 0) {
    return (
      <div className="muted" style={{ marginTop: 8, fontSize: 13, padding: "10px 2px" }}>
        No confirmed mandates yet.
      </div>
    );
  }
  return (
    <div style={{ marginTop: 8 }}>
      {tiers.map((t) => {
        const [label, color] = RISK_META[t.tier] ?? [t.tier, "--risk-4"];
        return (
          <div key={t.tier} style={{ marginBottom: 9 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
              <span>{label}</span>
              <span className="tnum">
                {t.pct}% · {t.count}
              </span>
            </div>
            <div style={{ height: 18, borderRadius: 5, background: "var(--muted)" }}>
              <div style={{ height: "100%", borderRadius: 5, width: `${t.pct}%`, background: `var(${color})` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
