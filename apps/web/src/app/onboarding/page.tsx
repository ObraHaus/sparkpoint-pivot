"use client";

/**
 * /onboarding — stepped onboarding SKELETON (SCAFFOLD / DEMO).
 *
 * Faithful to the design's intent (docs/design-handover/showcase/flows/
 * Onboarding.html): a chat-driven flow that turns a goal + risk tolerance into a
 * personal mandate, then previews the first recommendation. This is a clean,
 * navigable skeleton — not a pixel-perfect port, and with NO real auth/wallet.
 *
 * State is driven by useState: a step index (1..6) plus the user's goal/risk picks.
 * Back/Continue move between steps; the final step navigates into the app.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  PiggyBank,
  Sprout,
  Shield,
  TrendingDown,
  Minus,
  TrendingUp,
  Info,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TOTAL_STEPS = 6;

/** Goal chips (step 2). */
const GOALS = [
  {
    id: "grow",
    label: "Grow savings",
    gloss: "Build steadily over time",
    icon: PiggyBank,
  },
  {
    id: "yield",
    label: "Earn yield",
    gloss: "Earn predictable USDC yield",
    icon: Sprout,
  },
  {
    id: "preserve",
    label: "Preserve capital",
    gloss: "Protect what you have first",
    icon: Shield,
  },
] as const;

/** Risk options (step 3). */
const RISKS = [
  {
    id: "lower",
    label: "Lower",
    gloss: "Protect what's left",
    scenario: "If your $1,000 dropped to $800, you'd sell to stop the bleeding.",
    icon: TrendingDown,
  },
  {
    id: "moderate",
    label: "Moderate",
    gloss: "Ride it out",
    scenario: "If your $1,000 dropped to $800, you'd hold and wait it out.",
    icon: Minus,
  },
  {
    id: "higher",
    label: "Higher",
    gloss: "Lean in on the dip",
    scenario: "If your $1,000 dropped to $800, you'd buy more while it's low.",
    icon: TrendingUp,
  },
] as const;

type GoalId = (typeof GOALS)[number]["id"];
type RiskId = (typeof RISKS)[number]["id"];

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [goal, setGoal] = useState<GoalId | null>(null);
  const [risk, setRisk] = useState<RiskId | null>(null);

  const back = () => setStep((s) => Math.max(1, s - 1));
  const next = () => setStep((s) => Math.min(TOTAL_STEPS, s + 1));

  // Continue is gated on the steps that require a choice.
  const canContinue =
    (step !== 2 || goal !== null) && (step !== 3 || risk !== null);

  const goalLabel = GOALS.find((g) => g.id === goal)?.label ?? "—";
  const riskLabel = RISKS.find((r) => r.id === risk)?.label ?? "—";

  return (
    <div className="flex flex-col">
      {/* Stepper indicator */}
      <div className="mb-6">
        <div className="flex items-center gap-2">
          {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
            <div
              key={n}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                n <= step ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </div>
        <p className="tnum mt-2 text-xs text-muted-foreground">
          Step {step} of {TOTAL_STEPS}
        </p>
      </div>

      {/* Step body */}
      <div className="min-h-[320px]">
        {step === 1 && <StepWelcome />}
        {step === 2 && <StepGoal goal={goal} onPick={setGoal} />}
        {step === 3 && <StepRisk risk={risk} onPick={setRisk} />}
        {step === 4 && <StepMandate goalLabel={goalLabel} riskLabel={riskLabel} />}
        {step === 5 && <StepRecommendation />}
        {step === 6 && <StepDone />}
      </div>

      {/* Footer nav — Back / Continue (or Enter on the last step) */}
      <div className="mt-8 flex items-center justify-between border-t border-border-soft pt-5">
        <button
          type="button"
          onClick={back}
          disabled={step === 1}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[var(--radius)] px-3 py-2 text-sm font-medium transition",
            step === 1
              ? "cursor-not-allowed text-muted-foreground/40"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <ArrowLeft size={15} />
          Back
        </button>

        {step < TOTAL_STEPS ? (
          <button
            type="button"
            onClick={next}
            disabled={!canContinue}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition",
              canContinue ? "hover:opacity-90" : "cursor-not-allowed opacity-50",
            )}
          >
            Continue
            <ArrowRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => router.push("/chat")}
            className="inline-flex items-center gap-1.5 rounded-[var(--radius)] bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90"
          >
            Enter SparkPoint
            <ArrowRight size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Step 1 — Welcome + non-custodial promise ---------------- */
function StepWelcome() {
  const promises = [
    "You own your keys — we never generate or hold a wallet for you.",
    "Withdraw anytime — even if SparkPoint is completely offline.",
    "The AI suggests; deterministic guardrails check; you sign.",
  ];
  return (
    <div>
      <p className="eyebrow">Welcome</p>
      <h1 className="t-h1 mt-2">
        An AI fund manager that <span className="brand-gradient-text">can&apos;t hold your money.</span>
      </h1>
      <p className="mt-3 max-w-[560px] text-sm leading-relaxed text-muted-foreground">
        Let&apos;s build your plan. SparkPoint reads your wallet to personalize, suggests
        moves, and explains every one. You approve and sign each &mdash; and you can
        leave anytime, even if we&apos;re offline.
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        {promises.map((p) => (
          <li key={p} className="flex items-center gap-3 text-sm text-foreground">
            <span className="flex size-7 flex-none items-center justify-center rounded-[9px] bg-[var(--spark-subtle)] text-primary">
              <Check size={15} />
            </span>
            {p}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------------- Step 2 — Your goal ---------------- */
function StepGoal({
  goal,
  onPick,
}: {
  goal: GoalId | null;
  onPick: (id: GoalId) => void;
}) {
  return (
    <div>
      <p className="eyebrow">Your goal</p>
      <h2 className="t-h2 mt-2">What&apos;s your main goal right now?</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick one &mdash; you can change it anytime in Settings.
      </p>

      <div className="mt-6 flex flex-wrap gap-3">
        {GOALS.map((g) => {
          const Icon = g.icon;
          const selected = goal === g.id;
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onPick(g.id)}
              aria-pressed={selected}
              className={cn(
                "flex min-w-[180px] flex-1 items-start gap-3 rounded-[var(--radius)] border bg-card p-4 text-left transition",
                selected
                  ? "border-primary ring-2 ring-[var(--spark-subtle)] bg-card-2"
                  : "border-border hover:border-primary/55 hover:bg-card-2",
              )}
            >
              <span
                className={cn(
                  "flex size-9 flex-none items-center justify-center rounded-[9px] transition",
                  selected
                    ? "bg-[var(--spark-subtle)] text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon size={18} />
              </span>
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  {g.label}
                </span>
                <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
                  {g.gloss}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Step 3 — Risk tolerance ---------------- */
function StepRisk({
  risk,
  onPick,
}: {
  risk: RiskId | null;
  onPick: (id: RiskId) => void;
}) {
  return (
    <div>
      <p className="eyebrow">Risk tolerance</p>
      <h2 className="t-h2 mt-2">Your $1,000 drops to $800 in a week. What do you do?</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        No right answer &mdash; this tells me how to set your risk, not test you.
      </p>

      <div className="mt-6 flex flex-col gap-3">
        {RISKS.map((r) => {
          const Icon = r.icon;
          const selected = risk === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => onPick(r.id)}
              aria-pressed={selected}
              className={cn(
                "flex w-full items-start gap-3 rounded-[var(--radius)] border bg-card p-4 text-left transition",
                selected
                  ? "border-primary ring-2 ring-[var(--spark-subtle)] bg-card-2"
                  : "border-border hover:border-primary/55 hover:bg-card-2",
              )}
            >
              <span
                className={cn(
                  "flex size-9 flex-none items-center justify-center rounded-[9px] transition",
                  selected
                    ? "bg-[var(--spark-subtle)] text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                <Icon size={18} />
              </span>
              <span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {r.label}
                  </span>
                  <span className="text-xs text-muted-foreground">&middot; {r.gloss}</span>
                </span>
                <span className="mt-1 block text-xs leading-snug text-muted-foreground">
                  {r.scenario}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------- Step 4 — Your mandate (summary) ---------------- */
function StepMandate({
  goalLabel,
  riskLabel,
}: {
  goalLabel: string;
  riskLabel: string;
}) {
  return (
    <div>
      <p className="eyebrow">Your mandate</p>
      <h2 className="t-h2 mt-2">Here&apos;s your plan</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Capital-preservation-first. You can adjust it anytime.
      </p>

      <div className="card mt-6 p-5">
        <dl className="flex flex-col divide-y divide-border-soft">
          <div className="flex items-center justify-between py-3 first:pt-0">
            <dt className="text-sm text-muted-foreground">Goal</dt>
            <dd className="text-sm font-semibold text-foreground">{goalLabel}</dd>
          </div>
          <div className="flex items-center justify-between py-3">
            <dt className="text-sm text-muted-foreground">Risk tolerance</dt>
            <dd className="text-sm font-semibold text-foreground">{riskLabel}</dd>
          </div>
          <div className="flex items-center justify-between py-3 last:pb-0">
            <dt className="text-sm text-muted-foreground">Custody</dt>
            <dd className="text-sm font-semibold text-gain">Self-custodial</dd>
          </div>
        </dl>

        <div className="mt-4 flex items-start gap-2.5 rounded-[var(--radius)] bg-[var(--info-subtle)] p-3 text-xs leading-relaxed text-muted-foreground">
          <Info size={15} className="mt-0.5 flex-none text-[var(--info)]" />
          <span>
            The AI will only suggest moves that fit this mandate.{" "}
            <span className="font-semibold text-foreground">
              You approve and sign each one.
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Step 5 — First recommendation ---------------- */
function StepRecommendation() {
  return (
    <div>
      <p className="eyebrow">First recommendation</p>
      <h2 className="t-h2 mt-2">The first move I&apos;d suggest</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Tied to your goal &mdash; you approve and sign before anything happens.
      </p>

      <div className="card mt-6 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-semibold text-foreground">
            Best fit &middot; #1 vs your goal
          </span>
          <span className="badge-ai bg-[var(--spark-subtle)] text-primary">
            <Sparkles size={11} />
            AI suggestion &mdash; you approve &amp; sign
          </span>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-foreground">
          Move your idle USDC into the{" "}
          <span className="font-semibold">Aave Yield Vault</span>. It fits your plan
          &mdash; lower risk, capital-preservation-first, steady yield.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-8">
          <div className="flex flex-col gap-0.5">
            <span className="tnum text-[28px] font-semibold leading-none text-foreground">
              3.87%
            </span>
            <span className="text-[11.5px] text-muted-foreground">net APY</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-foreground">
              Fee only on profit
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              0% on principal &middot; high-water mark
            </span>
          </div>
        </div>

        <p className="mt-4 text-[11.5px] text-muted-foreground">
          Estimates, not guarantees. Not financial advice &mdash; capital at risk.
        </p>
      </div>
    </div>
  );
}

/* ---------------- Step 6 — Done ---------------- */
function StepDone() {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="flex size-16 items-center justify-center rounded-full bg-[var(--gain-subtle)]">
        <Check size={30} className="text-gain" />
      </span>
      <h2 className="t-h1 mt-4">Your plan is set.</h2>
      <p className="mt-3 max-w-[420px] text-sm leading-relaxed text-muted-foreground">
        Lower risk, steady USDC yield. The AI will suggest; you approve and sign.
        Change any of this anytime in Settings.
      </p>
    </div>
  );
}
