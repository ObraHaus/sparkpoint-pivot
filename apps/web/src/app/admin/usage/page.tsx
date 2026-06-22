"use client";

/**
 * Admin → Usage & product (scUsage). "How the AI assistant and product mechanics
 * perform." Faithful 1:1 port of the Usage screen in SparkPoint Admin.html.
 * Pure telemetry — no controls.
 */

import { STREAM, StackedBars } from "@/components/admin/charts";
import { Kpi } from "@/components/admin/data";
import { Funnel } from "@/components/admin/funnels";

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>Usage &amp; product</h1>
          <div className="sub">How the AI assistant and product mechanics perform.</div>
        </div>
      </div>
      <div className="band">
        <Kpi label="Chat volume (30d)" val="18.4K" spark={[12, 14, 15, 16, 17, 18]} sparkColor={STREAM.premium} delta="▲" deltaCls="up" ai />
        <Kpi label="Recommendation acceptance" val="58%" spark={[48, 52, 54, 55, 57, 58]} sparkColor={STREAM.swap} delta="▲" deltaCls="up" ai />
        <Kpi label="Simulation pass rate" val="97.2%" spark={[95, 96, 96, 97, 97, 97]} sparkColor={STREAM.srk} delta="▲" deltaCls="up" />
        <Kpi label="Execution success" val="98.1%" spark={[96, 97, 97, 98, 98, 98]} sparkColor={STREAM.premium} delta="▲" deltaCls="up" />
      </div>
      <div className="grid2">
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Recommendation funnel</span>
            <span className="prov">computed</span>
          </div>
          <Funnel />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Simulation pass / fail</span>
            <span className="prov">tenderly</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: "var(--gain)" }} />
              Passed
            </span>
            <span>
              <i style={{ background: "var(--loss)" }} />
              Will revert / blocked
            </span>
          </div>
          <StackedBars
            data={["Mon", "Tue", "Wed", "Thu", "Fri"].map((d, i) => ({
              x: d,
              ok: [120, 140, 110, 160, 150][i],
              fail: [4, 3, 6, 2, 4][i],
            }))}
            keys={["ok", "fail"]}
            max={170}
            opts={{ H: 200, colors: { ok: "var(--gain)", fail: "var(--loss)" } }}
          />
        </div>
      </div>
    </>
  );
}
