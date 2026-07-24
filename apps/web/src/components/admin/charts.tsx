"use client";

/**
 * Admin chart helpers — hand-built, token-styled SVG charts.
 * Faithful 1:1 port of the chart builders in
 * docs/design-handover/showcase/SparkPoint Admin.html (axisY, stackedBars,
 * trajectory, dualArea, divergeBars, composed, sparkline). HTML string output is
 * translated to JSX; numeric geometry is identical to the source.
 */

import type { ReactNode } from "react";

/** stream color contract (STREAM in the source). */
export const STREAM = {
  swap: "#4D83FF",
  premium: "#38C6F4",
  perf: "#9B6CEB",
  mgmt: "#C45FD6",
  srk: "#F5B62E",
  treasury: "#8A97A8",
} as const;

/** KPI tile — faithful port of the source `kpi()` builder. A chart PRIMITIVE (relocated here from
 *  `data.tsx` in feature 013 so the real `/admin/revenue` reads no mock module). */
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
  /** A sparkline is optional — a live single-value tile omits it rather than draw a fabricated trend. */
  spark?: number[];
  sparkColor?: string;
  delta?: ReactNode;
  deltaCls?: "up" | "down" | "flat";
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
        {spark && spark.length ? <Sparkline vals={spark} color={sparkColor ?? STREAM.swap} /> : <span />}
        {delta ? <span className={`delta ${deltaCls ?? "flat"}`}>{delta}</span> : null}
      </div>
    </div>
  );
}

/** revenue-stream legend — faithful port of `legendStreams(withProj)`. A chart PRIMITIVE. */
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

/** $X / $X.YM / $X.YK abbreviation (abbr in the source). */
export function abbr(n: number): string {
  return n >= 1e6
    ? "$" + (n / 1e6).toFixed(2) + "M"
    : n >= 1e3
      ? "$" + (n / 1e3).toFixed(1) + "K"
      : "$" + n.toFixed(0);
}

interface Pad {
  l: number;
  r: number;
  t: number;
  b: number;
}

/** gridlines + axis labels (axisY). */
function axisY(max: number, W: number, H: number, pad: Pad): ReactNode[] {
  const lines = 4;
  const g: ReactNode[] = [];
  for (let i = 0; i <= lines; i++) {
    const y = pad.t + (H - pad.t - pad.b) * (i / lines);
    const val = max * (1 - i / lines);
    g.push(
      <line
        key={`g${i}`}
        x1={pad.l}
        y1={Number(y.toFixed(1))}
        x2={W - pad.r}
        y2={Number(y.toFixed(1))}
        stroke="var(--border)"
        strokeOpacity=".5"
        strokeWidth="1"
      />,
    );
    g.push(
      <text
        key={`gt${i}`}
        x={pad.l - 7}
        y={Number((y + 3).toFixed(1))}
        textAnchor="end"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        {abbr(val)}
      </text>,
    );
  }
  return g;
}

interface ChartOpts {
  W?: number;
  H?: number;
  colors?: Record<string, string>;
}

type BarDatum = { x: string } & Record<string, number | string>;

/** stacked bar chart (stackedBars). */
export function StackedBars({
  data,
  keys,
  max,
  opts = {},
}: {
  data: BarDatum[];
  keys: string[];
  max: number;
  opts?: ChartOpts;
}) {
  const W = opts.W || 560;
  const H = opts.H || 220;
  const pad: Pad = { l: 42, r: 14, t: 12, b: 24 };
  const n = data.length;
  const bw = ((W - pad.l - pad.r) / n) * 0.62;
  const gap = (W - pad.l - pad.r) / n;
  const els: ReactNode[] = [...axisY(max, W, H, pad)];
  data.forEach((d, i) => {
    const x = pad.l + gap * i + (gap - bw) / 2;
    let yAcc = H - pad.b;
    keys.forEach((k) => {
      const v = (d[k] as number) || 0;
      if (v <= 0) return;
      const h = (v / max) * (H - pad.t - pad.b);
      const col = (opts.colors && opts.colors[k]) || STREAM[k as keyof typeof STREAM] || "var(--muted-foreground)";
      const proj = k === "mgmt" || k === "srk";
      els.push(
        <rect
          key={`b${i}-${k}`}
          x={Number(x.toFixed(1))}
          y={Number((yAcc - h).toFixed(1))}
          width={Number(bw.toFixed(1))}
          height={Number(h.toFixed(1))}
          fill={col}
          {...(proj ? { fillOpacity: ".35", stroke: col, strokeDasharray: "3 2" } : {})}
          rx="1.5"
        />,
      );
      yAcc -= h;
    });
    els.push(
      <text
        key={`bl${i}`}
        x={Number((x + bw / 2).toFixed(1))}
        y={H - 9}
        textAnchor="middle"
        fontSize="9"
        fill="var(--muted-foreground)"
      >
        {d.x}
      </text>,
    );
  });
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {els}
    </svg>
  );
}

/** realized-solid + forecast-dashed line chart (trajectory). */
export function Trajectory({
  real,
  fore,
  max,
  opts = {},
}: {
  real: number[];
  fore: number[];
  max: number;
  opts?: ChartOpts;
}) {
  const W = opts.W || 560;
  const H = opts.H || 220;
  const pad: Pad = { l: 42, r: 14, t: 12, b: 24 };
  const all = real.concat(fore.slice(1));
  const todayX = pad.l + (W - pad.l - pad.r) * ((real.length - 1) / (all.length - 1));
  const realPts = real.map((v, i) => [
    pad.l + (W - pad.l - pad.r) * (i / (all.length - 1)),
    pad.t + (H - pad.t - pad.b) * (1 - v / max),
  ]);
  const forePts = fore.map((v, i) => [
    pad.l + (W - pad.l - pad.r) * ((real.length - 1 + i) / (all.length - 1)),
    pad.t + (H - pad.t - pad.b) * (1 - v / max),
  ]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {axisY(max, W, H, pad)}
      <line
        x1={Number(todayX.toFixed(1))}
        y1={pad.t}
        x2={Number(todayX.toFixed(1))}
        y2={H - pad.b}
        stroke="var(--muted-foreground)"
        strokeDasharray="2 3"
        strokeOpacity=".6"
      />
      <text x={Number(todayX.toFixed(1))} y={pad.t - 2} textAnchor="middle" fontSize="9" fill="var(--muted-foreground)">
        today
      </text>
      <path
        d={realPts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")}
        fill="none"
        stroke={STREAM.swap}
        strokeWidth="2.4"
      />
      <path
        d={forePts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")}
        fill="none"
        stroke={STREAM.swap}
        strokeWidth="2.4"
        strokeDasharray="5 4"
        strokeOpacity=".7"
      />
      <circle
        cx={Number(realPts[realPts.length - 1][0].toFixed(1))}
        cy={Number(realPts[realPts.length - 1][1].toFixed(1))}
        r="3.5"
        fill={STREAM.swap}
      />
    </svg>
  );
}

/** dual-area chart (dualArea). hideRev mirrors the cumulative variant. */
export function DualArea({
  yieldV,
  revV,
  max,
  opts = {},
  hideRev = false,
}: {
  yieldV: number[];
  revV: number[];
  max: number;
  opts?: ChartOpts;
  hideRev?: boolean;
}) {
  const W = opts.W || 560;
  const H = opts.H || 200;
  const pad: Pad = { l: 42, r: 14, t: 12, b: 24 };
  function area(vals: number[], color: string, op: string, idx: number) {
    const pts = vals.map((v, i) => [
      pad.l + (W - pad.l - pad.r) * (i / (vals.length - 1)),
      pad.t + (H - pad.t - pad.b) * (1 - v / max),
    ]);
    const line = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    return (
      <g key={`area${idx}`}>
        <path
          d={`${line} L${(W - pad.r).toFixed(1)} ${H - pad.b} L${pad.l} ${H - pad.b} Z`}
          fill={color}
          fillOpacity={op}
        />
        <path d={line} fill="none" stroke={color} strokeWidth="2" />
      </g>
    );
  }
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {axisY(max, W, H, pad)}
      {area(yieldV, STREAM.premium, ".16", 0)}
      {!hideRev && area(revV, "var(--muted-foreground)", ".12", 1)}
    </svg>
  );
}

/** diverging deposit/withdrawal bars + cumulative net line (divergeBars). */
export function DivergeBars({ dep, wd, opts = {} }: { dep: number[]; wd: number[]; opts?: ChartOpts }) {
  const W = opts.W || 560;
  const H = opts.H || 220;
  const pad: Pad = { l: 42, r: 14, t: 12, b: 28 };
  const max = Math.max(...dep, ...wd.map(Math.abs)) * 1.1;
  const mid = pad.t + (H - pad.t - pad.b) / 2;
  const n = dep.length;
  const gap = (W - pad.l - pad.r) / n;
  const bw = gap * 0.5;
  const els: ReactNode[] = [
    <line key="mid" x1={pad.l} y1={mid} x2={W - pad.r} y2={mid} stroke="var(--border)" />,
  ];
  let net = 0;
  const netPts: number[][] = [];
  for (let i = 0; i < n; i++) {
    const x = pad.l + gap * i + (gap - bw) / 2;
    const dh = (dep[i] / max) * (H - pad.t - pad.b) / 2;
    const wh = (Math.abs(wd[i]) / max) * (H - pad.t - pad.b) / 2;
    els.push(
      <rect
        key={`d${i}`}
        x={Number(x.toFixed(1))}
        y={Number((mid - dh).toFixed(1))}
        width={Number(bw.toFixed(1))}
        height={Number(dh.toFixed(1))}
        fill="var(--gain)"
        rx="1"
      />,
    );
    els.push(
      <rect
        key={`w${i}`}
        x={Number(x.toFixed(1))}
        y={Number(mid.toFixed(1))}
        width={Number(bw.toFixed(1))}
        height={Number(wh.toFixed(1))}
        fill="var(--loss)"
        rx="1"
      />,
    );
    net += dep[i] + wd[i];
    netPts.push([x + bw / 2, net]);
  }
  const nmax = Math.max(...netPts.map((p) => Math.abs(p[1]))) * 1.2 || 1;
  const npath = netPts
    .map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + (mid - (p[1] / nmax) * (H - pad.t - pad.b) / 2).toFixed(1))
    .join(" ");
  els.push(<path key="net" d={npath} fill="none" stroke={STREAM.swap} strokeWidth="2" />);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {els}
    </svg>
  );
}

/** area + secondary line on a separate scale (composed).
 *  lineColor overrides the line stroke (source uses string replaces for this). */
export function Composed({
  areaV,
  lineV,
  amax,
  lmax,
  opts = {},
  lineColor = STREAM.srk,
}: {
  areaV: number[];
  lineV: number[];
  amax: number;
  lmax: number;
  opts?: ChartOpts;
  lineColor?: string;
}) {
  const W = opts.W || 560;
  const H = opts.H || 220;
  const pad: Pad = { l: 42, r: 38, t: 12, b: 24 };
  const apts = areaV.map((v, i) => [
    pad.l + (W - pad.l - pad.r) * (i / (areaV.length - 1)),
    pad.t + (H - pad.t - pad.b) * (1 - v / amax),
  ]);
  const aline = apts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const lpts = lineV.map((v, i) => [
    pad.l + (W - pad.l - pad.r) * (i / (lineV.length - 1)),
    pad.t + (H - pad.t - pad.b) * (1 - v / lmax),
  ]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      {axisY(amax, W, H, pad)}
      <path d={`${aline} L${(W - pad.r).toFixed(1)} ${H - pad.b} L${pad.l} ${H - pad.b} Z`} fill={STREAM.swap} fillOpacity=".12" />
      <path d={aline} fill="none" stroke={STREAM.swap} strokeWidth="2" />
      <path
        d={lpts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ")}
        fill="none"
        stroke={lineColor}
        strokeWidth="2.2"
        strokeDasharray="0"
      />
    </svg>
  );
}

/** small sparkline (sparkline). */
export function Sparkline({ vals, color, W = 120, H = 34 }: { vals: number[]; color: string; W?: number; H?: number }) {
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const r = max - min || 1;
  const p = vals.map((v, i) => [(i / (vals.length - 1)) * W, H - ((v - min) / r) * (H - 4) - 2]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
      <path
        d={p.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ")}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
      />
    </svg>
  );
}
