"use client";

/**
 * /onboarding — the stepped onboarding flow, ported 1:1 from the design's
 * docs/design-handover/showcase/flows/Onboarding.html.
 *
 * A chat-driven flow: welcome → connect → experience → goal → timeline →
 * risk wedge → mandate → first-recommendation preview → done. Each input step
 * appends an AI turn (and the user's reply bubble) to a conversation stream; a
 * progress stepper + sticky CTA dock frame it. All markup/copy mirror the design.
 *
 * State lives in useState: a `step` index (0..8) plus the user's answers. There is
 * no global store — the chosen mandate is local. The final CTA → router.push.
 */

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useOnboarding, mandateSaveHint, type MandateSaveFailure } from "@/lib/agent/useAgent";
import { buildMandateDraft } from "@/lib/agent/mandateDraft";

/** input steps shown in the counter (Connect=1 … Mandate=6); Welcome/Rec/Done are bookends */
const STEP_LABELS = ["Connect", "Experience", "Goal", "Timeline", "Risk", "Your plan"] as const;
const TIER_NAMES: Record<number, string> = {
  1: "Lower risk",
  2: "Low risk",
  3: "Moderate",
  4: "Elevated",
  5: "High risk",
};

interface Answers {
  experience: string | null;
  goal: string | null;
  timeline: string | null;
  riskAns: string | null;
  riskTier: number;
}

/** Persist lifecycle for the confirmed mandate (POST /mandate). */
type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Opens the "What Sparky can & can't do" prove-it sheet (Trust Center).
 * In the design prototype this is an alert placeholder wired to both #proveLink
 * and #badgeNC (Onboarding.html lines 515–516); the real sheet lives in the
 * shell build.
 */
function openProveIt() {
  alert(
    'Prove-it panel → opens the "What Sparky can & can\'t do" sheet (Trust Center). Wired in the shell build.',
  );
}

export default function OnboardingPage() {
  const router = useRouter();
  // The REAL connected wallet (onboarding runs post-SIWE-connect) — never a hardcoded placeholder.
  const { address } = useAccount();
  const walletShort = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;
  const [stepIndex, setStepIndex] = useState(0); // 0..8
  const [answers, setAnswers] = useState<Answers>({
    experience: null,
    goal: null,
    timeline: null,
    riskAns: null,
    riskTier: 1,
  });
  const [whyOpen, setWhyOpen] = useState(false);

  const go = (n: number) => setStepIndex(n);
  const set = (patch: Partial<Answers>) => setAnswers((a) => ({ ...a, ...patch }));

  // Confirm the plan → persist the LOCAL draft (the exact mandate the user just saw)
  // via POST /mandate. Awaited, with an explicit success/error state — no fire-and-forget
  // and no silent offline no-op. We deliberately do NOT round-trip through the server's
  // default recompute (it drops the goal/tier/timeline the user chose — US3 AC2).
  const onboarding = useOnboarding();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // WHY the failure is kept, not just the state: the dock used to say "check your connection" for
  // every failure, including a hard server rejection that no amount of retrying could fix. We now
  // show the server's own message/code when there is one (025).
  const [saveFailure, setSaveFailure] = useState<MandateSaveFailure | null>(null);
  const confirmPlan = useCallback(async (): Promise<boolean> => {
    const mandate = buildMandateDraft(answers);
    if (!onboarding.online) {
      // No connected wallet ⇒ nothing to scope the mandate to. Surface it; never pretend.
      setSaveFailure({ kind: "offline" });
      setSaveState("error");
      return false;
    }
    setSaveState("saving");
    setSaveFailure(null);
    const outcome = await onboarding.confirmMandate(mandate);
    if (outcome.ok) {
      setSaveState("saved");
      return true;
    }
    setSaveFailure(outcome.failure);
    setSaveState("error");
    return false;
  }, [onboarding, answers]);
  const saveHint = mandateSaveHint(saveState === "error" ? saveFailure : null);

  // ---------- stepper ----------
  const inputActive = Math.min(Math.max(stepIndex, 1), 6); // 1..6

  return (
    <>
      {/* stepper */}
      <div className="stepper" id="stepper">
        {STEP_LABELS.map((lbl, i) => {
          const n = i + 1;
          const done = stepIndex > 6 || n < inputActive;
          const active = stepIndex >= 1 && stepIndex <= 6 && n === inputActive;
          return (
            <div className="stepwrap" key={lbl}>
              <div
                className={"stepdot" + (done ? " done" : "") + (active ? " active" : "")}
                onClick={done ? () => go(n) : undefined}
              >
                <span className="ring">
                  {done ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    n
                  )}
                </span>
                <span className="lbl">{lbl}</span>
              </div>
              {i < STEP_LABELS.length - 1 && (
                <div className={"stepline" + (done ? " done" : "")}>
                  <span className="fill" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div
        className="stepcount tnum"
        id="stepcount"
        style={{ visibility: stepIndex >= 1 && stepIndex <= 6 ? "visible" : "hidden" }}
      >
        Step {inputActive} of 6
      </div>

      {/* disclaimer */}
      <div className="disc">
        <svg className="ico" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8h.01M11 12h1v4h1" />
        </svg>
        <div>
          <b>The AI proposes. Guardrails check it. You sign it.</b> Not financial advice. Capital at risk.
          Sparky can never move or withhold your funds.{" "}
          <a id="proveLink" onClick={openProveIt}>
            See what we can &amp; can&apos;t do
          </a>{" "}
          · <a>Exit anytime</a>
        </div>
      </div>

      {/* conversation */}
      <div className="stage" id="stage">
        <div className="stream" id="stream">
          {renderStream(stepIndex, answers, set, whyOpen, setWhyOpen, walletShort)}
        </div>
      </div>

      {/* sticky dock */}
      <div className="dock">
        <div className="dockinner" id="dock">
          {renderDock(stepIndex, answers, go, router.push, confirmPlan, saveState, saveHint)}
        </div>
      </div>
    </>
  );
}

/* ---------------- shared AI avatar mark ---------------- */
function SparkAvatar() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
      <path
        d="M12 1c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z"
        fill="var(--primary)"
      />
    </svg>
  );
}

function AiTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="turn ai">
      <div className="avatar">
        <SparkAvatar />
      </div>
      <div className="content">
        <div className="ai-name">Sparky AI</div>
        {children}
      </div>
    </div>
  );
}

function UserTurn({ text }: { text: string }) {
  return (
    <div className="turn user">
      <div className="bubble-user">{text}</div>
    </div>
  );
}

/* ---------------- option markup helpers ---------------- */
function OptCard({
  title,
  gloss,
  path,
  selected,
  onClick,
}: {
  title: string;
  gloss: string;
  path: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={"opt" + (selected ? " sel" : "")} onClick={onClick} type="button">
      <span className="oico">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={path} />
        </svg>
      </span>
      <span>
        <span className="otitle">{title}</span>
        <span className="ogloss">{gloss}</span>
      </span>
    </button>
  );
}

function GoalCard({
  title,
  gloss,
  hint,
  path,
  riskvar,
  selected,
  onClick,
}: {
  title: string;
  gloss: string;
  hint: string;
  path: string;
  riskvar: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={"opt" + (selected ? " sel" : "")} onClick={onClick} type="button">
      <span className="oico">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d={path} />
        </svg>
      </span>
      <span>
        <span className="otitle">{title}</span>
        <span className="ogloss">{gloss}</span>
        <span className="rhint">
          <span className="riskmeter">
            <i style={{ background: `var(${riskvar})` }} />
          </span>
          Risk {hint}
        </span>
      </span>
    </button>
  );
}

function Tchip({
  tt,
  ts,
  selected,
  onClick,
}: {
  tt: string;
  ts: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={"tchip" + (selected ? " sel" : "")} onClick={onClick} type="button">
      <div className="tt">{tt}</div>
      <div className="ts">{ts}</div>
    </button>
  );
}

function RiskOpt({
  title,
  gloss,
  selected,
  onClick,
}: {
  title: string;
  gloss: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={"opt" + (selected ? " sel" : "")} onClick={onClick} type="button">
      <span className="oico">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="9" />
        </svg>
      </span>
      <span>
        <span className="otitle">{title}</span>
        <span className="ogloss">{gloss}</span>
      </span>
    </button>
  );
}

/* ---------------- conversation stream ---------------- */
function renderStream(
  stepIndex: number,
  answers: Answers,
  set: (patch: Partial<Answers>) => void,
  whyOpen: boolean,
  setWhyOpen: (v: boolean) => void,
  walletShort: string | null,
): React.ReactNode {
  switch (stepIndex) {
    case 0:
      return (
        <AiTurn>
          <div className="ai-text">
            An AI fund manager that <span className="soft">can&apos;t hold your money.</span> Let&apos;s build your
            plan.
          </div>
          <div className="ai-sub">
            I read your wallet to personalize, suggest moves, and explain every one. You approve and sign each — and
            you can leave anytime, even if we&apos;re offline.
          </div>
          <div className="promises">
            <div className="promise">
              <span className="pico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 2l-2 2m-7.6 7.6a5 5 0 1 0-1 1L20 4l-2-2" />
                </svg>
              </span>
              You own your keys — we never generate or hold a wallet for you.
            </div>
            <div className="promise">
              <span className="pico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14l5-5-5-5m5 5H9" />
                </svg>
              </span>
              Withdraw anytime — even if Sparky is completely offline.
            </div>
            <div className="promise">
              <span className="pico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l8 4v6c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-4Z" />
                </svg>
              </span>
              The AI suggests; deterministic guardrails check; you sign.
            </div>
          </div>
        </AiTurn>
      );

    case 1:
      return (
        <>
          <UserTurn text="Get started" />
          <AiTurn>
            <div className="ai-text">
              {walletShort ? (
                <>
                  You&apos;re connected —{" "}
                  <span className="mono" style={{ color: "var(--foreground)" }}>
                    {walletShort}
                  </span>
                  .
                </>
              ) : (
                <>You&apos;re connected — your wallet&apos;s ready.</>
              )}
            </div>
            <div className="tip">
              <span className="tico">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l8 4v6c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6l8-4Z" />
                  <path d="M9 12l2 2 4-4" />
                </svg>
              </span>
              <div>
                <div className="ttl">You own your keys and your account.</div>
                <div className="tbd">
                  We never generate a wallet for you or hold your keys. We read your wallet to personalize your plan —
                  nothing moves without your signature.
                </div>
              </div>
            </div>
          </AiTurn>
        </>
      );

    case 2:
      return (
        <AiTurn>
          <div className="ai-text">How familiar are you with DeFi or crypto investing?</div>
          <div className="ai-sub">This just tunes how much detail I show. You can change it anytime.</div>
          <div className="opts row" id="optExp">
            <OptCard
              title="New"
              gloss="I'm just getting started"
              path="M12 20v-6m0 0V8m0 6h6m-6 0H6"
              selected={answers.experience === "New"}
              onClick={() => set({ experience: "New" })}
            />
            <OptCard
              title="Some"
              gloss="I've used a few apps"
              path="M3 12h4l3 8 4-16 3 8h4"
              selected={answers.experience === "Some"}
              onClick={() => set({ experience: "Some" })}
            />
            <OptCard
              title="Pro"
              gloss="I read contracts"
              path="M8 6l-6 6 6 6m8-12l6 6-6 6"
              selected={answers.experience === "Pro"}
              onClick={() => set({ experience: "Pro" })}
            />
          </div>
        </AiTurn>
      );

    case 3:
      return (
        <AiTurn>
          <div className="ai-text">What&apos;s your main goal right now?</div>
          <div className="opts grid2" id="optGoal">
            <GoalCard
              title="Grow my savings"
              gloss="Build steadily over time"
              hint="1–2 · Lower"
              path="M3 17l6-6 4 4 8-8"
              riskvar="--risk-2"
              selected={answers.goal === "Grow my savings"}
              onClick={() => set({ goal: "Grow my savings" })}
            />
            <GoalCard
              title="Steady yield"
              gloss="Earn predictable USDC yield"
              hint="1 · Lower"
              path="M4 12h16M4 12l3-3M4 12l3 3"
              riskvar="--risk-1"
              selected={answers.goal === "Steady yield"}
              onClick={() => set({ goal: "Steady yield" })}
            />
            <GoalCard
              title="Aggressive growth"
              gloss="Chase higher returns, more risk"
              hint="4–5 · Higher"
              path="M13 2L3 14h7l-1 8 10-12h-7l1-8Z"
              riskvar="--risk-5"
              selected={answers.goal === "Aggressive growth"}
              onClick={() => set({ goal: "Aggressive growth" })}
            />
            <GoalCard
              title="Reach a target"
              gloss="Hit a specific amount"
              hint="varies"
              path="M12 2v4m0 12v4m10-10h-4M6 12H2"
              riskvar="--risk-3"
              selected={answers.goal === "Reach a target"}
              onClick={() => set({ goal: "Reach a target" })}
            />
          </div>
        </AiTurn>
      );

    case 4:
      return (
        <AiTurn>
          <div className="ai-text">When might you need this money?</div>
          <div className="ai-sub">Longer horizons can usually take more ups and downs.</div>
          <div className="tchips" id="optTime">
            <Tchip
              tt="< 1 year"
              ts="Short term"
              selected={answers.timeline === "< 1 year"}
              onClick={() => set({ timeline: "< 1 year" })}
            />
            <Tchip
              tt="1–3 years"
              ts="Medium term"
              selected={answers.timeline === "1–3 years"}
              onClick={() => set({ timeline: "1–3 years" })}
            />
            <Tchip
              tt="3+ years"
              ts="Long term"
              selected={answers.timeline === "3+ years"}
              onClick={() => set({ timeline: "3+ years" })}
            />
          </div>
        </AiTurn>
      );

    case 5:
      return (
        <AiTurn>
          <div className="ai-text">Your $1,000 drops to $800 in a week. What do you do?</div>
          <div className="ai-sub">No right answer — this tells me how to set your risk, not test you.</div>
          <div className="opts col" id="optRisk">
            <RiskOpt
              title="Sell to stop the bleeding"
              gloss="Protect what's left"
              selected={answers.riskAns === "Sell to stop the bleeding"}
              onClick={() => set({ riskAns: "Sell to stop the bleeding", riskTier: 1 })}
            />
            <RiskOpt
              title="Hold and wait"
              gloss="Ride it out"
              selected={answers.riskAns === "Hold and wait"}
              onClick={() => set({ riskAns: "Hold and wait", riskTier: 2 })}
            />
            <RiskOpt
              title="Buy more while it's low"
              gloss="Lean in on the dip"
              selected={answers.riskAns === "Buy more while it's low"}
              onClick={() => set({ riskAns: "Buy more while it's low", riskTier: 4 })}
            />
          </div>
          <div className="tip">
            <span className="tico">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 8h.01M11 12h1v4h1" />
              </svg>
            </span>
            <div>
              <div className="ttl">What&apos;s volatility?</div>
              <div className="tbd">
                How much a value swings up and down over time. Higher volatility can mean bigger gains — and bigger
                drops.
              </div>
            </div>
          </div>
        </AiTurn>
      );

    case 6: {
      const t = answers.riskTier || 1;
      const rv = `var(--risk-${t})`;
      const goal = answers.goal || "steady USDC yield";
      return (
        <AiTurn>
          <div className="ai-text">
            Here&apos;s your plan — capital-preservation-first. You can adjust it anytime.
          </div>
          <div className="mandate" id="mandate">
            <div className="mhead">
              <span className="mtitle">Your mandate</span>
              <span
                className="riskbadge"
                id="rbadge"
                style={{
                  background: `var(--risk-${t}-subtle)`,
                  borderColor: `color-mix(in srgb,${rv} 30%,transparent)`,
                }}
              >
                <span className="riskmeter" id="rmeter">
                  {Array.from({ length: 5 }, (_, i) => (
                    <i key={i} style={{ background: i < t ? rv : "var(--border)" }} />
                  ))}
                </span>
                <span className="rname" id="rname" style={{ color: rv }}>
                  {TIER_NAMES[t]} · {t}/5
                </span>
              </span>
            </div>
            <div className="mpara" id="mpara">
              Your plan: <b>{TIER_NAMES[t]} ({t}/5)</b>, capital preservation first, target{" "}
              {goal.toLowerCase().includes("yield") ? "steady USDC yield" : "goal-aligned yield"}. The AI will only
              suggest moves that fit this. <b>You approve and sign each one.</b>
            </div>
            <div className="mslider">
              <div className="slabel">
                <span>Adjust your risk</span>
                <span id="sval">
                  {TIER_NAMES[t]} ({t}/5)
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="5"
                step="1"
                value={t}
                onChange={(e) => set({ riskTier: +e.target.value })}
                className="srange"
                id="rslider"
              />
            </div>
            <div className={"mwarn" + (t > 2 ? " show" : "")} id="mwarn">
              <span className="wico">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
                </svg>
              </span>
              <div>
                Only the Lower-risk Aave vault is live today. Higher-risk strategies will rank here as more vaults open
                — this is information, not a block.
              </div>
            </div>
            <div className="whythis">
              <button
                className="whytrig"
                id="whytrig"
                type="button"
                onClick={() => setWhyOpen(!whyOpen)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7M12 17h.01" />
                </svg>
                Why this profile?
              </button>
              <div className={"whybody" + (whyOpen ? " open" : "")} id="whybody">
                You chose to {answers.riskAns ? answers.riskAns.toLowerCase() : "hold through a drop"} after a 20% drop,
                with a {answers.timeline || "medium"} horizon. That maps to a {TIER_NAMES[t].toLowerCase()} profile —
                steady, capital-preservation-first.
              </div>
            </div>
          </div>
        </AiTurn>
      );
    }

    case 7:
      return (
        <>
          <UserTurn text="Set my plan" />
          <AiTurn>
            <div className="ai-text">Your plan&apos;s set. Here&apos;s the first move I&apos;d suggest — tied to your goal.</div>
            <div className="reccard" id="reccard">
              <div className="rechead">
                <span className="rankbadge">Best fit · #1 vs your goal</span>
                <span className="badge badge-ai">AI suggestion — you approve &amp; sign</span>
                <span
                  className="badge"
                  style={{
                    background: "var(--caution-subtle, color-mix(in srgb,var(--caution) 12%,transparent))",
                    color: "var(--caution)",
                    borderColor: "color-mix(in srgb,var(--caution) 30%,transparent)",
                  }}
                >
                  Example — not a live quote
                </span>
              </div>
              <div className="recthesis">
                Move your idle USDC into the <b>Aave Yield Vault</b>. It fits your plan — lower risk,
                capital-preservation-first, steady yield.
              </div>
              <div className="recrow">
                <div className="recapy">
                  <span className="big tnum">
                    4.3%
                    <span className="cite" id="apycite">Example</span>
                  </span>
                  <span className="lbl">
                    net APY · <span className="estnote">example figure — your live rate is read on-chain on the vault</span>
                  </span>
                </div>
                <div>
                  <div style={{ fontSize: "11.5px", color: "var(--muted-foreground)", marginBottom: "6px" }}>
                    Risk tier
                  </div>
                  <span
                    className="riskbadge"
                    style={{
                      background: "var(--risk-1-subtle)",
                      borderColor: "color-mix(in srgb,var(--risk-1) 30%,transparent)",
                    }}
                  >
                    <span className="riskmeter">
                      <i style={{ background: "var(--risk-1)" }} />
                      <i />
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="rname" style={{ color: "var(--risk-1)" }}>
                      Lower · 1/5
                    </span>
                  </span>
                </div>
              </div>
              <div style={{ fontSize: "12px", color: "var(--muted-foreground)", marginBottom: "14px" }}>
                Example figures for this walkthrough — your real, on-chain APY (net of Sparky&apos;s 0% fee on
                principal) is shown live on the vault.
              </div>
              <div className="recact">
                <button className="btn btn-primary btn-md" type="button">
                  Review this move
                </button>
                <button className="btn btn-ghost btn-md" type="button">
                  Not now
                </button>
              </div>
            </div>
          </AiTurn>
        </>
      );

    case 8:
      return (
        <div className="turn" style={{ opacity: 1, justifyContent: "center" }}>
          <div className="complete">
            <div className="checkwrap" id="cwrap">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="var(--gain)" strokeWidth="2.5" id="cmark">
                <path d="M5 13l4 4L19 7" strokeDasharray="26" strokeDashoffset="0" />
              </svg>
            </div>
            <div className="t-h1">Your plan is set.</div>
            <div className="t-base" style={{ color: "var(--muted-foreground)", maxWidth: "420px" }}>
              {TIER_NAMES[answers.riskTier || 1]} ({answers.riskTier || 1}/5),{" "}
              {(answers.goal ?? "steady USDC yield").toLowerCase()}. The AI will suggest; you approve and sign. Change
              any of this anytime in Settings.
            </div>
          </div>
        </div>
      );

    default:
      return null;
  }
}

/* ---------------- sticky dock (per-step CTAs) ---------------- */
function renderDock(
  stepIndex: number,
  answers: Answers,
  go: (n: number) => void,
  push: (href: string) => void,
  confirmPlan: () => Promise<boolean>,
  saveState: SaveState,
  /** Pre-resolved dock copy for the current save state (see `mandateSaveHint`). */
  saveHint: string,
): React.ReactNode {
  switch (stepIndex) {
    case 0:
      return (
        <>
          <span className="hint">Takes about 3 minutes.</span>
          <button className="btn btn-outline btn-lg" type="button">
            How this works
          </button>
          <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => go(1)}>
            Get started
          </button>
        </>
      );

    case 1:
      return (
        <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => go(2)}>
          Continue
        </button>
      );

    case 2:
      return answers.experience ? (
        <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => go(3)}>
          Continue
        </button>
      ) : (
        <span className="hint">Pick one to continue</span>
      );

    case 3:
      return answers.goal ? (
        <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => go(4)}>
          Continue
        </button>
      ) : (
        <span className="hint">Pick one to continue</span>
      );

    case 4:
      return answers.timeline ? (
        <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => go(5)}>
          Continue
        </button>
      ) : (
        <span className="hint">Pick one to continue</span>
      );

    case 5:
      return answers.riskAns ? (
        <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => go(6)}>
          See my plan
        </button>
      ) : (
        <span className="hint">Choose what feels honest</span>
      );

    case 6:
      return (
        <>
          <span className="hint">{saveHint}</span>
          <button
            className="btn btn-outline btn-lg"
            type="button"
            onClick={() => document.getElementById("rslider")?.focus()}
          >
            Adjust
          </button>
          <button
            className="btn btn-primary btn-lg"
            id="pcta"
            type="button"
            disabled={saveState === "saving"}
            onClick={async () => {
              const ok = await confirmPlan();
              if (ok) go(7);
            }}
          >
            {saveState === "saving" ? "Saving…" : saveState === "error" ? "Try again" : "Set my plan"}
          </button>
        </>
      );

    case 7:
      return (
        <>
          <button className="btn btn-ghost btn-lg" type="button">
            Not now
          </button>
          <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => go(8)}>
            Continue to chat
          </button>
        </>
      );

    case 8:
      return (
        <>
          <button className="btn btn-outline btn-lg" type="button">
            View my plan
          </button>
          <button className="btn btn-primary btn-lg" id="pcta" type="button" onClick={() => push("/chat")}>
            Go to chat
          </button>
        </>
      );

    default:
      return null;
  }
}
