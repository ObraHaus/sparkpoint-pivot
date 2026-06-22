import Link from "next/link";
import {
  ArrowLeftRight,
  ArrowRight,
  Receipt,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SparkMark } from "@/components/spark-mark";
import { ThemeToggle } from "@/components/theme-toggle";

/* ---------------------------------------------------------------------------
   Public marketing landing — no app shell. Themed light + dark.
   A clean static hero (no GSAP/canvas) faithful to the design's INTENT.
   --------------------------------------------------------------------------- */

const VALUE_PROPS: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: ShieldCheck,
    title: "Fully self-custodial",
    body: "Your keys, your funds — always. The protocol can never hold, move, or lose your money. Withdraw anytime.",
  },
  {
    icon: Sparkles,
    title: "AI is the fund manager",
    body: "An AI that reads the market, your wallet, and your goals — then proposes every move in plain language. You approve and sign.",
  },
  {
    icon: Receipt,
    title: "Fee only on profit",
    body: "0% on your principal. 10% on yield over a high-water mark — we only earn when you do.",
  },
  {
    icon: ArrowLeftRight,
    title: "Multi-network",
    body: "An AI-managed Aave Yield Vault on Base today, with Sui as the next network on the roadmap.",
  },
];

/** Primary filled button styled with brand tokens. */
function PrimaryButton({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[11px] bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** Secondary outline/ghost button. */
function GhostButton({
  href,
  children,
  className,
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-[11px] border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition hover:border-primary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
    >
      {children}
    </Link>
  );
}

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* ---- Public top bar ---- */}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-4 border-b border-border-soft bg-background/80 px-5 backdrop-blur sm:px-7">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <SparkMark size={23} />
          <span className="text-base">SparkPoint</span>
        </Link>
        <div className="flex-1" />
        <ThemeToggle variant="icon" />
        <PrimaryButton href="/connect">Launch app</PrimaryButton>
      </header>

      {/* ---- Hero ---- */}
      <main className="flex-1">
        <section className="relative overflow-hidden">
          {/* soft brand glow backdrop */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10"
            style={{
              background:
                "radial-gradient(60% 50% at 50% 0%, var(--spark-glow) 0%, transparent 70%)",
            }}
          />
          <div className="mx-auto max-w-4xl px-6 pb-16 pt-20 text-center sm:pt-28">
            <p className="eyebrow inline-flex items-center gap-2">
              <span className="ai-dot" aria-hidden />
              AI-Native Onchain Hedge Fund
            </p>
            <h1 className="t-display brand-gradient-text mx-auto mt-5 max-w-3xl text-balance text-[clamp(34px,6vw,60px)] leading-[1.05]">
              The First AI-Native Onchain Hedge Fund
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg leading-relaxed text-muted-foreground">
              A fully self-custodial, chat-based AI DeFi assistant + AI-managed Aave
              Yield Vault on Base — the protocol can never hold, move, or lose your
              money.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
              <PrimaryButton href="/connect" className="px-6 py-3.5 text-[15px]">
                Launch app
                <ArrowRight size={17} />
              </PrimaryButton>
              <GhostButton href="/chat" className="px-6 py-3.5 text-[15px]">
                Explore the app
              </GhostButton>
            </div>
          </div>
        </section>

        {/* ---- Value props ---- */}
        <section className="mx-auto max-w-6xl px-6 pb-24">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {VALUE_PROPS.map(({ icon: Icon, title, body }) => (
              <div key={title} className="card flex flex-col p-6">
                <span className="grid size-11 place-items-center rounded-xl bg-[var(--spark-subtle)] text-primary">
                  <Icon size={20} />
                </span>
                <h3 className="t-h3 mt-4">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>
      </main>

      {/* ---- Footer ---- */}
      <footer className="border-t border-border-soft">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-8 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <SparkMark size={20} />
            <span className="text-sm font-semibold">SparkPoint</span>
            <span className="text-xs text-muted-foreground">
              · The First AI-Native Onchain Hedge Fund
            </span>
          </div>
          <div className="flex flex-col items-start gap-1 sm:items-end">
            <Link
              href="/admin"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
            >
              Internal · Admin panel
              <ArrowRight size={13} />
            </Link>
            <span className="text-[11px] text-muted-foreground/80">
              scaffold — internal, no auth yet
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
