"use client";

/**
 * /strategies — Strategy Recommendations, ranked against your mandate.
 *
 * Faithful 1:1 port of the design's `strategies` screen
 * (docs/design-handover/showcase/screens/strategies.js). Each card from data.recs
 * is ranked against the mandate (lower risk, capital-preservation-first, steady
 * yield), shows net APY / risk / fit, and carries a "Why this?" rationale that
 * expands. Markup, classes, and copy are reproduced verbatim.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import "@/components/screens/strategies.css";

export default function Page() {
  const router = useRouter();
  const [open, setOpen] = useState<Record<number, boolean>>({});

  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Strategies</h1>
          <div className="sub">Ranked against your plan — lower risk, steady yield</div>
        </div>
        <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("settings"))}>
          <Icon name="sliders" size={16} /> Edit mandate
        </button>
      </div>
      <div
        className="card card-pad"
        style={{
          marginBottom: 16,
          display: "flex",
          alignItems: "center",
          gap: 12,
          background: "var(--spark-subtle)",
          borderColor: "color-mix(in srgb,var(--primary) 22%,transparent)",
        }}
      >
        <Icon name="info" size={18} />
        <span style={{ fontSize: 13, color: "var(--muted-foreground)" }}>
          Only the lower-risk Aave vault is live today. Higher-risk strategies will rank here as more vaults open.
        </span>
      </div>
      {data.recs.map((r, i) => (
        <div className={"strat " + (i === 0 ? "best" : "")} key={r.id}>
          <div className="sh">
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                background: i === 0 ? "var(--spark-subtle)" : "var(--muted)",
                color: i === 0 ? "var(--primary)" : "var(--foreground)",
                borderRadius: 999,
                padding: "3px 10px",
              }}
            >
              {r.rank}
            </span>
            <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
          </div>
          <div className="st">{r.title}</div>
          <div className="sd">{r.thesis}</div>
          <div className="smetrics">
            {r.apy > 0 ? (
              <div>
                <div style={{ fontSize: 22, fontWeight: 600 }} className="tnum">
                  {r.apy}%
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>net APY · estimate</div>
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 22, fontWeight: 600 }} className="tnum">
                  —
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>no yield (cash)</div>
              </div>
            )}
            <RiskChip tier={r.risk} />
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", maxWidth: 200 }}>{r.fit}</div>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginBottom: 14 }}>
            Estimates, not guarantees.
          </div>
          <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
            {r.apy > 0 ? (
              <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("confirm/deposit"))}>
                Review this move
              </button>
            ) : (
              <button className="btn btn-outline btn-md" disabled>
                Already your posture
              </button>
            )}
            <button className="btn btn-ghost btn-md" onClick={() => setOpen((o) => ({ ...o, [i]: !o[i] }))}>
              <Icon name="info" size={15} /> Why this?
            </button>
          </div>
          <div className={"whybd" + (open[i] ? " open" : "")}>
            Ranked against your mandate (lower risk, capital-preservation-first, steady yield).{" "}
            {i === 0
              ? "Raises yield without changing your risk tier; stays 100% in the audited Aave vault; satisfies your beta cap and slippage guardrails."
              : "A conservative posture — less earning, more flexibility. Honest tradeoff, shown so you can choose."}
          </div>
        </div>
      ))}
    </div>
  );
}
