"use client";

/**
 * /premium — the Premium AI tier, unlocked by an activated Sparky Broker (043). The free tier is
 * fully capable and never gated; the vault, deposits, yield, swaps, and withdraw-always
 * are always free. A free-vs-premium matrix and SRK-priced upgrade.
 *
 * Faithful 1:1 port of the design's `premium` screen
 * (docs/design-handover/showcase/screens/premium.js). Markup, classes, and copy verbatim.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSelfPremiumStatus } from "@/lib/premium/useSelfPremiumStatus";
import { premiumSourceView, SUBSCRIPTIONS_RETIRED } from "@/lib/chain/brokers";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/premium.css";

const FEATURES: [string, string, string][] = [
  ["AI chat assistant", "Full", "Full"],
  ["Portfolio & read access", "Full", "Full"],
  ["Aave Yield Vault — deposit / yield / withdraw", "Full", "Full"],
  ["Swaps & withdraw-always", "Full", "Full"],
  ["Strategy analysis", "Basic", "Deeper & more frequent"],
  ["Advanced strategy vaults (when live)", "—", "Included"],
  ["Limits & priority compute", "Standard", "Higher"],
  ["Advanced analytics & alerts", "—", "Included"],
  ["Scoped auto-rebalance", "—", "Higher caps"],
];

interface SelfUsageMetric {
  metric: string;
  used: number;
  limit: number;
  remaining: number;
}
interface SelfUsage {
  configured: boolean;
  tier?: string;
  resetAt?: string;
  metrics?: SelfUsageMetric[];
}

const METRIC_LABEL: Record<string, string> = {
  chat: "AI chat turns",
  recs: "Strategy recommendations",
};

/**
 * "Your usage this period" — a calm, informational read of the signed-in wallet's own allowance
 * (feature 008, US6), from the self-scoped `/usage/self`. Never nags: it only shows what's used,
 * renders nothing until real data is available, and never blocks anything.
 */
function UsageThisPeriod() {
  const [usage, setUsage] = useState<SelfUsage | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const r = await fetch("/api/agent/usage/self", {
          headers: { "x-chain-id": "84532" },
          cache: "no-store",
        });
        if (r.ok && alive) setUsage((await r.json()) as SelfUsage);
      } catch {
        /* advisory only — never surface an error here */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const shown = (usage?.metrics ?? []).filter((m) => m.metric in METRIC_LABEL);
  if (!usage?.configured || shown.length === 0) return null;

  return (
    <div className="card card-pad">
      <div className="card-hd">
        <span className="t">Your usage this period</span>
        <span className="lbl">
          {usage.tier} tier
          {usage.resetAt ? ` · resets ${new Date(usage.resetAt).toLocaleDateString()}` : ""}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 10 }}>
        {shown.map((m) => {
          const pct = m.limit > 0 ? Math.min(100, Math.round((m.used / m.limit) * 100)) : 0;
          return (
            <div key={m.metric}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  marginBottom: 4,
                }}
              >
                <span>{METRIC_LABEL[m.metric]}</span>
                <span className="tnum" style={{ color: "var(--muted-foreground)" }}>
                  {m.used} / {m.limit}
                </span>
              </div>
              <div style={{ height: 8, borderRadius: 6, background: "var(--border-soft)" }}>
                <div
                  style={{
                    width: `${pct}%`,
                    height: "100%",
                    borderRadius: 6,
                    background: pct >= 100 ? "var(--caution)" : "var(--primary)",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Page() {
  const router = useRouter();
  const premium = useSelfPremiumStatus();
  const sourceView = premiumSourceView(premium.source ?? null, premium.brokerTokenId);
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Premium</h1>
          <div className="sub">Optional advanced AI, paid in SRK. The free tier is fully capable.</div>
        </div>
      </div>
      <div className="pm-banner">
        <Icon name="info" size={16} />
        <span>
          <b>Premium is optional.</b> Everything that matters — the chat assistant, the vault, deposits, yield, swaps,
          and withdraw-always — is free and <b>never requires SRK</b>. Premium only adds advanced capability.
        </span>
      </div>

      <div className="plan-cards">
        <div className="plan">
          <div className="pn">Free</div>
          <div className="pp">$0</div>
          <div className="psub">Fully capable — forever</div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Chat, portfolio, the Aave vault, swaps, withdraw-always.
          </div>
          <button className="btn btn-outline btn-md" style={{ width: "100%", marginTop: 16 }} disabled>
            {premium.active ? "Always included" : "Your current plan"}
          </button>
        </div>
        <div className="plan prem">
          <div className="pn" style={{ color: "var(--primary)" }}>
            Premium
          </div>
          <div className="pp tnum">
            SRK, once
            <span style={{ fontSize: 14, color: "var(--muted-foreground)", fontWeight: 500 }}>
              {" "}
              · no expiry
            </span>
          </div>
          {/* 043 — deliberately NO number here. Premium is not sold by the month any more, and the
              activation price is owner-settable on-chain: a figure baked into this card is a second
              place for it to go stale. The real amount is read LIVE from the registry at the moment
              of signing, on the activation screen. No USD figure either — there is no SRK oracle. */}
          <div className="psub">Unlocked by an activated Sparky Broker · nothing to renew</div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Deeper analysis, advanced vaults, higher limits, analytics &amp; alerts.
          </div>
          {premium.active ? (
            <>
              <button className="btn btn-primary btn-md" style={{ width: "100%", marginTop: 16 }} disabled>
                {sourceView.headline}
                {sourceView.showsExpiry && premium.untilLabel ? ` — until ${premium.untilLabel}` : ""}
              </button>
              {/* 043 — say WHICH source is paying and what would end it. The failure this prevents
                  is a holder whose access stops and who cannot tell why. A broker-sourced tier has
                  no expiry: it ends on transfer, so no date is shown rather than a made-up one. */}
              <div
                style={{ marginTop: 8, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}
              >
                {sourceView.detail} {sourceView.endsWhen}
              </div>
              {premium.source === "broker" || SUBSCRIPTIONS_RETIRED ? (
                <button
                  className="btn btn-outline btn-md"
                  style={{ width: "100%", marginTop: 8 }}
                  onClick={() => router.push("/brokers")}
                >
                  Your brokers
                </button>
              ) : (
                <button
                  className="btn btn-outline btn-md"
                  style={{ width: "100%", marginTop: 8 }}
                  onClick={() => router.push(toHref("premium/pay"))}
                >
                  Extend a month — pay in SRK
                </button>
              )}
            </>
          ) : (
            <>
              <button
                className="btn btn-primary btn-md"
                style={{ width: "100%", marginTop: 16 }}
                onClick={() => router.push("/brokers")}
              >
                Activate a Sparky Broker
              </button>
              <div
                style={{ marginTop: 8, fontSize: 12, color: "var(--muted-foreground)", lineHeight: 1.5 }}
              >
                You retire SRK once and the broker carries Premium for as long as you hold it. Nothing
                renews, nothing expires, and you can sell the broker. The old monthly SRK subscription
                it replaces has been retired.
              </div>
            </>
          )}
        </div>
      </div>

      <UsageThisPeriod />

      <div className="card card-pad">
        <div className="card-hd">
          <span className="t">Free vs Premium</span>
          <span className="lbl">free tier never gated</span>
        </div>
        <table className="matrix">
          <thead>
            <tr>
              <th>Feature</th>
              <th className="col">Free</th>
              <th className="col" style={{ color: "var(--primary)" }}>
                Premium
              </th>
            </tr>
          </thead>
          <tbody>
            {FEATURES.map((f) => (
              <tr key={f[0]}>
                <td className="feat">{f[0]}</td>
                <td className={"col " + (f[1] === "—" ? "no" : "ok")}>
                  {f[1] === "—" ? <Icon name="x" size={14} /> : f[1]}
                </td>
                <td className={"col " + (f[2] === "—" ? "no" : "ok")}>{f[2]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 14, textAlign: "center" }}>
        SRK is a non-essential utility token.{" "}
        <a style={{ color: "var(--primary)", cursor: "pointer" }} onClick={() => router.push(toHref("fees"))}>
          How we make money →
        </a>
      </div>
    </div>
  );
}
