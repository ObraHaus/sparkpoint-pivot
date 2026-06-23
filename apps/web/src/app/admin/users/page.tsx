"use client";

/**
 * Admin → User analytics (scUsers). "Pseudonymized by default. Full reveal is
 * step-up + audited." Faithful 1:1 port of the Users screen in
 * SparkPoint Admin.html. No fund-action column — observe-only.
 */

import { STREAM } from "@/components/admin/charts";
import { data, Kpi } from "@/components/admin/data";
import { Funnel, RiskDist } from "@/components/admin/funnels";

const TOP: [string, string, string, string, string, string][] = [
  ["1", "user_8f2a", "$340K", "12", "2h ago", "9"],
  ["2", "user_3b71", "$210K", "8", "5h ago", "6"],
  ["3", "user_d94c", "$155K", "5", "1d ago", "4"],
  ["4", "user_1e08", "$98K", "11", "3h ago", "7"],
];

export default function Page() {
  return (
    <>
      <div className="pghead">
        <div>
          <h1>User analytics</h1>
          <div className="sub">Pseudonymized by default. Full reveal is step-up + audited.</div>
        </div>
      </div>
      <div className="band">
        <Kpi label="Total users" val="3,240" spark={data.usersSpark} sparkColor={STREAM.premium} delta="▲ 22%" deltaCls="up" />
        <Kpi label="DAU / MAU stickiness" val="38%" spark={[30, 32, 34, 35, 37, 38]} sparkColor={STREAM.swap} delta="▲ healthy" deltaCls="up" />
        <Kpi label="Onboarding completion" val="71%" spark={[60, 63, 66, 68, 70, 71]} sparkColor={STREAM.srk} delta="▲" deltaCls="up" />
        <Kpi label="Activation (deposited)" val="44%" spark={[36, 38, 40, 42, 43, 44]} sparkColor={STREAM.premium} delta="▲" deltaCls="up" />
      </div>
      <div className="grid2">
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Onboarding funnel</span>
            <span className="prov">computed</span>
          </div>
          <Funnel />
        </div>
        <div className="chartcard">
          <div className="ch">
            <span className="ct">Risk-tier distribution</span>
            <span className="prov">mandates</span>
          </div>
          <RiskDist />
        </div>
      </div>
      <div className="panel">
        <div className="ch" style={{ marginBottom: 10 }}>
          <span className="ct">Top users by TVL</span>
          <span className="prov">pseudonymized · reveal = step-up</span>
        </div>
        <table className="adtbl">
          <thead>
            <tr>
              <th>#</th>
              <th>User ref</th>
              <th className="num">TVL</th>
              <th className="num">Deposits</th>
              <th>Last active</th>
              <th className="num">Recs accepted</th>
            </tr>
          </thead>
          <tbody>
            {TOP.map((r) => (
              <tr key={r[1]}>
                <td>{r[0]}</td>
                <td className="mono">{r[1]}</td>
                <td className="num">{r[2]}</td>
                <td className="num">{r[3]}</td>
                <td>{r[4]}</td>
                <td className="num">{r[5]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
