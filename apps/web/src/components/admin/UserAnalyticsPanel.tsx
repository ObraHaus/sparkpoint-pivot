"use client";

/**
 * 035 — the original /admin/users screen, moved into a component so it can be one SECTION of a console.
 *
 * Unchanged apart from the export: same markup, same calls, same behaviour. The screen an
 * admin knows did not move, the door to it did.
 */


/**
 * Admin → User analytics (scUsers) — REAL cohort metrics from `GET /admin/users/analytics` (was 100%
 * sample data). Total users, the onboarding funnel, activation, DAU/MAU, the risk-tier mix, and a
 * pseudonymized top-depositors leaderboard are all computed live from the app's own tables. Wallets
 * are pseudonymized (`user_<4hex>`) — never a full address. Honest-degrade: if the data source isn't
 * available the page says so rather than fabricating numbers. Observe-only — no fund-action column.
 */

import { useCallback, useEffect, useState } from "react";
import { Kpi } from "@/components/admin/charts";
import { Funnel, RiskDist, type FunnelStep, type RiskTier } from "@/components/admin/funnels";

interface TopUser {
  ref: string;
  netDepositedUsdc: number;
  recsAccepted: number;
}
interface Analytics {
  configured: boolean;
  totalUsers: number;
  funnel: FunnelStep[];
  activation: { deposited: number; pct: number };
  onboardingCompletionPct: number;
  activity: { dau: number; mau: number; stickinessPct: number };
  premiumActive: number;
  riskTiers: RiskTier[];
  topUsers: TopUser[];
}

const CHAIN_HEADERS = { "x-chain-id": "84532" };
const usd = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

export function UserAnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/agent/admin/users/analytics", { headers: CHAIN_HEADERS, cache: "no-store" });
      if (!r.ok) throw new Error(String(r.status));
      setData((await r.json()) as Analytics);
      setState("ok");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const configured = state === "ok" && data?.configured === true;
  const pill =
    state === "loading"
      ? { cls: "info", text: "Loading…" }
      : configured
        ? { cls: "ok", text: "Live · from the database" }
        : { cls: "amber", text: state === "error" ? "Source unavailable" : "Not yet instrumented" };

  return (
    <>
      <div className="pghead">
        <div>
          <h1>User analytics</h1>
          <div className="sub">Pseudonymized by default. Full reveal is step-up + audited.</div>
        </div>
        <span className={`pill ${pill.cls}`}>
          <span className="led" /> {pill.text}
        </span>
      </div>

      {!configured ? (
        <div className="panel">
          <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            {state === "loading"
              ? "Loading cohort analytics…"
              : "Cohort analytics aren't available right now (the data source didn't respond). No numbers are shown rather than fabricated ones."}
          </div>
        </div>
      ) : (
        <>
          <div className="band">
            <Kpi label="Total users" val={data!.totalUsers.toLocaleString()} />
            <Kpi label="DAU / MAU stickiness" val={`${data!.activity.stickinessPct}%`} />
            <Kpi label="Onboarding completion" val={`${data!.onboardingCompletionPct}%`} />
            <Kpi label="Activation (deposited)" val={`${data!.activation.pct}%`} />
          </div>
          <div className="grid2">
            <div className="chartcard">
              <div className="ch">
                <span className="ct">Onboarding funnel</span>
                <span className="prov">live · onboarding_state</span>
              </div>
              <Funnel steps={data!.funnel} />
            </div>
            <div className="chartcard">
              <div className="ch">
                <span className="ct">Risk-tier distribution</span>
                <span className="prov">live · mandates</span>
              </div>
              <RiskDist tiers={data!.riskTiers} />
            </div>
          </div>
          <div className="panel">
            <div className="ch" style={{ marginBottom: 10 }}>
              <span className="ct">Top users by net deposited</span>
              <span className="prov">pseudonymized · {data!.premiumActive} premium active</span>
            </div>
            {data!.topUsers.length === 0 ? (
              <div className="muted" style={{ fontSize: 13, padding: "10px 2px" }}>
                No depositors yet.
              </div>
            ) : (
              <table className="adtbl">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>User ref</th>
                    <th className="num">Net deposited</th>
                    <th className="num">Recs accepted</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.topUsers.map((u, i) => (
                    <tr key={u.ref}>
                      <td>{i + 1}</td>
                      <td className="mono">{u.ref}</td>
                      <td className="num">{usd(u.netDepositedUsdc)}</td>
                      <td className="num">{u.recsAccepted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}
