"use client";

/**
 * InlineConfirm — the chat screen's OWN inline confirm + sign card.
 *
 * Faithful port of the `CONFIRM` map + `inlineConfirm()` / `wireInline()` in
 * docs/design-handover/showcase/screens/chat.js. This deliberately does NOT reuse the
 * shared ConfirmFlow (confirm.js): chat.js carries its own copy/structure for the inline
 * variant — a flat balance-changes table (no separate "Cost & outcome" feeline, no
 * "How it works" trace), the generic "Pre-trade simulation" label and control line for
 * every kind (incl. bridge), the bolded deposit sub with an em-dash, and a plain "Within
 * your beta cap" guard. Keeping it chat-local leaves ConfirmFlow's route mount untouched.
 *
 * States mirror the source: simulating → balance changes → guardrail checklist (+ deposit
 * acknowledgement that gates a disabled Sign button) → control line → sign → success.
 * "Nothing moves until you sign."
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { toHref } from "@/lib/nav";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import "@/components/screens/confirm.css";

export type InlineKind = "deposit" | "swap" | "bridge";

interface SimStep {
  a: string;
  b: string;
}

/** Per-kind config — copy/amounts/sections mirror the CONFIRM variants in chat.js. */
interface InlineConfig {
  title: string;
  /** header right slot: AI badge (true) or the flask icon (false). */
  badge: boolean;
  sub: React.ReactNode;
  sim: SimStep[];
  /** [label, value, color-var] — the flat "Balance changes (simulated)" rows. */
  bc: [label: string, value: string, color: string][];
  guards: React.ReactNode[];
  /** deposit-only acknowledgement copy (gates the Sign button). */
  ack: string | null;
  signLabel: string;
  okTitle: string;
  okBody: React.ReactNode;
  /** "deposit" chains the swap receipt into a fresh inline deposit confirm, else null. */
  chain: InlineKind | null;
}

const CONFIRM: Record<InlineKind, InlineConfig> = {
  deposit: {
    title: "Confirm: Deposit",
    badge: false,
    sub: (
      <>
        You&rsquo;re depositing <b>2,150 USDC</b> into the Aave Yield Vault — you&rsquo;ll receive ≈ 2,118.4 spvUSDC.
      </>
    ),
    sim: [
      { a: "Building the transaction", b: "Built the transaction" },
      { a: "Simulating against Base state", b: "Simulated against Base state" },
      { a: "Checking your guardrails", b: "Checked your guardrails" },
    ],
    bc: [
      ["USDC out", "−2,150.00 USDC", "--loss"],
      ["spvUSDC in", "+2,118.40 spvUSDC", "--gain"],
      ["Network fee (gas)", "≈ $0.01", ""],
      ["Fee on this deposit", "0% — none", "--gain"],
      ["Performance fee", "10% of yield (over HWM)", ""],
      ["Net APY on new shares", "3.87%", ""],
    ],
    guards: [
      "Within your beta cap",
      "Slippage under your max (0.5%)",
      "Allowlisted protocol — Aave v3 (Base)",
      "Simulation passed — no risks detected",
    ],
    ack: "This uses your full idle balance, leaving no USDC buffer in your wallet.",
    signLabel: "Sign deposit",
    okTitle: "Deposit confirmed.",
    okBody: <>You now hold 11,952.9 spvUSDC (≈ $12,152.82).</>,
    chain: null,
  },
  swap: {
    title: "Confirm: Swap",
    badge: true,
    sub: (
      <>
        You&rsquo;re swapping <b>0.1 ETH</b> for ≈ <b>312.40 USDC</b> on Aerodrome.
      </>
    ),
    sim: [
      { a: "Building the swap", b: "Built the swap" },
      { a: "Simulating on Aerodrome", b: "Simulated on Aerodrome" },
      { a: "Checking your guardrails", b: "Checked your guardrails" },
    ],
    bc: [
      ["ETH out", "− 0.1000 ETH · −$500.00", "--loss"],
      ["USDC in", "+ 312.40 USDC", "--gain"],
      ["Network fee (gas)", "≈ $0.05", ""],
      ["Min received (0.5% slip)", "310.84 USDC", ""],
      ["Sparky routing fee · 0.20%", "$0.62", ""],
      ["Net USDC received", "≈ 311.78 USDC", "--gain"],
    ],
    guards: [
      "Route allowlisted — Aerodrome (Base)",
      "Slippage under your max (0.5%)",
      "Policy approved",
      "Simulation passed — no risks detected",
    ],
    ack: null,
    signLabel: "Sign transaction",
    okTitle: "Swap confirmed.",
    okBody: <>You received ≈ 311.78 USDC via Aerodrome. Routing fee paid: $0.62 (0.20%).</>,
    chain: "deposit",
  },
  bridge: {
    title: "Confirm: Bridge",
    badge: false,
    sub: (
      <>
        You&rsquo;re bridging <b>500 USDC</b> from <b>Base</b> to <b>Sui</b>.
      </>
    ),
    sim: [
      { a: "Building the bridge message", b: "Built the bridge message" },
      { a: "Simulating lock on Base", b: "Simulated lock on Base" },
      { a: "Checking your guardrails", b: "Checked your guardrails" },
    ],
    bc: [
      ["USDC out · Base", "− 500.00 USDC", "--loss"],
      ["USDC in · Sui", "+ 500.00 USDC", "--gain"],
      ["Bridge fee", "≈ $0.40", ""],
      ["Est. settlement", "~3–5 min", ""],
    ],
    guards: [
      "Canonical bridge route — allowlisted",
      "Destination is your own Sui wallet",
      "Within your bridge cap",
      "Simulation passed — no risks detected",
    ],
    ack: null,
    signLabel: "Sign bridge",
    okTitle: "Bridge initiated.",
    okBody: (
      <>
        500 USDC is on its way from Base to Sui — usually 3–5 minutes. You&rsquo;ll be notified when it lands in your
        Sui wallet.
      </>
    ),
    chain: null,
  },
};

/** The animated green check that replaces the pulsing ai-dot once a sim step finishes. */
function StepCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="3">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function InlineConfirm({
  kind,
  onChain,
}: {
  kind: InlineKind;
  /** swap receipt's "Put USDC to work" — appends a fresh inline deposit confirm (data-chainbtn). */
  onChain?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOverlay();
  const cfg = CONFIRM[kind];
  const go = (route: string) => router.push(toHref(route));

  // simulation reveal state (mirrors chat.js inlineConfirm's go() loop)
  const [simIdx, setSimIdx] = useState(0);
  const [simDone, setSimDone] = useState(false);
  // post-sim sections reveal once the simulation passes
  const [revealed, setRevealed] = useState(false);
  const [acked, setAcked] = useState(false);
  const [shake, setShake] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [signing, setSigning] = useState(false);
  const [done, setDone] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    let i = 0;
    function step() {
      if (i >= cfg.sim.length) {
        setSimDone(true);
        const t = window.setTimeout(() => setRevealed(true), 200);
        timers.current.push(t);
        return;
      }
      setSimIdx(i);
      const t1 = window.setTimeout(() => {
        i += 1;
        setSimIdx(i);
        const t2 = window.setTimeout(step, 280);
        timers.current.push(t2);
      }, 520);
      timers.current.push(t1);
    }
    step();
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signDisabled = cfg.ack ? !acked : false;

  function onSign() {
    if (signDisabled) {
      setShake(true);
      window.setTimeout(() => setShake(false), 320);
      return;
    }
    setSigning(true);
    window.setTimeout(() => {
      setDone(true);
      toast(cfg.okTitle + " · View tx ↗");
    }, 1400);
  }

  // ---- success receipt ----
  if (done) {
    return (
      <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
        <div style={{ padding: "30px 22px", textAlign: "center" }}>
          <div
            className="cf-okpop"
            style={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              background: "var(--gain-subtle)",
              display: "grid",
              placeItems: "center",
              margin: "0 auto 14px",
            }}
          >
            <span style={{ color: "var(--gain)" }}>
              <Icon name="check" size={28} stroke={2.5} />
            </span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 7 }}>{cfg.okTitle}</div>
          <div
            style={{ fontSize: 13.5, color: "var(--muted-foreground)", lineHeight: 1.5, maxWidth: 380, margin: "0 auto 6px" }}
          >
            {cfg.okBody}
          </div>
          <a className="cite" style={{ cursor: "pointer", display: "inline-flex", marginBottom: 16 }}>
            View transaction <Icon name="ext" size={11} />
          </a>
          <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
              See it in your portfolio
            </button>
            {cfg.chain && (
              <button className="btn btn-primary btn-md" onClick={() => onChain?.()}>
                Put USDC to work
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600, ...(cancelled ? { opacity: 0.5 } : null) }}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{cfg.title}</div>
          {cfg.badge ? (
            <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
          ) : (
            <Icon name="flask" size={18} />
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>{cfg.sub}</div>
      </div>

      <div className="cf-sec">
        <div className="cf-lbl">Pre-trade simulation</div>
        <div>
          {cfg.sim.map((s, k) => {
            if (k > simIdx) return null;
            const stepDone = simDone || k < simIdx;
            return (
              <div
                key={k}
                style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--muted-foreground)", padding: "4px 0" }}
              >
                {stepDone ? <StepCheck /> : <span className="ai-dot" />}
                <span>{stepDone ? s.b : `${s.a}…`}</span>
              </div>
            );
          })}
          {simDone && (
            <div className="simbar pass">
              <Icon name="check" size={16} /> Simulation passed — no risks detected.
            </div>
          )}
        </div>
      </div>

      {revealed && (
        <>
          <div className="cf-sec cf-reveal" style={{ animationDelay: "0ms" }}>
            <div className="cf-lbl">Balance changes (simulated)</div>
            {cfg.bc.map((r, k) => (
              <div className="bc-row" key={k}>
                <span className="muted">{r[0]}</span>
                <span className="tnum" style={r[2] ? { color: `var(${r[2]})` } : undefined}>
                  {r[1]}
                </span>
              </div>
            ))}
          </div>

          <div className={"cf-sec cf-reveal" + (shake ? " shake" : "")} style={{ animationDelay: "120ms" }}>
            <div className="cf-lbl">Guardrail checklist</div>
            {cfg.guards.map((g, k) => (
              <div className="guard pass" key={k}>
                <span className="gi">
                  <Icon name="check" size={16} />
                </span>
                <span className="gt">{g}</span>
              </div>
            ))}
            {cfg.ack && (
              <div className="ackbox">
                <div
                  className={"ackcheck" + (acked ? " on" : "")}
                  onClick={() => setAcked((v) => !v)}
                  role="checkbox"
                  aria-checked={acked}
                >
                  <Icon name="check" size={13} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>Requires your acknowledgement</div>
                  <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", marginTop: 2 }}>{cfg.ack}</div>
                  <div style={{ fontSize: 12, color: "var(--caution)", marginTop: 6, fontWeight: 600 }}>
                    I understand this is above my usual buffer.
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="cf-sec cf-reveal" style={{ animationDelay: "240ms" }}>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              <Icon name="shieldcheck" size={16} />
              <span>
                <b style={{ color: "var(--foreground)" }}>Nothing moves until you sign.</b> You can cancel now with no
                effect. Sparky never holds your funds.
              </span>
            </div>
          </div>

          <div className="cf-sec cf-reveal" style={{ animationDelay: "360ms" }}>
            {cfg.ack && (
              <div style={{ fontSize: 12, color: "var(--caution)", marginBottom: 10, display: acked ? "none" : "block" }}>
                <Icon name="alert" size={13} /> Acknowledge the item above to enable signing.
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button
                className="btn btn-outline btn-md"
                style={{ flex: "none" }}
                onClick={() => {
                  setCancelled(true);
                  toast("Cancelled — nothing moved.");
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary btn-md"
                style={{ flex: 1 }}
                disabled={signing || signDisabled}
                onClick={onSign}
              >
                {signing ? (
                  <>
                    <span className="ai-dot" style={{ background: "var(--primary-foreground)" }} /> Waiting for your
                    wallet…
                  </>
                ) : (
                  <>
                    <Icon name="key" size={16} /> {cfg.signLabel}
                  </>
                )}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
