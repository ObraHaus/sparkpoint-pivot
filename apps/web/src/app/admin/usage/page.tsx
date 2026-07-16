"use client";

/**
 * Admin → Usage & product (scUsage).
 *
 * The product/usage KPIs (chat volume, recommendation acceptance, simulation pass rate,
 * execution success) have NO real telemetry source yet — there is no metrics/analytics
 * endpoint, and /readyz only reports dependency readiness, not product metrics. Rather
 * than present fabricated numbers as real, this surface honestly reports that usage
 * telemetry is not yet instrumented. It will be wired from the agent's audit-log /
 * metrics aggregation once that exists.
 */

import { Icon } from "@/lib/icons";

const PLANNED = [
  "Chat volume & active wallets",
  "Recommendation acceptance rate",
  "Simulation pass / fail rate",
  "Execution success rate",
  "Onboarding → deposit funnel",
];

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>Usage &amp; product</h1>
          <div className="sub">How the AI assistant and product mechanics perform.</div>
        </div>
        <span className="pill info">
          <span className="led" />
          Not yet instrumented
        </span>
      </div>
      <div
        className="infobanner"
        style={{ background: "var(--info-subtle, var(--surface-2))", borderColor: "var(--border-soft)" }}
      >
        <Icon name="info" size={16} />
        <span>
          Usage telemetry isn&rsquo;t wired yet. There is no metrics source behind these KPIs, so nothing
          is shown here rather than fabricated numbers. Once the agent&rsquo;s audit-log / metrics aggregation
          is available, these will be driven from real data.
        </span>
      </div>
      <div className="panel" style={{ marginTop: 16 }}>
        <div className="ch" style={{ marginBottom: 10 }}>
          <span className="ct">Planned metrics</span>
          <span className="prov">pending instrumentation</span>
        </div>
        {PLANNED.map((m) => (
          <div className="statusrow" key={m}>
            <span>{m}</span>
            <span className="pill info" style={{ fontSize: 10 }}>
              <span className="led" />
              pending
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
