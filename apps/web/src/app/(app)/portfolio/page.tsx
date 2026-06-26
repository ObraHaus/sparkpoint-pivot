"use client";

/**
 * /portfolio — Portfolio Overview: net-worth hero + over-time chart, risk panel,
 * allocation donut (by risk tier), and positions table.
 *
 * Faithful 1:1 port of the design's `portfolio` screen
 * (docs/design-handover/showcase/screens/portfolio.js). Markup, classes, copy,
 * and the inline SVG area chart are reproduced verbatim.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import "@/components/screens/portfolio.css";

/** Build the line + area path for the net-worth chart (mirrors the design's `areaPath`). */
function areaPath(vals: number[], W: number, H: number, pad = 6) {
  const min = Math.min(...vals),
    max = Math.max(...vals),
    rng = max - min || 1;
  const pts = vals.map((v, i): [number, number] => [
    pad + (i / (vals.length - 1)) * (W - pad * 2),
    pad + (1 - (v - min) / rng) * (H - pad * 2),
  ]);
  const d = "M" + pts.map((p) => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  const line = d;
  const area = d + ` L${(W - pad).toFixed(1)} ${H} L${pad} ${H} Z`;
  return { line, area, last: pts[pts.length - 1] };
}

const RANGES = ["1D", "1W", "1M", "1Y", "All"];

export default function Page() {
  const router = useRouter();
  const [range, setRange] = useState("1M");

  const { line, area, last } = areaPath(data.series1M, 560, 150);
  const total = data.allocation.reduce((s, x) => s + x.v, 0);
  const a0pct = (data.allocation[0].v / total) * 100,
    a1pct = 100 - a0pct;
  const donut = `conic-gradient(var(--risk-1) 0 ${a0pct}%, var(--muted-foreground) ${a0pct}% 100%)`;

  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1>Portfolio</h1>
          <div className="sub">Your position, performance, and risk — net of everything.</div>
        </div>
        <div className="actions">
          <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("vault"))}>
            <Icon name="vault" size={16} /> Open vault
          </button>
          <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("chat"))}>
            <Icon name="chat" size={16} /> Ask AI
          </button>
        </div>
      </div>

      <div className="pf-hero">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="lbl">Net worth</span>
            <div className="seg pf-range">
              {RANGES.map((r) => (
                <button key={r} className={r === range ? "active" : ""} onClick={() => setRange(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="pf-net tnum">{money(data.netWorth)}</div>
          <div className="delta up" style={{ marginTop: 8 }}>
            <Icon name="up" size={15} />+{money(data.pnl.abs)} (+{data.pnl.pct}%, {data.pnl.window})
          </div>
          <div className="pf-spark-area">
            <svg width="100%" height="150" viewBox="0 0 560 150" preserveAspectRatio="none">
              <defs>
                <linearGradient id="pfg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="var(--primary)" stopOpacity=".26" />
                  <stop offset="1" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={area} fill="url(#pfg)" />
              <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2" />
              <circle cx={last[0]} cy={last[1]} r="4" fill="var(--primary)" />
              <circle cx={last[0]} cy={last[1]} r="8" fill="var(--primary)" opacity=".2" />
            </svg>
          </div>
        </div>
        <div className="card card-pad riskpanel">
          <div className="card-hd">
            <span className="lbl">Risk panel</span>
            <RiskChip tier={1} />
          </div>
          <div className="rp-row">
            <span className="muted">Portfolio risk</span>
            <span style={{ fontWeight: 600 }}>Lower · 1/5</span>
          </div>
          <div className="rp-row">
            <span className="muted">Drift vs your plan</span>
            <span style={{ color: "var(--gain)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
              <Icon name="check" size={13} /> On plan
            </span>
          </div>
          <div className="rp-row">
            <span className="muted">Concentration</span>
            <span style={{ fontWeight: 600 }}>{a0pct.toFixed(0)}% single vault</span>
          </div>
          <div className="rp-row">
            <span className="muted">Largest position</span>
            <span style={{ fontWeight: 600 }}>Aave Yield Vault</span>
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Capital-preservation-first. The audited Aave vault is the lowest tier on our scale.{" "}
            <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("strategies"))}>
              Improve this
            </a>
          </div>
        </div>
      </div>

      <div className="pf-grid">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Allocation by risk tier</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
            <div className="donut" style={{ background: donut, position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  inset: 18,
                  borderRadius: "50%",
                  background: "var(--card)",
                  display: "grid",
                  placeItems: "center",
                  textAlign: "center",
                }}
              >
                <div>
                  <div style={{ fontSize: 18, fontWeight: 600 }} className="tnum">
                    {money(total, 0)}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted-foreground)" }}>2 positions</div>
                </div>
              </div>
            </div>
            <div className="legend" style={{ flex: 1 }}>
              <div className="legrow">
                <span className="sw" style={{ background: "var(--risk-1)" }} />
                <span className="lg">Aave Yield Vault · Risk 1</span>
                <span className="lv tnum">{a0pct.toFixed(0)}%</span>
              </div>
              <div className="legrow">
                <span className="sw" style={{ background: "var(--muted-foreground)" }} />
                <span className="lg">Idle USDC · uninvested</span>
                <span className="lv tnum">{a1pct.toFixed(0)}%</span>
              </div>
              <div className="divider" />
              <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                Idle USDC earns nothing.{" "}
                <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("vault/deposit"))}>
                  Put it to work
                </a>
              </div>
            </div>
          </div>
        </div>
        <div className="card card-pad">
          <div className="card-hd">
            <span className="t">Positions</span>
            <span className="lbl">net of fees</span>
          </div>
          <table className="tbl">
            <thead>
              <tr>
                <th>Position</th>
                <th className="num">Value</th>
                <th className="num">PnL</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ cursor: "pointer" }} onClick={() => router.push(toHref("portfolio/vault"))}>
                <td>
                  <div style={{ fontWeight: 600 }}>Aave Yield Vault</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    9,834.50 spvUSDC
                  </div>
                </td>
                <td className="num tnum">{money(data.allocation[0].v)}</td>
                <td className="num">
                  <span className="delta up" style={{ fontSize: 12.5 }}>
                    +$34.42
                  </span>
                </td>
                <td>
                  <Icon name="chevr" size={15} />
                </td>
              </tr>
              <tr>
                <td>
                  <div style={{ fontWeight: 600 }}>Idle USDC</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    in your wallet
                  </div>
                </td>
                <td className="num tnum">{money(data.allocation[1].v)}</td>
                <td className="num muted">—</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
