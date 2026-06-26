"use client";

/**
 * /fees — Fee Transparency & Revenue Surfaces (Flow 11): "we only earn when you earn".
 * 0% on principal/deposits/withdrawals; the active 10% performance fee over a high-water
 * mark; the one swap routing fee; optional SRK-paid Premium; an honesty chart; and a
 * verify-don't-trust panel reading the on-chain fee params.
 *
 * Faithful 1:1 port of the design's `fees` screen
 * (docs/design-handover/showcase/screens/fees.js). Markup, classes, and copy verbatim.
 */

import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import "@/components/screens/fees.css";

/** Yield-vs-revenue bars (mirrors the design's `honestyBars`). */
function HonestyBars() {
  const months = ["Feb", "Mar", "Apr", "May", "Jun"];
  const yld = [40, 72, 95, 120, 150];
  const rev = [0, 1.2, 0.6, 1.4, 0.4];
  return (
    <>
      {months.map((m, i) => (
        <div className="hbar" key={m}>
          <div className="rev" style={{ height: rev[i] * 4 }} />
          <div className="yield" style={{ height: yld[i] * 0.7 }} />
          <span className="hx">{m}</span>
        </div>
      ))}
    </>
  );
}

export default function Page() {
  const router = useRouter();
  return (
    <div className="page page-wide">
      <div className="pagehead">
        <div>
          <h1>Fees &amp; how we make money</h1>
          <div className="fees-lede">
            We only earn when you earn — never on your principal, never by taking custody. Here&apos;s exactly what we
            charge, when, and why.
          </div>
        </div>
      </div>

      <div className="card principle">
        <div className="pr">
          <Icon name="check" size={16} /> 0 fees on your principal
        </div>
        <div className="pr">
          <Icon name="check" size={16} /> We only earn a % of the profit you make
        </div>
        <div className="pr">
          <Icon name="check" size={16} /> You see every fee before you sign
        </div>
        <div className="pr">
          <Icon name="check" size={16} /> We never hold your funds
        </div>
      </div>

      <div className="fees-grid">
        <div className="card card-pad fcard">
          <h3>
            <Icon name="check" size={17} /> What&apos;s free
          </h3>
          <ul>
            <li>
              <Icon name="check" size={14} />
              <span>
                <b>The Aave Yield Vault</b> — deposit, earn, and withdraw with{" "}
                <b>0% on your deposits, principal &amp; withdrawals</b>.
              </span>
            </li>
            <li>
              <Icon name="check" size={14} />
              The chat assistant (free tier), your portfolio, and withdraw-always.
            </li>
            <li>
              <Icon name="check" size={14} />
              You never need SRK for any of this.
            </li>
          </ul>
        </div>
        <div className="card card-pad fcard">
          <h3>
            <Icon name="activity" size={17} /> The one fee today
          </h3>
          <ul>
            <li>
              <span className="feetag" style={{ background: "var(--spark-subtle)", color: "var(--primary)" }}>
                Swap routing fee · 0.20%
              </span>
            </li>
            <li className="muted-li">Set within a published 0.15–0.30% band.</li>
            <li>
              <Icon name="check" size={14} />
              Only when <b>you</b> execute a swap.
            </li>
            <li>
              <Icon name="check" size={14} />
              Taken inside your own signed swap — never on the vault or deposits.
            </li>
          </ul>
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button className="btn btn-outline btn-sm" onClick={() => router.push(toHref("confirm/swap"))}>
              See an example
            </button>
            <button className="btn btn-ghost btn-sm">Verify recipient ↗</button>
          </div>
        </div>
        <div className="card card-pad fcard">
          <h3>
            <Icon name="coins" size={17} /> Optional: Premium
          </h3>
          <ul>
            <li>
              Advanced AI features, <b>paid in SRK</b> — a subscription payment, not a vault fee.
            </li>
            <li className="muted-li">
              The free tier stays fully usable. Premium never gates the vault, deposits, yield, or withdrawals.
            </li>
          </ul>
          <div style={{ marginTop: 14 }}>
            <button className="btn btn-outline btn-sm" onClick={() => router.push(toHref("premium"))}>
              Compare free vs premium →
            </button>
          </div>
        </div>
        <div className="card card-pad fcard">
          <h3>
            <Icon name="coins" size={17} /> Performance fee · vault{" "}
            <span className="feetag" style={{ background: "var(--spark-subtle)", color: "var(--primary)" }}>
              Active · v1
            </span>
          </h3>
          <ul>
            <li>
              <span className="feetag" style={{ background: "var(--spark-subtle)", color: "var(--primary)" }}>
                10% of profit · over high-water mark
              </span>
            </li>
            <li>
              <Icon name="check" size={14} />
              Charged <b>only on new profit</b> above your high-water mark — never on your principal or your deposits.
            </li>
            <li>
              <Icon name="check" size={14} />
              If your balance dips and recovers, you pay <b>nothing</b> until you’re back above your previous high.
            </li>
            <li className="muted-li">
              This is the “we only earn when you earn” fee — accrued transparently, shown in every net-APY breakdown.
            </li>
          </ul>
        </div>
      </div>

      <div className="card honesty">
        <div className="card-hd">
          <span className="t">We only earn when you earn</span>
          <span className="lbl">your yield vs our revenue · last 5 months</span>
        </div>
        <div style={{ display: "flex", gap: 18, fontSize: 12, color: "var(--muted-foreground)", marginTop: 4 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--brand-cyan)" }} />
            Yield earned for you
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--muted-foreground)", opacity: 0.5 }} />
            Fees you paid us
          </span>
        </div>
        <div className="hbars">
          <HonestyBars />
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)", marginTop: 10 }}>
          Historical, net-of-everything — no projections. You&apos;ve paid{" "}
          <b style={{ color: "var(--foreground)" }}>$0.00</b> in fees so far (vault-only).
        </div>
      </div>

      <div className="card verify">
        <div className="card-hd" style={{ marginBottom: 4 }}>
          <span className="t">Verify — don&apos;t take our word for it</span>
        </div>
        <div className="vrow">
          <span>Vault deposit/withdraw fee</span>
          <span className="mono">
            read: feeBps = 0 <Icon name="ext" size={11} />
          </span>
        </div>
        <div className="vrow">
          <span>Vault performance fee</span>
          <span className="mono">
            read: perfFeeBps = 1000 (10%) <Icon name="ext" size={11} />
          </span>
        </div>
        <div className="vrow">
          <span>Swap fee-recipient</span>
          <span className="mono">
            0x7c…F12 <Icon name="ext" size={11} />
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--muted-foreground)" }}>
          These fees live in the contracts, not this app.{" "}
          <a
            style={{ color: "var(--primary)", cursor: "pointer" }}
            onClick={() => router.push(toHref("trust/permissions"))}
          >
            See permissions →
          </a>
        </div>
      </div>
    </div>
  );
}
