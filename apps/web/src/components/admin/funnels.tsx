"use client";

/**
 * Funnel + risk-distribution bar widgets, shared by the Users and Usage screens.
 * Faithful 1:1 port of `funnel()` and `riskDist()` in SparkPoint Admin.html.
 */

import { STREAM } from "./charts";

/** funnel() — onboarding / recommendation funnel bars. */
export function Funnel() {
  const steps: [string, number][] = [
    ["Prospective", 3240],
    ["Wallet connected", 2680],
    ["Account ready", 2310],
    ["Mandated", 1980],
    ["Active", 1420],
  ];
  const max = steps[0][1];
  return (
    <div style={{ marginTop: 8 }}>
      {steps.map((s, i) => (
        <div key={s[0]} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>{s[0]}</span>
            <span className="tnum" style={{ color: "var(--muted-foreground)" }}>
              {s[1].toLocaleString()} · {((s[1] / max) * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ height: 18, borderRadius: 5, background: "var(--muted)" }}>
            <div
              style={{
                height: "100%",
                borderRadius: 5,
                width: `${(s[1] / max) * 100}%`,
                background: i === 3 ? "var(--caution)" : STREAM.swap,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** riskDist() — risk-tier distribution bars. */
export function RiskDist() {
  const tiers: [string, string, number][] = [
    ["Risk 1 · Lower", "--risk-1", 62],
    ["Risk 2 · Low", "--risk-2", 26],
    ["Risk 3 · Moderate", "--risk-3", 9],
    ["Risk 4", "--risk-4", 3],
  ];
  return (
    <div style={{ marginTop: 8 }}>
      {tiers.map((t) => (
        <div key={t[0]} style={{ marginBottom: 9 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
            <span>{t[0]}</span>
            <span className="tnum">{t[2]}%</span>
          </div>
          <div style={{ height: 18, borderRadius: 5, background: "var(--muted)" }}>
            <div style={{ height: "100%", borderRadius: 5, width: `${t[2]}%`, background: `var(${t[1]})` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
