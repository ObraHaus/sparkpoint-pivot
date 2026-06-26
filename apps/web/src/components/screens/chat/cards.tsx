"use client";

/**
 * Chat assistant cards — the structured cards rendered inside the assistant thread.
 * Faithful port of the card builders in docs/design-handover/showcase/screens/chat.js
 * (recCard / snapshotCard / tipCard / outcomeCard / walletCard / swapCard / bridgeCard).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { data, TIER } from "@/lib/mock-data";
import { money } from "@/lib/utils";
import { toHref } from "@/lib/nav";
import { RiskChip } from "@/components/ui/risk-chip";

/** Card action callbacks — the chat screen wires these to its thread state. */
export interface CardActions {
  /** open the inline confirm flow for the given intent. */
  review: (kind: "deposit" | "swap" | "bridge") => void;
  /** "Not now" / dismiss this card. */
  dismiss: () => void;
  /** send a follow-up message (chip / data-chip buttons). */
  send: (text: string) => void;
  /** open the citation source sheet (data-cite). */
  cite: () => void;
}

function useGo() {
  const router = useRouter();
  return (route: string) => router.push(toHref(route));
}

/** Recommendation card (recCard). */
export function RecCard({ actions }: { actions: CardActions }) {
  const [open, setOpen] = useState(false);
  const [fb, setFb] = useState<"up" | "down" | null>(null);
  const [dismissed, setDismissed] = useState(false);
  return (
    <div className="ccard" data-card="rec" style={dismissed ? { opacity: 0.5 } : undefined}>
      <div className="ch">
        <span className="rank">Best fit · #1 vs your goal</span>
        <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
      </div>
      <div className="cthesis">
        Aave&apos;s USDC rate is <b>4.3%</b>. After our <b>10% performance fee on yield</b> that&apos;s{" "}
        <b>3.87% net APY</b> — moving your idle <span className="tnum">2,150 USDC</span> in could earn more, at the same
        low risk.
      </div>
      <div className="crow">
        <div className="capy">
          <div className="big tnum">
            3.87%{" "}
            <span className="cite" onClick={actions.cite} style={{ cursor: "pointer" }}>
              <Icon name="check" size={10} /> Based on Aave · 2m
            </span>
          </div>
          <div className="lbl">net APY · 4.3% Aave − 10% perf fee on yield</div>
        </div>
        <RiskChip tier={1} />
      </div>
      <div className="cnote">Fits your plan: lower risk, steady yield. · Estimates, not guarantees.</div>
      <div className="cact">
        <button className="btn btn-primary btn-md" onClick={() => actions.review("deposit")}>
          Review this move
        </button>
        <button
          className="btn btn-ghost btn-md"
          onClick={() => {
            setDismissed(true);
            actions.dismiss();
          }}
        >
          Not now
        </button>
      </div>
      <div className="whyrow">
        <button className="whytrig" onClick={() => setOpen((v) => !v)}>
          <Icon name="info" size={14} /> Why this?
        </button>
        <div className={"whybd" + (open ? " open" : "")}>
          Your mandate is lower-risk, capital-preservation-first. This keeps 100% in the audited Aave vault (Risk 1),
          satisfies your beta cap and slippage guardrails, and raises yield without changing your risk tier. The
          tradeoff: yield floats with the Aave rate.
        </div>
      </div>
      <div className="feedback">
        <button className={"fbtn" + (fb === "up" ? " on" : "")} onClick={() => setFb("up")}>
          <Icon name="up" size={15} />
        </button>
        <button className={"fbtn" + (fb === "down" ? " on" : "")} onClick={() => setFb("down")}>
          <Icon name="down" size={15} />
        </button>
      </div>
    </div>
  );
}

/** Portfolio snapshot card (snapshotCard). */
export function SnapshotCard({ actions }: { actions: CardActions }) {
  const go = useGo();
  const a = data.allocation;
  return (
    <div className="ccard" data-card="snap">
      <div className="ch">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Your portfolio</span>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }} className="grow">
          as of 2m ago
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 14, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 600 }} className="tnum">
            {money(data.netWorth)}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>net worth</div>
        </div>
        <div className="delta up" style={{ marginBottom: 3 }}>
          <Icon name="up" size={14} />+{money(data.pnl.abs)} (+{data.pnl.pct}%, {data.pnl.window})
        </div>
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {a.map((x) => (
          <div
            key={x.k}
            style={{
              height: 8,
              borderRadius: 4,
              background: `var(${x.risk === 0 ? "--muted-foreground" : TIER[x.risk].v})`,
              flex: x.v,
            }}
            title={x.k}
          />
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted-foreground)", marginBottom: 13 }}>
        <span>Aave vault {money(data.allocation[0].v)}</span>
        <span>Idle {money(data.allocation[1].v)}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
        <RiskChip tier={1} />
        <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>On plan — steady, capital-preservation-first.</span>
      </div>
      <div className="cact">
        <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
          Open portfolio
        </button>
        <button className="btn btn-ghost btn-md" onClick={() => actions.send("Find steady, lower-risk yield")}>
          Improve my yield
        </button>
      </div>
    </div>
  );
}

/** Tip / explainer card (tipCard). */
export function TipCard() {
  const go = useGo();
  return (
    <div
      className="ccard"
      data-card="tip"
      style={{ background: "var(--info-subtle)", borderColor: "color-mix(in srgb,var(--info) 22%,transparent)" }}
    >
      <div className="ch">
        <span style={{ color: "var(--info)", display: "flex" }}>
          <Icon name="info" size={16} />
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>What&apos;s net APY?</span>
      </div>
      <div style={{ fontSize: 13.5, lineHeight: 1.55, color: "var(--muted-foreground)", marginBottom: 12 }}>
        Your estimated yearly return after all costs, if the current rate held and earnings compounded. Rates change —
        it&apos;s an estimate, not a promise.
      </div>
      <div className="cact">
        <button className="btn btn-ghost btn-md" onClick={() => go("learn")}>
          How this works
        </button>
      </div>
    </div>
  );
}

/** Outcome card (outcomeCard) — shows a loss as plainly as a win. */
export function OutcomeCard({ actions }: { actions: CardActions }) {
  const go = useGo();
  const o = data.outcomes[1];
  return (
    <div className="ccard" data-card="out">
      <div className="ch">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Outcome</span>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>from {o.from}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span className="delta down" style={{ fontSize: 18 }}>
          <Icon name="down" size={16} />
          {o.pnl} ({o.pct}, {o.win})
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginBottom: 12 }}>
        {o.cause}{" "}
        <a className="cite" style={{ cursor: "pointer" }}>
          View tx <Icon name="ext" size={10} />
        </a>
      </div>
      <div className="cact">
        <button className="btn btn-outline btn-md" onClick={() => go("outcomes")}>
          See the original advice
        </button>
        <button className="btn btn-ghost btn-md" onClick={() => actions.send("What changed?")}>
          What changed?
        </button>
      </div>
    </div>
  );
}

/** Wallet card (walletCard). */
export function WalletCard({ actions }: { actions: CardActions }) {
  const go = useGo();
  const rows: [string, string, string, string, string][] = [
    ["USDC", "2,150.00", "$2,150", "idle · earning nothing", "--caution"],
    ["ETH", "0.42", "$2,100", "+1.8% (24h)", "--gain"],
    ["cbBTC", "0.045", "$4,275", "−0.6% (24h)", "--loss"],
    ["Aave Vault", "9,834.50 spv", "$10,034", "+0.3% accruing", "--gain"],
  ];
  return (
    <div className="ccard" data-card="wallet">
      <div className="ch">
        <span style={{ fontSize: 13, fontWeight: 600 }}>Your wallet · Base</span>
        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }} className="grow">
          total ≈ $18,559
        </span>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]}>
              <td style={{ padding: "7px 0", fontSize: 13, fontWeight: 600 }}>{r[0]}</td>
              <td style={{ padding: "7px 0", fontSize: 12.5, color: "var(--muted-foreground)", textAlign: "right" }} className="tnum">
                {r[1]}
              </td>
              <td style={{ padding: "7px 8px", fontSize: 13, textAlign: "right" }} className="tnum">
                {r[2]}
              </td>
              <td style={{ padding: "7px 0", fontSize: 11.5, textAlign: "right", color: `var(${r[4]})` }}>{r[3]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cact">
        <button className="btn btn-primary btn-md" onClick={() => actions.send("Put my USDC to work")}>
          Put USDC to work
        </button>
        <button className="btn btn-ghost btn-md" onClick={() => go("portfolio")}>
          Open portfolio
        </button>
      </div>
    </div>
  );
}

/** Swap card (swapCard). */
export function SwapCard({ actions }: { actions: CardActions }) {
  return (
    <div className="ccard" data-card="swap">
      <div className="ch">
        <span className="rank">Swap · ETH → USDC</span>
        <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
      </div>
      <div className="cthesis">
        Best swap route on Base: <b>ETH → USDC via Aerodrome</b> (highest liquidity). Slippage protection is built into
        the route.
      </div>
      <div className="crow">
        <div className="capy">
          <div className="big tnum">0.1 ETH</div>
          <div className="lbl">you swap · you hold 0.42 ETH</div>
        </div>
        <div className="capy">
          <div className="big tnum">≈ 312.40</div>
          <div className="lbl">USDC out · max slippage 0.5%</div>
        </div>
      </div>
      <div className="cnote">
        Includes a SparkPoint routing fee of 0.20% (≈ $0.62), shown in full before you sign. USDC you can then deposit
        into the vault.
      </div>
      <div className="cact">
        <button className="btn btn-primary btn-md" onClick={() => actions.review("swap")}>
          Review swap
        </button>
        <button className="btn btn-ghost btn-md" onClick={actions.dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** Bridge card (bridgeCard). */
export function BridgeCard({ actions }: { actions: CardActions }) {
  return (
    <div className="ccard" data-card="bridge">
      <div className="ch">
        <span className="rank">Bridge · Base → Sui</span>
        <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
      </div>
      <div className="cthesis">
        Move <b>500 USDC</b> from Base to <b>Sui</b> via the canonical bridge. You keep custody the whole way — funds
        land in your own Sui wallet.
      </div>
      <div className="crow">
        <div className="capy">
          <div className="big tnum">500</div>
          <div className="lbl">USDC · from Base</div>
        </div>
        <div className="capy">
          <div className="big tnum">~3–5m</div>
          <div className="lbl">settlement · fee ≈ $0.40</div>
        </div>
      </div>
      <div className="cnote">
        Non-custodial bridge: you sign a lock on Base, receive on Sui. SparkPoint never holds funds in transit.
      </div>
      <div className="cact">
        <button className="btn btn-primary btn-md" onClick={() => actions.review("bridge")}>
          Review bridge
        </button>
        <button className="btn btn-ghost btn-md" onClick={actions.dismiss}>
          Not now
        </button>
      </div>
    </div>
  );
}

/** Citation source body — opened in a sheet by data-cite (kept here for reuse). */
export function CiteBody() {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
      <b>Based on Aave v3 (Base)</b>
      <div className="muted" style={{ marginTop: 6 }}>
        USDC supply rate · 4.3% · as of 2 min ago
      </div>
      <a className="cite" style={{ marginTop: 10, display: "inline-flex" }}>
        View on Basescan <Icon name="ext" size={10} />
      </a>
    </div>
  );
}
