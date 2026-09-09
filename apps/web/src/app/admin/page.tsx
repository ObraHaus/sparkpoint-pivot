"use client";

/**
 * Admin → Overview (scOverview). "How we're doing, right now, at a glance."
 *
 * Was 100% sample data (a fabricated $12M-TVL growth dashboard). Now the headline tiles are LIVE
 * on-chain vault reads, and the fabricated growth/revenue/activity charts are replaced with an honest
 * launchpad into the real operator surfaces. Growth analytics (WAU, MRR, activity time-series) are not
 * yet instrumented, so they are pointed to rather than faked.
 */

import { Icon } from "@/lib/icons";
import { Kpi } from "@/components/admin/charts";
import { useVaultStats } from "@/lib/admin/useVaultStats";
import { formatUsdCompact } from "@/lib/admin/vaultStats";

const SURFACES: { href: string; icon: string; label: string; sub: string }[] = [
  { href: "/admin/tvl", icon: "vault", label: "TVL & vault", sub: "Live TVL, caps, pause state" },
  { href: "/admin/revenue", icon: "portfolio", label: "Revenue", sub: "Real fees by network & stream" },
  { href: "/admin/usage", icon: "activity", label: "Usage & limits", sub: "Per-tier AI consumption" },
  { href: "/admin/vaults", icon: "vault", label: "Vaults", sub: "Caps & guardian actions" },
  { href: "/admin/killswitch", icon: "pause", label: "Kill-switch", sub: "Live on-chain pause state" },
  { href: "/admin/uptime", icon: "activity", label: "Uptime", sub: "Service monitors" },
  { href: "/admin/diagnostics", icon: "flask", label: "Diagnostics", sub: "Network captures" },
  { href: "/admin/system", icon: "shield", label: "System", sub: "Readiness probe" },
];

export default function Page() {
  const s = useVaultStats();

  const statusPill = !s.configured
    ? { cls: "amber", text: "Vault not configured" }
    : s.loading
      ? { cls: "info", text: "Reading chain…" }
      : { cls: "ok", text: "Live · on-chain" };

  const vaultStatus = s.paused === undefined ? "…" : s.paused ? "Paused" : "Active";

  return (
    <>
      <div className="pghead">
        <div>
          <h1>Overview</h1>
          <div className="sub">How we&apos;re doing, right now, at a glance.</div>
        </div>
        <span className={`pill ${statusPill.cls}`}>
          <span className="led" /> {statusPill.text}
        </span>
      </div>

      <div className="band">
        <Kpi label="Total TVL" val={formatUsdCompact(s.tvl)} />
        <Kpi label="Cap utilization" val={s.capUtilPct === null ? "—" : `${s.capUtilPct.toFixed(1)}%`} />
        <Kpi label="Deposit cap" val={s.cap === undefined ? "…" : s.cap === 0n ? "No cap set" : formatUsdCompact(s.cap)} />
        <Kpi label="Vault status" val={vaultStatus} />
      </div>

      <div className="panel">
        <div className="ch" style={{ marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="ct">Live operator surfaces</span>
          <span className="prov">jump to real data</span>
        </div>
        <div
          style={{
            display: "grid",
            gap: 10,
            gridTemplateColumns: "repeat(auto-fill,minmax(220px,1fr))",
          }}
        >
          {SURFACES.map((x) => (
            <a
              key={x.href}
              href={x.href}
              className="kpi"
              style={{ textDecoration: "none", display: "flex", gap: 11, alignItems: "flex-start" }}
            >
              <Icon name={x.icon} size={18} />
              <span>
                <span style={{ display: "block", fontWeight: 600, fontSize: 13.5, color: "var(--foreground)" }}>{x.label}</span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 2 }}>{x.sub}</span>
              </span>
            </a>
          ))}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 14, lineHeight: 1.5 }}>
          <Icon name="info" size={13} /> Headline tiles are live on-chain reads. Growth analytics (active users, MRR,
          activity time-series) are not yet instrumented — they are surfaced on the pages above where the data is real,
          rather than shown here as fabricated numbers.
        </div>
      </div>
    </>
  );
}
