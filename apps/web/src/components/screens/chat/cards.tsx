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
import { capNoun } from "@/lib/stage";
import { money } from "@/lib/utils";
import { toHref } from "@/lib/nav";
import { RiskChip } from "@/components/ui/risk-chip";
import { StatusTag } from "@/components/ui/status-tag";
import { APP_DEFAULT_CHAIN_ID } from "@/lib/chain/appChain";
import { chainName } from "@sparkpoint/shared/chains";
import type { InlineIntent } from "@/components/screens/chat/inline-confirm";

/**
 * The Robinhood Chain (4663) mainnet-beta build. On this build the only live capabilities are chat,
 * a user-signed ETH/WETH <-> USDG swap via the on-chain Uniswap V3, and read-only portfolio — no
 * Aave vault, no Aerodrome, no Sui bridge. Each card below branches on this so the beta renders only
 * those real capabilities (never Aave/Base/Sui/USDC); every other build keeps its existing content
 * byte-for-byte in the else path.
 */
const IS_ROBINHOOD_MAINNET_BUILD = APP_DEFAULT_CHAIN_ID === 4663;
/** The build's home network, from the shared registry — never a hard-coded chain name. */
const NETWORK_NAME = chainName(APP_DEFAULT_CHAIN_ID);

/** Card action callbacks — the chat screen wires these to its thread state. */
export interface CardActions {
  /** open the inline confirm flow for the given intent. */
  review: (intent: InlineIntent) => void;
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
  if (IS_ROBINHOOD_MAINNET_BUILD) {
    // Robinhood Chain has no AI yield vault yet — the beta demo routes yield/lend/recommend questions
    // to an honest text reply rather than this card, so it is normally unused here. Kept SAFE (no
    // Aave/Base/USDC) in case it is ever rendered: the honest "best move I have today" is a swap.
    return (
      <div className="ccard" data-card="rec" style={dismissed ? { opacity: 0.5 } : undefined}>
        <div className="ch">
          <span className="rank">Best fit · what&apos;s live today</span>
          <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
        </div>
        <div className="cthesis">
          The AI yield vault isn&apos;t on {NETWORK_NAME} yet. What you can do today is swap between <b>ETH/WETH</b> and{" "}
          <b>USDG</b> — you review the quote and sign from your own wallet.
        </div>
        <div className="cnote">Estimates, not guarantees. · You approve and sign every move.</div>
        <div className="cact">
          <button className="btn btn-primary btn-md" onClick={() => actions.review({ kind: "swap", ethToUsdc: true })}>
            Review a swap
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
      </div>
    );
  }
  return (
    <div className="ccard" data-card="rec" style={dismissed ? { opacity: 0.5 } : undefined}>
      <div className="ch">
        <span className="rank">Best fit · #1 vs your goal</span>
        <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
        <StatusTag variant="mock" title={"Example figures — connect for live recommendations with the real Aave rate."} />
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
        <button className="btn btn-primary btn-md" onClick={() => actions.review({ kind: "deposit" })}>
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
          satisfies your {capNoun} and slippage guardrails, and raises yield without changing your risk tier. The
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
  if (IS_ROBINHOOD_MAINNET_BUILD) {
    // Robinhood Chain: the read-only portfolio is real ETH + USDG only — no AI vault position.
    const eth = 2100;
    const usdg = 2150;
    const net = eth + usdg;
    const bars: { k: string; v: number; risk: number }[] = [
      { k: "ETH", v: eth, risk: 2 },
      { k: "USDG", v: usdg, risk: 0 },
    ];
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
              {money(net)}
            </div>
            <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>net worth · ETH + USDG</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {bars.map((x) => (
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
          <span>ETH {money(eth)}</span>
          <span>USDG {money(usdg)}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 13 }}>
          <span style={{ fontSize: 12.5, color: "var(--muted-foreground)" }}>
            Read-only — I can help you swap ETH/WETH ↔ USDG. You approve and sign.
          </span>
        </div>
        <div className="cact">
          <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
            Open portfolio
          </button>
          <button className="btn btn-ghost btn-md" onClick={() => actions.send("Swap ETH to USDG")}>
            Swap ETH → USDG
          </button>
        </div>
      </div>
    );
  }
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
  if (IS_ROBINHOOD_MAINNET_BUILD) {
    // Robinhood Chain's only executable move is a swap, so a beta "outcome" is a past swap fill —
    // no rebalance/vault recommendation history (which doesn't exist here).
    return (
      <div className="ccard" data-card="out">
        <div className="ch">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Outcome</span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>from your ETH → USDG swap</span>
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 4, marginBottom: 12, lineHeight: 1.5 }}>
          The swap filled inside your slippage limit and the USDG landed straight in your wallet — you signed it
          yourself.{" "}
          <a className="cite" style={{ cursor: "pointer" }}>
            View tx <Icon name="ext" size={10} />
          </a>
        </div>
        <div className="cact">
          <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
            Open portfolio
          </button>
          <button className="btn btn-ghost btn-md" onClick={() => actions.send("Swap ETH to USDG")}>
            Swap again
          </button>
        </div>
      </div>
    );
  }
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
  if (IS_ROBINHOOD_MAINNET_BUILD) {
    // Robinhood Chain wallet: real ETH + USDG only — no USDC/cbBTC/Aave-vault positions, and the
    // primary action is a swap, not a vault deposit.
    const rows: [string, string, string, string, string][] = [
      ["ETH", "0.42", "$2,100", "+1.8% (24h)", "--gain"],
      ["USDG", "2,150.00", "$2,150", "stablecoin", "--muted-foreground"],
    ];
    return (
      <div className="ccard" data-card="wallet">
        <div className="ch">
          <span style={{ fontSize: 13, fontWeight: 600 }}>Your wallet · {NETWORK_NAME}</span>
          <span style={{ fontSize: 11, color: "var(--muted-foreground)" }} className="grow">
            total ≈ $4,250
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
          <button className="btn btn-primary btn-md" onClick={() => actions.send("Swap ETH to USDG")}>
            Swap ETH → USDG
          </button>
          <button className="btn btn-ghost btn-md" onClick={() => go("portfolio")}>
            Open portfolio
          </button>
        </div>
      </div>
    );
  }
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
  if (IS_ROBINHOOD_MAINNET_BUILD) {
    return (
      <div className="ccard" data-card="swap">
        <div className="ch">
          <span className="rank">Swap · ETH → USDG</span>
          <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
        </div>
        <div className="cthesis">
          Best route on {NETWORK_NAME}: <b>ETH → USDG via Uniswap V3</b>. Slippage protection is built into the route.
        </div>
        <div className="crow">
          <div className="capy">
            <div className="big tnum">0.1 ETH</div>
            <div className="lbl">you swap · you hold 0.42 ETH</div>
          </div>
          <div className="capy">
            <div className="big tnum">≈ 312.40</div>
            <div className="lbl">USDG out · max slippage 0.5%</div>
          </div>
        </div>
        <div className="cnote">
          Includes a Sparky routing fee of 0.20% (≈ $0.62), shown in full before you sign. You sign it from your own
          wallet.
        </div>
        <div className="cact">
          <button className="btn btn-primary btn-md" onClick={() => actions.review({ kind: "swap", ethToUsdc: true })}>
            Review swap
          </button>
          <button className="btn btn-ghost btn-md" onClick={actions.dismiss}>
            Not now
          </button>
        </div>
      </div>
    );
  }
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
        Includes a Sparky routing fee of 0.20% (≈ $0.62), shown in full before you sign. USDC you can then deposit
        into the vault.
      </div>
      <div className="cact">
        <button className="btn btn-primary btn-md" onClick={() => actions.review({ kind: "swap", ethToUsdc: true })}>
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
  if (IS_ROBINHOOD_MAINNET_BUILD) {
    // No bridge on Robinhood Chain yet — the beta demo routes bridge questions to an honest text
    // reply rather than this card, so it is normally unused here. Kept SAFE (no Base/Sui/USDC) if
    // ever rendered: point at what is live today, a swap.
    return (
      <div className="ccard" data-card="bridge">
        <div className="ch">
          <span className="rank">Bridge</span>
        </div>
        <div className="cthesis">
          Bridging isn&apos;t available on {NETWORK_NAME} yet. What you can do today is swap between <b>ETH/WETH</b> and{" "}
          <b>USDG</b> — you approve and sign from your own wallet.
        </div>
        <div className="cact">
          <button className="btn btn-primary btn-md" onClick={() => actions.send("Swap ETH to USDG")}>
            Swap ETH → USDG
          </button>
        </div>
      </div>
    );
  }
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
        Non-custodial bridge: you sign a lock on Base, receive on Sui. Sparky never holds funds in transit.
      </div>
      <div className="cact">
        <button className="btn btn-primary btn-md" onClick={() => actions.review({ kind: "bridge" })}>
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
  if (IS_ROBINHOOD_MAINNET_BUILD) {
    return (
      <div style={{ fontSize: 13, lineHeight: 1.6 }}>
        <b>Based on the on-chain Uniswap V3 pool ({NETWORK_NAME})</b>
        <div className="muted" style={{ marginTop: 6 }}>
          ETH/USDG quote · live from the pool · as of 2 min ago
        </div>
        <a className="cite" style={{ marginTop: 10, display: "inline-flex" }}>
          View on the {NETWORK_NAME} explorer <Icon name="ext" size={10} />
        </a>
      </div>
    );
  }
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
