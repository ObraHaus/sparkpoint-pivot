"use client";

/**
 * /vault — Aave Yield Vault overview: net-APY breakdown (Aave supply rate − the
 * 10% performance fee over a high-water mark → net APY), APY history sparkline,
 * your position (shares / accrued / idle), beta-cap meter, and audit pills.
 *
 * Faithful 1:1 port of the design's `vault` screen
 * (docs/design-handover/showcase/screens/vault.js). Markup, classes, and copy verbatim.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { data } from "@/lib/mock-data";
import { money, fmt } from "@/lib/utils";
import { RiskChip } from "@/components/ui/risk-chip";
import { toHref } from "@/lib/nav";
import "@/components/screens/vault.css";

const v = data.vault;

/** APY-history line path (mirrors the design's `apyPath`). */
function apyPath(vals: number[], W: number, H: number) {
  const min = Math.min(...vals) - 0.1,
    max = Math.max(...vals) + 0.1,
    r = max - min || 1,
    p = 6;
  return (
    "M" +
    vals
      .map(
        (val, i) =>
          (p + (i / (vals.length - 1)) * (W - p * 2)).toFixed(1) +
          " " +
          (p + (1 - (val - min) / r) * (H - p * 2)).toFixed(1),
      )
      .join(" L")
  );
}

const HIST_RANGES = ["7d", "30d", "90d"];

export default function Page() {
  const router = useRouter();
  const [hist, setHist] = useState("30d");

  const capPct = (v.capUsed / v.capUser) * 100;

  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1>Aave Yield Vault</h1>
          <div className="sub">Conservative, capital-preservation-first yield on USDC · Base</div>
        </div>
        <div className="actions">
          <RiskChip tier={1} />
          <button className="btn btn-outline btn-md" onClick={() => router.push(toHref("vault/withdraw"))}>
            <Icon name="door" size={16} /> Withdraw
          </button>
          <button className="btn btn-primary btn-md" onClick={() => router.push(toHref("vault/deposit"))}>
            Review deposit
          </button>
        </div>
      </div>
      <div className="vault-grid">
        <div className="card card-pad">
          <div className="card-hd">
            <span className="lbl">Net APY</span>
            <span className="badge badge-ai">AI-managed</span>
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            <div style={{ fontSize: 38, fontWeight: 600, letterSpacing: "-.02em" }} className="tnum">
              {v.netApy}%
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 7 }}>
              net APY · estimate
            </div>
          </div>
          <div className="apybreak" style={{ marginTop: 16 }}>
            <div className="br">
              <span className="muted">Aave supply rate</span>
              <span className="tnum">{v.supplyApy}%</span>
            </div>
            <div className="br">
              <span className="muted">
                Performance fee · {v.perfFee}% of yield <span style={{ fontSize: 11 }}>(over high-water mark)</span>
              </span>
              <span className="tnum">−{(v.supplyApy - v.netApy).toFixed(2)}%</span>
            </div>
            <div className="divider" style={{ margin: "4px 0" }} />
            <div className="br" style={{ fontWeight: 600 }}>
              <span>Net APY</span>
              <span className="tnum">{v.netApy}%</span>
            </div>
          </div>
          <div style={{ marginTop: 14, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Estimates, not guarantees. Rates change; historical and current only — no projections.
          </div>
          <div className="divider" />
          <div className="card-hd">
            <span className="t">APY history</span>
            <div className="seg">
              {HIST_RANGES.map((r) => (
                <button key={r} className={r === hist ? "active" : ""} onClick={() => setHist(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <svg width="100%" height="80" viewBox="0 0 520 80" preserveAspectRatio="none">
            <path d={apyPath(data.apyHist, 520, 80)} fill="none" stroke="var(--info)" strokeWidth="2" />
          </svg>
        </div>
        <div className="card card-pad">
          <div className="card-hd">
            <span className="lbl">Your position</span>
          </div>
          <div className="stat" style={{ marginBottom: 14 }}>
            <span className="k">Shares held</span>
            <span className="v tnum">{fmt(v.shares, 4)}</span>
            <span className="muted" style={{ fontSize: 11 }}>
              spvUSDC ≈ {money(v.shareValue)}
            </span>
          </div>
          <div className="preview-row">
            <span className="muted">Accrued yield</span>
            <span className="tnum" style={{ color: "var(--gain)" }}>
              +{money(v.accrued)}
            </span>
          </div>
          <div className="preview-row">
            <span className="muted">Idle USDC available</span>
            <span className="tnum">{money(data.idleUSDC)}</span>
          </div>
          <div className="divider" />
          <div className="card-hd">
            <span className="lbl">Your beta cap</span>
            <span className="tnum" style={{ fontSize: 12 }}>
              {money(v.capUsed, 0)} / {money(v.capUser, 0)}
            </span>
          </div>
          <div className="capmeter">
            <i style={{ width: `${capPct}%` }} />
          </div>
          <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 8 }}>
            {(100 - capPct).toFixed(0)}% of your beta cap remaining. You can always withdraw, regardless of caps.
          </div>
          <div className="divider" />
          <div style={{ display: "flex", gap: 8 }}>
            <span className="pill ghosty" style={{ cursor: "default" }}>
              <Icon name="shieldcheck" size={13} /> Audited
            </span>
            <span className="pill ghosty" style={{ cursor: "default" }}>
              <Icon name="lock" size={13} /> Non-upgradeable
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
