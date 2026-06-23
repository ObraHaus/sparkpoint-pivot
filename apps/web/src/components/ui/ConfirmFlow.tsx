"use client";

/**
 * ConfirmFlow — the SHARED trust gate (the design's confirm.js).
 *
 * Faithful port of docs/design-handover/showcase/screens/confirm.js. Reproduces the
 * gate states: simulating → balance-changes table → guardrail checklist (.guard rows)
 * → (deposit) an acknowledgement checkbox that GATES a disabled Sign button → signing
 * → success (receipt). "Nothing moves until you sign." Copy/amounts are parameterized
 * by `intent` exactly as the source's confirm variants do.
 *
 * Imported by other screens (chat, vault) — keep the named export `ConfirmFlow` and the
 * stable props: `intent` + optional `mount`.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/lib/icons";
import { money } from "@/lib/utils";
import { data } from "@/lib/mock-data";
import { toHref } from "@/lib/nav";
import { useOverlay } from "@/components/overlays/OverlayProvider";
import "@/components/screens/confirm.css";

export type ConfirmIntent = "deposit" | "withdraw" | "swap" | "premium" | "bridge";

type Phase = "sim" | "ready" | "signing" | "done";
type Mount = "route" | "inline";

/** The animated green check that replaces the pulsing ai-dot once a sim step finishes. */
function StepCheck() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="3">
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

interface SimStep {
  a: string;
  b: string;
}

/** Per-intent config — copy/amounts/sections mirror the confirm variants in confirm.js. */
interface IntentConfig {
  backLabel: string;
  backRoute: string;
  title: string;
  /** header right slot: flask icon (false) or the AI badge (true). */
  badge: boolean;
  sub: React.ReactNode;
  simLabel: string;
  sim: SimStep[];
  bc: [label: React.ReactNode, value: React.ReactNode, color: string][];
  /** swap-only "Cost & outcome" section. */
  cost?: React.ReactNode;
  guards: React.ReactNode[];
  /** deposit-only acknowledgement copy (gates the Sign button). */
  ack: string | null;
  /** swap-only "How it works" trace. */
  trace?: React.ReactNode;
  ctrl: React.ReactNode;
  cancelRoute: string;
  signLabel: string;
  okTitle: string;
  okBody: React.ReactNode;
  okCite: React.ReactNode;
  /** receipt footer buttons (rendered after the cite link). */
  okActions: (go: (r: string) => void) => React.ReactNode;
  /** swap-only chained "put USDC to work" card inside the route receipt. */
  okChain?: (go: (r: string) => void) => React.ReactNode;
  /** next intent to chain into from the inline receipt (swap → deposit), else null. */
  chain: ConfirmIntent | null;
  toast: string;
}

const GUARD_ICON = (
  <span className="gi">
    <Icon name="check" size={16} />
  </span>
);

function guardRow(text: React.ReactNode, key: number) {
  return (
    <div className="guard pass" key={key}>
      {GUARD_ICON}
      <span className="gt">{text}</span>
    </div>
  );
}

function configFor(intent: ConfirmIntent): IntentConfig {
  switch (intent) {
    case "deposit":
      return {
        backLabel: "Back",
        backRoute: "history",
        title: "Confirm: Deposit",
        badge: false,
        sub: "You're depositing 2,150 USDC into the Aave Yield Vault. You'll receive ≈ 2,118.4 spvUSDC.",
        simLabel: "Pre-trade simulation",
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
          <>Within your beta cap ({money(data.vault.capUser, 0)})</>,
          "Slippage under your max (0.5%)",
          "Allowlisted protocol — Aave v3 (Base)",
          "Simulation passed — no risks detected",
        ],
        ack: "This uses your full idle balance, leaving no USDC buffer in your wallet.",
        ctrl: (
          <span>
            <b style={{ color: "var(--foreground)" }}>Nothing moves until you sign.</b> You can cancel now with no
            effect. SparkPoint never holds your funds.
          </span>
        ),
        cancelRoute: "vault",
        signLabel: "Sign deposit",
        okTitle: "Deposit confirmed.",
        okBody: <>You now hold 11,952.9 spvUSDC (≈ {money(12152.82)}).</>,
        okCite: <>View transaction <Icon name="ext" size={11} /></>,
        okActions: (go) => (
          <>
            <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
              See it in your portfolio
            </button>
            <button className="btn btn-primary btn-md" onClick={() => go("chat")}>
              Back to chat
            </button>
          </>
        ),
        chain: null,
        toast: "Deposit confirmed · View tx ↗",
      };
    case "withdraw":
      return {
        backLabel: "Back",
        backRoute: "history",
        title: "Confirm: Withdrawal",
        badge: false,
        sub: "You're withdrawing 5,000 USDC from the Aave Yield Vault to your wallet.",
        simLabel: "Pre-trade simulation",
        sim: [
          { a: "Building the transaction", b: "Built the transaction" },
          { a: "Simulating against Base state", b: "Simulated against Base state" },
          { a: "Checking your guardrails", b: "Checked your guardrails" },
        ],
        bc: [
          ["spvUSDC redeemed", "−4,902.10 spvUSDC", "--loss"],
          ["USDC in", "+5,000.00 USDC", "--gain"],
          ["Network fee (gas)", "≈ $0.01", ""],
          ["Fee on this deposit", "0% — none", "--gain"],
        ],
        guards: [
          <>Within your beta cap ({money(data.vault.capUser, 0)})</>,
          "Slippage under your max (0.5%)",
          "Allowlisted protocol — Aave v3 (Base)",
          "Simulation passed — no risks detected",
        ],
        ack: null,
        ctrl: (
          <span>
            <b style={{ color: "var(--foreground)" }}>Nothing moves until you sign.</b> You can cancel now with no
            effect. SparkPoint never holds your funds.
          </span>
        ),
        cancelRoute: "vault",
        signLabel: "Sign withdrawal",
        okTitle: "Withdrawal confirmed.",
        okBody: <>{money(5000)} is back in your wallet.</>,
        okCite: <>View transaction <Icon name="ext" size={11} /></>,
        okActions: (go) => (
          <>
            <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
              See it in your portfolio
            </button>
            <button className="btn btn-primary btn-md" onClick={() => go("chat")}>
              Back to chat
            </button>
          </>
        ),
        chain: null,
        toast: "Withdrawal confirmed · View tx ↗",
      };
    case "swap":
      return {
        backLabel: "Back to chat",
        backRoute: "chat",
        title: "Confirm: Swap",
        badge: true,
        sub: (
          <>
            You&rsquo;re swapping <b style={{ color: "var(--foreground)" }}>0.1 ETH</b> for ≈{" "}
            <b style={{ color: "var(--foreground)" }}>312.40 USDC</b> on Aerodrome.
          </>
        ),
        simLabel: "Pre-trade simulation",
        sim: [
          { a: "Building the swap", b: "Built the swap" },
          { a: "Simulating on Aerodrome", b: "Simulated on Aerodrome" },
          { a: "Checking your guardrails", b: "Checked your guardrails" },
        ],
        bc: [
          ["ETH out", "− 0.1000 ETH · −$500.00", "--loss"],
          ["USDC in", "+ 312.40 USDC · +$312.40", "--gain"],
          ["Network fee (gas)", "≈ $0.05", ""],
          ["Expected output", "≈ 312.40 USDC", ""],
          [
            <>
              Minimum received <span style={{ fontSize: 11 }}>(at 0.5% max slippage)</span>
            </>,
            "310.84 USDC",
            "",
          ],
        ],
        cost: (
          <>
            <div className="cf-lbl">Cost &amp; outcome</div>
            <div className="feeline">
              <span className="ffi">
                SparkPoint routing fee · 0.20%{" "}
                <span
                  className="ii"
                  title="A usage fee for routing this swap. It's taken inside this swap — SparkPoint never holds your funds. It never applies to the vault or your deposits."
                >
                  i
                </span>
              </span>
              <span className="tnum">$0.62</span>
            </div>
            <div className="feeline">
              <span className="ffi">Net USDC received</span>
              <span className="tnum" style={{ color: "var(--foreground)", fontWeight: 600 }}>
                ≈ 311.78 USDC
              </span>
            </div>
          </>
        ),
        guards: [
          "Route allowlisted — Aerodrome (Base)",
          "Slippage under your max (0.5%)",
          "Policy approved",
          "Simulation passed — no risks detected",
        ],
        ack: null,
        trace: (
          <details className="trace">
            <summary>
              <Icon name="info" size={14} /> How it works
            </summary>
            <div style={{ marginTop: 8 }}>
              <div className="trace-row">
                <span className="tn">1</span>
                <div>
                  You ask Sparky to <b>swap ETH for USDC</b>
                </div>
              </div>
              <div className="trace-row">
                <span className="tn">2</span>
                <div>
                  Policy layer checks <b>Aerodrome allowlist, limits, slippage</b>
                </div>
              </div>
              <div className="trace-row">
                <span className="tn">3</span>
                <div>
                  Tenderly <b>simulates</b> the exact swap — output, min received, gas
                </div>
              </div>
              <div className="trace-row hinge">
                <span className="tn">4</span>
                <div>
                  <b>You sign.</b> Nothing moves before this.
                </div>
              </div>
              <div className="trace-row">
                <span className="tn">5</span>
                <div>
                  Aerodrome swaps — the <b>routing fee leg</b> is taken inside your signed swap
                </div>
              </div>
              <div className="trace-row">
                <span className="tn">6</span>
                <div>
                  Result recorded to your <b>Outcome Log</b>
                </div>
              </div>
            </div>
          </details>
        ),
        ctrl: (
          <span>
            <b style={{ color: "var(--foreground)" }}>Nothing moves until you sign.</b> You can cancel now with no
            effect. SparkPoint never holds your funds.
          </span>
        ),
        cancelRoute: "chat",
        signLabel: "Sign transaction",
        okTitle: "Swap confirmed.",
        okBody: <>You received ≈ 311.78 USDC via Aerodrome. Routing fee paid: $0.62 (0.20%).</>,
        okCite: <>View transaction <Icon name="ext" size={11} /></>,
        okActions: () => null,
        okChain: (go) => (
          <div
            className="card"
            style={{ textAlign: "left", padding: 16, margin: "0 0 4px", borderColor: "color-mix(in srgb,var(--primary) 26%,transparent)" }}
          >
            <span className="badge badge-ai" style={{ marginBottom: 9 }}>
              AI suggestion — you approve &amp; sign
            </span>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Put your USDC to work?</div>
            <div style={{ fontSize: 12.5, color: "var(--muted-foreground)", lineHeight: 1.5, marginBottom: 12 }}>
              You now hold ≈ 311.78 USDC. Deposit it into the Aave Yield Vault and start earning —{" "}
              <b style={{ color: "var(--foreground)" }}>3.87% net APY</b> (estimate · see breakdown). 0% on your
              deposit; 10% performance fee on yield only. Withdraw anytime.
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <button className="btn btn-primary btn-md" onClick={() => go("confirm/deposit")}>
                Review deposit
              </button>
              <button className="btn btn-ghost btn-md" onClick={() => go("portfolio")}>
                Not now
              </button>
            </div>
          </div>
        ),
        chain: "deposit",
        toast: "Swap confirmed · View tx ↗",
      };
    case "premium":
      return {
        backLabel: "Back",
        backRoute: "premium/pay",
        title: "Confirm: Premium subscription",
        badge: false,
        sub: (
          <>
            You&apos;re paying <b style={{ color: "var(--foreground)" }}>500 SRK</b> (≈ $12.00) for one month of
            Premium. This is a subscription payment, not a vault fee.
          </>
        ),
        simLabel: "Pre-trade simulation",
        sim: [
          { a: "Building the payment", b: "Built the payment" },
          { a: "Simulating approve + pay", b: "Simulated approve + pay" },
          { a: "Checking your guardrails", b: "Checked your guardrails" },
        ],
        bc: [
          ["SRK out", "− 500 SRK · −$12.00", "--loss"],
          ["Steps", "approve + pay", ""],
          ["Network fee (gas)", "≈ $0.02", ""],
          ["SparkPoint fee", <span key="srk">n/a — subscription payment, not a vault fee</span>, ""],
        ],
        guards: [
          "Allowlisted — SparkPoint subscription contract",
          "Exact amount — 500 SRK, no unlimited approval",
          "Simulation passed — no risks detected",
        ],
        ack: null,
        ctrl: (
          <span>
            <b style={{ color: "var(--foreground)" }}>Nothing moves until you sign.</b> Premium never gates the vault,
            deposits, yield, or withdrawals. Cancel anytime.
          </span>
        ),
        cancelRoute: "premium",
        signLabel: "Sign & subscribe",
        okTitle: "Premium active.",
        okBody: (
          <>
            Premium subscription: 500 SRK (paid in SRK) — not a vault fee. Renews monthly · cancel anytime in
            Settings.
          </>
        ),
        okCite: <>View transaction <Icon name="ext" size={11} /></>,
        okActions: (go) => (
          <>
            <button className="btn btn-outline btn-md" onClick={() => go("premium")}>
              Manage subscription
            </button>
            <button className="btn btn-primary btn-md" onClick={() => go("chat")}>
              Back to chat
            </button>
          </>
        ),
        chain: null,
        toast: "Premium active · View tx ↗",
      };
    case "bridge":
      return {
        backLabel: "Back to bridge",
        backRoute: "bridge",
        title: "Confirm: Bridge",
        badge: false,
        sub: (
          <>
            You&apos;re bridging <b style={{ color: "var(--foreground)" }}>500 USDC</b> from{" "}
            <b style={{ color: "var(--foreground)" }}>Base</b> to <b style={{ color: "var(--foreground)" }}>Sui</b>.
          </>
        ),
        simLabel: "Pre-bridge simulation",
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
        ctrl: (
          <span>
            <b style={{ color: "var(--foreground)" }}>You stay in custody the whole way.</b> Funds leave Base only by
            your signature and land in your own Sui wallet. SparkPoint never holds them in transit.
          </span>
        ),
        cancelRoute: "bridge",
        signLabel: "Sign bridge",
        okTitle: "Bridge initiated.",
        okBody: (
          <>
            500 USDC is on its way from Base to Sui — usually 3–5 minutes. You&apos;ll get a notification when it lands
            in your Sui wallet.
          </>
        ),
        okCite: <>Track on bridge explorer <Icon name="ext" size={11} /></>,
        okActions: (go) => (
          <>
            <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
              View portfolio
            </button>
            <button className="btn btn-primary btn-md" onClick={() => go("chat")}>
              Back to chat
            </button>
          </>
        ),
        chain: null,
        toast: "Bridge initiated · Base → Sui",
      };
  }
}

export function ConfirmFlow({
  intent,
  mount = "route",
  onChain,
}: {
  intent: ConfirmIntent;
  mount?: Mount;
  /** Inline-only: invoked by the swap receipt's "Put USDC to work" button so the chat can
   * append a fresh inline deposit confirm in the thread (the design's data-chainbtn). When
   * omitted, the route receipt's "Review deposit" card navigates to /confirm/deposit. */
  onChain?: () => void;
}) {
  const router = useRouter();
  const { toast } = useOverlay();
  const cfg = configFor(intent);
  const inline = mount === "inline";

  const [phase, setPhase] = useState<Phase>("sim");
  // index of the current/finished simulation step (-1 = none done yet).
  const [simIdx, setSimIdx] = useState(0);
  const [simDone, setSimDone] = useState(false);
  const [acked, setAcked] = useState(false);
  const [shake, setShake] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const timers = useRef<number[]>([]);

  const go = (route: string) => router.push(toHref(route));
  const onBack = () => (cfg.backRoute === "history" ? router.back() : go(cfg.backRoute));

  // Drive the simulation reveal: each step shows "…", then a green check + past tense.
  useEffect(() => {
    let i = 0;
    function step() {
      if (i >= cfg.sim.length) {
        setSimDone(true);
        const t = window.setTimeout(() => setPhase("ready"), 360);
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
    setPhase("signing");
    window.setTimeout(() => {
      setPhase("done");
      toast(cfg.toast);
    }, 1400);
  }

  // ---- success receipt ----
  if (phase === "done") {
    const receipt = (
      <div style={{ padding: inline ? "30px 22px" : "40px 24px", textAlign: "center" }}>
        <div
          className="cf-okpop"
          style={{
            width: inline ? 56 : 64,
            height: inline ? 56 : 64,
            borderRadius: "50%",
            background: "var(--gain-subtle)",
            display: "grid",
            placeItems: "center",
            margin: "0 auto 14px",
          }}
        >
          <span style={{ color: "var(--gain)" }}>
            <Icon name="check" size={inline ? 28 : 30} stroke={2.5} />
          </span>
        </div>
        <div style={{ fontSize: inline ? 18 : 20, fontWeight: 600, marginBottom: inline ? 7 : 8 }}>{cfg.okTitle}</div>
        <div
          style={{
            fontSize: inline ? 13.5 : 14,
            color: "var(--muted-foreground)",
            lineHeight: 1.5,
            maxWidth: 380,
            margin: "0 auto 6px",
          }}
        >
          {cfg.okBody}
        </div>
        <a className="cite" style={{ cursor: "pointer", display: "inline-flex", marginBottom: inline ? 16 : 20 }}>
          {cfg.okCite}
        </a>
        {inline ? (
          // Inline (chat) receipt: portfolio link + an optional chained deposit button.
          <div style={{ display: "flex", gap: 9, justifyContent: "center", flexWrap: "wrap" }}>
            <button className="btn btn-outline btn-md" onClick={() => go("portfolio")}>
              See it in your portfolio
            </button>
            {cfg.chain && (
              <button
                className="btn btn-primary btn-md"
                onClick={() => (onChain ? onChain() : go("confirm/" + cfg.chain))}
              >
                Put USDC to work
              </button>
            )}
          </div>
        ) : cfg.okChain ? (
          cfg.okChain(go)
        ) : (
          <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            {cfg.okActions(go)}
          </div>
        )}
      </div>
    );
    return <Frame mount={mount} backLabel={cfg.backLabel} onBack={onBack}>{receipt}</Frame>;
  }

  // ---- the live confirm card ----
  const revealed = phase !== "sim";

  return (
    <Frame mount={mount} backLabel={cfg.backLabel} onBack={onBack}>
      <div className="cf-hd">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <div style={{ fontSize: inline ? 16 : 17, fontWeight: 600 }}>{cfg.title}</div>
          {cfg.badge ? (
            <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
          ) : (
            <Icon name="flask" size={18} />
          )}
        </div>
        <div style={{ fontSize: inline ? 13 : 13.5, color: "var(--muted-foreground)", marginTop: 6, lineHeight: 1.5 }}>
          {cfg.sub}
        </div>
      </div>

      <div className="cf-sec">
        <div className="cf-lbl">{cfg.simLabel}</div>
        <div>
          {cfg.sim.map((s, k) => {
            if (k > simIdx) return null;
            const done = simDone || k < simIdx;
            return (
              <div
                key={k}
                style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--muted-foreground)", padding: "4px 0" }}
              >
                {done ? <StepCheck /> : <span className="ai-dot" />}
                <span>{done ? s.b : `${s.a}…`}</span>
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

          {cfg.cost && (
            <div className="cf-sec cf-reveal" style={{ animationDelay: "110ms" }}>
              {cfg.cost}
            </div>
          )}

          <div
            className={"cf-sec cf-reveal" + (shake ? " shake" : "")}
            style={{ animationDelay: cfg.cost ? "220ms" : "120ms" }}
          >
            <div className="cf-lbl">Guardrail checklist</div>
            {cfg.guards.map((g, k) => guardRow(g, k))}
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
            {cfg.trace}
          </div>

          <div className="cf-sec cf-reveal" style={{ animationDelay: cfg.cost ? "330ms" : "240ms" }}>
            <div style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
              <Icon name="shieldcheck" size={16} />
              {cfg.ctrl}
            </div>
          </div>

          <div className="cf-sec cf-reveal" style={{ animationDelay: cfg.cost ? "440ms" : "360ms" }}>
            {cfg.ack && (
              <div
                style={{ fontSize: 12, color: "var(--caution)", marginBottom: 10, display: acked ? "none" : "block" }}
              >
                <Icon name="alert" size={13} /> Acknowledge the item above to enable signing.
              </div>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              {cancelled ? null : (
                <button
                  className={"btn btn-outline " + (inline ? "btn-md" : "btn-lg")}
                  style={{ flex: "none" }}
                  onClick={() => {
                    if (inline) {
                      setCancelled(true);
                      toast("Cancelled — nothing moved.");
                    } else {
                      go(cfg.cancelRoute);
                    }
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                className={"btn btn-primary " + (inline ? "btn-md" : "btn-lg")}
                style={{ flex: 1, ...(cancelled ? { opacity: 0.5 } : null) }}
                disabled={phase === "signing" || signDisabled}
                onClick={onSign}
              >
                {phase === "signing" ? (
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
    </Frame>
  );
}

/** Shared chrome: the route mount adds a Back link + `.cf-wrap`; the inline mount renders
 * a bare `.cf-card` (the thread bubble wrapper is supplied by the chat screen). */
function Frame({
  mount,
  backLabel,
  onBack,
  children,
}: {
  mount: Mount;
  backLabel: string;
  onBack: () => void;
  children: React.ReactNode;
}) {
  if (mount === "inline") {
    return (
      <div className="ccard cf-card" style={{ padding: 0, overflow: "hidden", maxWidth: 600 }}>
        {children}
      </div>
    );
  }
  return (
    <div className="cf-wrap">
      <a className="qlink" style={{ display: "inline-flex", marginBottom: 14, cursor: "pointer" }} onClick={onBack}>
        <Icon name="chevr" size={15} /> {backLabel}
      </a>
      <div className="cf-card">{children}</div>
    </div>
  );
}
