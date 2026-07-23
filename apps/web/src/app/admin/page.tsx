"use client";

/**
 * Admin → Overview (scOverview). "How we're doing, right now, at a glance."
 * Faithful 1:1 port of the Overview screen in SparkPoint Admin.html.
 */

import { Icon } from "@/lib/icons";
import { STREAM, StackedBars, Composed, Kpi, LegendStreams } from "@/components/admin/charts";
import { data, revByStream } from "@/components/admin/data";

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>Overview</h1>
          <div className="sub">How we&apos;re doing, right now, at a glance.</div>
        </div>
        <span className="pill info" title="Illustrative sample data — not yet instrumented">
          <span className="led" /> Sample data
        </span>
        <div className="ctrls">
          <div className="seg">
            <button>24h</button>
            <button>7d</button>
            <button className="on">30d</button>
            <button>90d</button>
            <button>All</button>
          </div>
          <button className="btn-exp">
            <Icon name="ext" size={13} /> Export
          </button>
        </div>
      </div>
      <div className="band">
        <Kpi label="TVL" val="$12.0M" spark={data.tvlSpark} sparkColor={STREAM.swap} delta="▲ 7.1%" deltaCls="up" />
        <Kpi label="Active users (WAU)" val="910" spark={data.usersSpark} sparkColor={STREAM.premium} delta="▲ 19%" deltaCls="up" />
        <Kpi label="Cumulative revenue" val="$13.9K" spark={data.revSpark} sparkColor={STREAM.srk} delta="▲ since launch" deltaCls="up" />
        <Kpi label="MRR-equivalent" val="$6.9K" spark={data.mrrSpark} sparkColor={STREAM.premium} delta="▲ 23% MoM" deltaCls="up" />
      </div>
      <div className="grid2">
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Growth at a glance</span>
            <span className="prov">RPC + materialized · 42s ago</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: STREAM.swap }} />
              TVL
            </span>
            <span>
              <i style={{ background: STREAM.premium }} />
              Active users
            </span>
          </div>
          <Composed
            areaV={[7.2, 8.0, 8.8, 9.6, 10.6, 11.4, 12.0]}
            lineV={[120, 260, 420, 560, 710, 820, 910]}
            amax={13}
            lmax={1000}
            opts={{ H: 230 }}
          />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Revenue snapshot</span>
            <span className="prov">computed · 03:00</span>
          </div>
          <LegendStreams withProj />
          <StackedBars data={revByStream} keys={["swap", "premium", "perf", "srk"]} max={9000} opts={{ H: 200 }} />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Activity — daily executions</span>
            <span className="prov">indexer · 42s ago</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: "var(--gain)" }} />
              Confirmed
            </span>
            <span>
              <i style={{ background: "var(--loss)" }} />
              Failed
            </span>
          </div>
          <StackedBars
            data={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d, i) => ({
              x: d,
              ok: [42, 55, 48, 61, 70, 38, 44][i],
              fail: [2, 1, 3, 2, 1, 0, 2][i],
            }))}
            keys={["ok", "fail"]}
            max={75}
            opts={{ H: 200, colors: { ok: "var(--gain)", fail: "var(--loss)" } }}
          />
        </div>
      </div>
    </>
  );
}
