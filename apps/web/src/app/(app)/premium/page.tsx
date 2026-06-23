"use client";

/**
 * /premium — Subscriptions & Premium AI tier (Flow 10), paid in SRK. The free tier is
 * fully capable and never gated; the vault, deposits, yield, swaps, and withdraw-always
 * are always free. A free-vs-premium matrix and SRK-priced upgrade.
 *
 * Faithful 1:1 port of the design's `premium` screen
 * (docs/design-handover/showcase/screens/premium.js). Markup, classes, and copy verbatim.
 */

import { useRouter } from "next/navigation";
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

export default function Page() {
  const router = useRouter();
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
            Your current plan
          </button>
        </div>
        <div className="plan prem">
          <div className="pn" style={{ color: "var(--primary)" }}>
            Premium
          </div>
          <div className="pp tnum">
            500 SRK<span style={{ fontSize: 14, color: "var(--muted-foreground)", fontWeight: 500 }}> /mo</span>
          </div>
          <div className="psub">≈ $12.00 / month · cancel anytime</div>
          <div style={{ marginTop: 14, fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
            Deeper analysis, advanced vaults, higher limits, analytics &amp; alerts.
          </div>
          <button
            className="btn btn-primary btn-md"
            style={{ width: "100%", marginTop: 16 }}
            onClick={() => router.push(toHref("premium/pay"))}
          >
            Upgrade — pay in SRK
          </button>
        </div>
      </div>

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
