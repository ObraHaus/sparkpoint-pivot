"use client";

/**
 * Admin → TVL & vault (scTvl). "The money view — onchain truth. Display-only,
 * never a gate." Faithful 1:1 port of the TVL screen in SparkPoint Admin.html.
 * Status surfaces only — no fund-moving controls.
 */

import { Icon } from "@/lib/icons";
import { STREAM, DivergeBars, Composed, Kpi } from "@/components/admin/charts";
import { data } from "@/components/admin/data";

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>TVL &amp; vault</h1>
          <div className="sub">The money view — onchain truth. Display-only, never a gate.</div>
        </div>
        <span className="pill info" title="Illustrative sample data — not yet instrumented">
          <span className="led" /> Sample data
        </span>
        <div className="ctrls">
          <div className="seg">
            <button>7d</button>
            <button className="on">30d</button>
            <button>90d</button>
          </div>
        </div>
      </div>
      <div className="band">
        <Kpi label="Total TVL" val="$12.0M" spark={data.tvlSpark} sparkColor={STREAM.swap} delta="▲ 7.1%" deltaCls="up" />
        <Kpi label="Net flow (30d)" val="+$1.4M" spark={[3, 4, 2, 5, 6, 4, 7]} sparkColor={STREAM.premium} delta="▲ inflow" deltaCls="up" />
        <Kpi label="Cap utilization" val="48%" spark={[30, 34, 38, 41, 44, 46, 48]} sparkColor={STREAM.srk} delta="headroom" deltaCls="flat" />
        <Kpi label="Trailing APY (net)" val="4.3%" spark={[4.0, 4.1, 4.05, 4.2, 4.15, 4.3]} sparkColor={STREAM.premium} delta="realized" deltaCls="flat" />
      </div>
      <div className="grid2">
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Deposits / withdrawals &amp; net flow</span>
            <span className="prov">RPC + subgraph · 42s ago</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: "var(--gain)" }} />
              Deposits
            </span>
            <span>
              <i style={{ background: "var(--loss)" }} />
              Withdrawals
            </span>
            <span>
              <i style={{ background: STREAM.swap }} />
              Net (cumulative)
            </span>
          </div>
          <DivergeBars dep={[220, 310, 180, 420, 380, 260, 510, 440]} wd={[-90, -120, -60, -140, -110, -200, -90, -130]} opts={{ H: 240 }} />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">TVL over time</span>
            <span className="prov">materialized</span>
          </div>
          {/* source replaces STREAM.srk with "transparent" to hide the secondary line */}
          <Composed
            areaV={[7.2, 8.0, 8.8, 9.6, 10.6, 11.4, 12.0]}
            lineV={[7.2, 8.0, 8.8, 9.6, 10.6, 11.4, 12.0]}
            amax={13}
            lmax={13}
            opts={{ H: 200 }}
            lineColor="transparent"
          />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Withdraw-always drill &amp; kill-switch</span>
            <span className="pill ok">
              <span className="led" />
              Healthy
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Last withdraw-always drill</span>
            <span className="pill info">
              <Icon name="info" size={12} /> Not yet run in this env
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Kill-switch (pause-only)</span>
            <span className="pill info">
              <Icon name="pause" size={12} /> Inactive
            </span>
          </div>
          <div className="statusrow">
            <span className="muted">Guardian (live)</span>
            <a
              className="mono"
              style={{ fontSize: 11, color: "var(--primary)" }}
              href="https://sepolia.basescan.org/address/0x0A21A9B4c2cd2d6a68EC828188826B673572d720"
              target="_blank"
              rel="noreferrer"
            >
              0x0A21…d720 <Icon name="ext" size={11} />
            </a>
          </div>
          <div style={{ fontSize: 11.5, color: "var(--muted-foreground)", marginTop: 10, lineHeight: 1.5 }}>
            <Icon name="info" size={13} /> Pause never blocks withdrawals and is a multisig action outside this panel. Status only — no controls.
          </div>
        </div>
      </div>
    </>
  );
}
