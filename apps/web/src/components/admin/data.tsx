"use client";

/**
 * Admin panel mock dataset + shared KPI tile. The admin panel uses its own local
 * numbers (a separate dataset from the main app), inlined verbatim from
 * docs/design-handover/showcase/SparkPoint Admin.html.
 */

import type { ReactNode } from "react";
import { STREAM, Sparkline } from "./charts";

/** revByStream — monthly revenue by stream (source: revByStream). */
export const revByStream: { x: string; swap: number; premium: number; perf: number; srk: number }[] = [
  { x: "Jan", swap: 420, premium: 1200, perf: 0, srk: 0 },
  { x: "Feb", swap: 680, premium: 1850, perf: 300, srk: 120 },
  { x: "Mar", swap: 910, premium: 2400, perf: 520, srk: 240 },
  { x: "Apr", swap: 1240, premium: 3100, perf: 780, srk: 360 },
  { x: "May", swap: 1680, premium: 3950, perf: 1100, srk: 520 },
  { x: "Jun", swap: 2120, premium: 4800, perf: 1500, srk: 720 },
];

/** sparkline series (source: data). */
export const data = {
  tvlSpark: [7.2, 7.6, 8.0, 8.4, 9.1, 9.8, 10.4, 11.2, 12.0],
  usersSpark: [120, 180, 260, 340, 420, 520, 640, 760, 910],
  revSpark: [1.6, 3.2, 5.1, 7.4, 10.3, 13.9],
  mrrSpark: [1.6, 2.5, 3.3, 4.3, 5.6, 6.9],
};

/** KPI tile — faithful port of the source `kpi()` builder. */
export function Kpi({
  label,
  val,
  spark,
  sparkColor,
  delta,
  deltaCls,
  ai = false,
}: {
  label: ReactNode;
  val: ReactNode;
  spark: number[];
  sparkColor: string;
  delta: ReactNode;
  deltaCls: "up" | "down" | "flat";
  ai?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="k">
        {ai ? <span className="aimark" /> : null}
        {label}
      </div>
      <div className="v tnum">{val}</div>
      <div className="foot">
        <Sparkline vals={spark} color={sparkColor} />
        <span className={`delta ${deltaCls}`}>{delta}</span>
      </div>
    </div>
  );
}

/** revenue-stream legend — faithful port of `legendStreams(withProj)`. */
export function LegendStreams({ withProj }: { withProj: boolean }) {
  return (
    <div className="legend">
      <span>
        <i style={{ background: STREAM.swap }} />
        Swap fee
      </span>
      <span>
        <i style={{ background: STREAM.premium }} />
        Premium
      </span>
      {withProj ? (
        <>
          <span>
            <i style={{ background: STREAM.perf }} />
            Perf fee
          </span>
          <span style={{ color: STREAM.srk }}>
            <i className="dash" style={{ color: STREAM.srk }} />
            SRK <span className="estbadge">EST</span>
          </span>
        </>
      ) : null}
    </div>
  );
}
