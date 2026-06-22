"use client";

/**
 * Admin → System & ops health (scSystem). "Is the machine healthy? Health
 * surfaces never expose a fund control." Faithful 1:1 port of the System screen
 * in SparkPoint Admin.html. The kill-switch surface here is status only.
 */

import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { StackedBars, Composed } from "@/components/admin/charts";

type Tile = [string, "ok" | "amber" | "info", string];

const tiles: Tile[] = [
  ["Agent service", "ok", "Up"],
  ["RPC / Alchemy", "ok", "Healthy"],
  ["Indexer lag", "ok", "2 blocks"],
  ["Subgraphs", "ok", "Fresh"],
  ["Tenderly sim", "ok", "Available"],
  ["Sentry error rate", "ok", "0.2%"],
  ["Data freshness", "amber", "12m"],
  ["Kill-switch", "info", "Inactive"],
];

export default function Page() {
  const router = useRouter();
  return (
    <>
      <div className="pghead">
        <div>
          <h1>System &amp; ops health</h1>
          <div className="sub">Is the machine healthy? Health surfaces never expose a fund control.</div>
        </div>
      </div>
      <div className="band" style={{ gridTemplateColumns: "repeat(4,1fr)" }}>
        {tiles.map((t) => (
          <div className="kpi" key={t[0]}>
            <div className="k">{t[0]}</div>
            <div style={{ marginTop: 10 }}>
              <span className={`pill ${t[1]}`}>
                <span className="led" />
                {t[2]}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="grid2">
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Policy-engine decisions</span>
            <span className="prov">audit_logs · 42s ago</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: "var(--gain)" }} />
              Approved
            </span>
            <span>
              <i style={{ background: "var(--caution)" }} />
              Blocked (cap/slippage)
            </span>
          </div>
          {/* source replaces STREAM.swap→var(--gain), STREAM.premium→var(--caution) */}
          <StackedBars
            data={["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => ({
              x: d,
              ok: [88, 92, 80, 96, 90][i],
              block: [6, 4, 9, 3, 5][i],
            }))}
            keys={["ok", "block"]}
            max={105}
            opts={{ H: 200, colors: { ok: "var(--gain)", block: "var(--caution)" } }}
          />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Simulation latency p50 / p95</span>
            <span className="prov">tenderly</span>
          </div>
          <Composed areaV={[0.4, 0.5, 0.45, 0.6, 0.5, 0.55]} lineV={[0.9, 1.1, 1.0, 1.3, 1.1, 1.2]} amax={1.5} lmax={1.5} opts={{ H: 200 }} />
        </div>
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Kill-switch status</span>
            <span className="pill info">
              <span className="led" />
              Pause-only · inactive
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Current state</span>
            <span>Deposits live · withdrawals always open</span>
          </div>
          <div className="statusrow">
            <span className="muted">Who can pause</span>
            <span className="mono" style={{ fontSize: 11 }}>
              Multisig 0x4d…A1 <Icon name="ext" size={11} />
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", maxWidth: 430 }}>
              <Icon name="info" size={13} /> Pause never blocks withdrawals (N2) and is governed by the multisig. Initiating a pause here only{" "}
              <b style={{ color: "var(--foreground)" }}>proposes</b> it — execution still requires the multisig threshold.
            </div>
            <button
              className="btn-exp"
              style={{ borderColor: "color-mix(in srgb,var(--caution) 40%,transparent)", color: "var(--caution)" }}
              onClick={() => router.push("/admin/killswitch")}
            >
              <Icon name="pause" size={13} /> Open kill-switch control
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
