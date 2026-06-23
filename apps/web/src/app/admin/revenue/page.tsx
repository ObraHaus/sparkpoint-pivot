"use client";

/**
 * Admin → Revenue ★ (scRevenue) — the graphical revenue dashboard / centerpiece.
 * Revenue by stream over time, trajectory & forecast, cumulative, fee-vs-TVL
 * take-rate, performance-fee HWM, "we only earn when you earn", revenue history.
 * Faithful 1:1 port of the Revenue screen in SparkPoint Admin.html.
 */

import { Icon } from "@/lib/icons";
import { STREAM, StackedBars, Trajectory, DualArea, Composed } from "@/components/admin/charts";
import { data, Kpi, LegendStreams, revByStream } from "@/components/admin/data";

/** revRows() — month-by-month table body with running cumulative + MoM. */
function RevRows() {
  // precompute totals/cumulative so the render maps a pure derived array (no
  // mutation — keeps the source's running-cumulative semantics).
  const total = (d: (typeof revByStream)[number]) => d.swap + d.premium + d.perf + d.srk;
  const rows = revByStream.map((d, i) => {
    const tot = total(d);
    const cum = revByStream.slice(0, i + 1).reduce((s, x) => s + total(x), 0);
    const prev = i ? total(revByStream[i - 1]) : 0;
    const mom = i ? (((tot - prev) / prev) * 100).toFixed(0) + "%" : "—";
    return { ...d, tot, cum, mom };
  });
  return (
    <>
      {rows.map((d) => (
        <tr key={d.x}>
          <td>{d.x}</td>
          <td className="num">${d.swap}</td>
          <td className="num">${d.premium}</td>
          <td className="num">${d.perf}</td>
          <td className="num" style={{ color: "var(--muted-foreground)" }}>
            ${d.srk}
          </td>
          <td className="num">${d.tot.toLocaleString()}</td>
          <td className="num">${d.cum.toLocaleString()}</td>
          <td className="num" style={{ color: "var(--gain)" }}>
            {d.mom !== "—" ? "▲ " + d.mom : "—"}
          </td>
        </tr>
      ))}
    </>
  );
}

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>Revenue ★</h1>
          <div className="sub">Revenue in action — realized solid, projected dashed. We never lead with a projection.</div>
        </div>
        <div className="ctrls">
          <div className="seg">
            <button>Day</button>
            <button>Week</button>
            <button className="on">Month</button>
          </div>
          <button className="btn-exp">
            <Icon name="ext" size={13} /> Export (audited)
          </button>
        </div>
      </div>
      <div className="infobanner">
        <Icon name="info" size={16} />
        <span>
          Realized revenue is solid; <b style={{ color: "var(--foreground)" }}>projected lanes are illustrative, not forecasts of return</b>. The
          conservative Aave vault is 0-fee; the 10% performance fee (over high-water mark) is active in v1.
        </span>
      </div>
      <div className="band">
        <Kpi label="Cumulative revenue" val="$13.9K" spark={data.revSpark} sparkColor={STREAM.srk} delta="▲ all-time" deltaCls="up" />
        <Kpi label="Revenue this period" val="$9.1K" spark={[3, 4, 5, 6.5, 8, 9.1]} sparkColor={STREAM.premium} delta="▲ 27% MoM" deltaCls="up" />
        <Kpi label="ARR-equivalent" val="$82.8K" spark={data.mrrSpark} sparkColor={STREAM.premium} delta="▲ 23%" deltaCls="up" ai />
        <Kpi label="Blended take-rate" val="11 bps" spark={[18, 16, 14, 13, 12, 11]} sparkColor={STREAM.swap} delta="▼ modest by design" deltaCls="flat" />
      </div>
      <div className="grid2">
        <div className="chartcard span2">
          <div className="ch">
            <span className="ct">Revenue by stream, over time</span>
            <span className="prov">computed · 03:00</span>
          </div>
          <LegendStreams withProj />
          <StackedBars data={revByStream} keys={["swap", "premium", "perf", "srk"]} max={9000} opts={{ H: 250 }} />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Revenue trajectory &amp; forecast</span>
            <span className="estbadge">forecast = naive run-rate</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: STREAM.swap }} />
              Realized
            </span>
            <span style={{ color: STREAM.swap }}>
              <i className="dash" style={{ color: STREAM.swap }} />
              Forecast <span className="estbadge">EST</span>
            </span>
          </div>
          <Trajectory real={[1.6, 3.2, 5.1, 7.4, 10.3, 13.9]} fore={[13.9, 17.5, 21.6, 26.2, 31.4]} max={33} opts={{ H: 210 }} />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Cumulative revenue</span>
            <span className="prov">computed</span>
          </div>
          <DualArea yieldV={[1.6, 3.2, 5.1, 7.4, 10.3, 13.9]} revV={[0, 0, 0, 0, 0, 0]} max={15} opts={{ H: 210 }} hideRev />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Fee vs TVL — blended take-rate</span>
            <span className="prov">computed</span>
          </div>
          <div className="legend">
            <span>
              <i style={{ background: STREAM.swap }} />
              TVL
            </span>
            <span style={{ color: STREAM.srk }}>
              <i style={{ background: STREAM.srk }} />
              Take-rate (bps)
            </span>
          </div>
          <Composed areaV={[7.2, 8.0, 8.8, 9.6, 10.6, 12.0]} lineV={[18, 16, 14, 13, 12, 11]} amax={13} lmax={22} opts={{ H: 210 }} />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Performance-fee high-water mark</span>
            <span className="pill ok" style={{ fontSize: 10 }}>
              Active · v1
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            <svg viewBox="0 0 540 150" width="100%" height="150">
              <line x1="42" y1="58" x2="526" y2="58" stroke={STREAM.srk} strokeDasharray="4 3" />
              <text x="46" y="52" fontSize="9" fill="var(--muted-foreground)">
                high-water mark
              </text>
              <path d="M42 90 L120 84 L200 70 L280 76 L360 60 L440 50 L526 44" fill="none" stroke={STREAM.premium} strokeWidth="2.2" />
              <circle cx="526" cy="44" r="3.5" fill={STREAM.premium} />
            </svg>
            <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
              Above HWM → the 10% fee accrues. Below → no fee, recovering.{" "}
              <b style={{ color: "var(--gain)" }}>We only earn when you earn.</b> Inactive at launch.
            </div>
          </div>
        </div>
      </div>
      <div className="weeornot" style={{ marginBottom: 16 }}>
        <div className="ch" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <span className="ct">We only earn when you earn</span>
          <span className="prov" style={{ color: "var(--muted-foreground)" }}>
            never on your principal, never by taking custody
          </span>
        </div>
        <div className="legend">
          <span>
            <i style={{ background: STREAM.premium }} />
            Cumulative user yield
          </span>
          <span>
            <i style={{ background: "var(--muted-foreground)" }} />
            Cumulative protocol revenue
          </span>
        </div>
        <DualArea yieldV={[20, 55, 110, 190, 290, 410]} revV={[1.6, 3.2, 5.1, 7.4, 10.3, 13.9]} max={430} opts={{ H: 200 }} />
      </div>
      <div className="panel">
        <div className="ch" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <span className="ct">Revenue history</span>
          <button className="btn-exp">
            <Icon name="ext" size={13} /> CSV (audited)
          </button>
        </div>
        <table className="adtbl">
          <thead>
            <tr>
              <th>Month</th>
              <th className="num">Swap</th>
              <th className="num">Premium</th>
              <th className="num">Perf</th>
              <th className="num">SRK (est)</th>
              <th className="num">Total</th>
              <th className="num">Cumulative</th>
              <th className="num">MoM</th>
            </tr>
          </thead>
          <tbody>
            <RevRows />
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              <td className="num">$7.0K</td>
              <td className="num">$17.3K</td>
              <td className="num">$4.2K</td>
              <td className="num">$2.0K</td>
              <td className="num">$30.5K</td>
              <td className="num">—</td>
              <td className="num">—</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}
