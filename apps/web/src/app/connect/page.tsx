"use client";

/**
 * /connect — simulated wallet connect / login screen (SCAFFOLD / DEMO).
 *
 * Faithful to the design's "connect" route intent (docs/design-handover/showcase/
 * screens/public.js) but standalone: its own minimal chrome, no app shell.
 *
 * NOTE: This is a demo scaffold — there is NO real wallet connection or auth yet.
 * Each wallet option simply simulates a first sign-in by navigating to /onboarding.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronRight, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SparkMark } from "@/components/spark-mark";
import { ThemeToggle } from "@/components/theme-toggle";

/** Wallet options — dummy icons (brand-tinted tiles), no real connectors wired. */
const WALLETS = [
  { name: "Coinbase Wallet", tile: "#0052FF", glyph: "CB" },
  { name: "WalletConnect", tile: "#3396FF", glyph: "WC" },
  { name: "MetaMask", tile: "#16202E", glyph: "MM" },
] as const;

export default function ConnectPage() {
  const router = useRouter();

  // DEMO: simulate a first-time sign-in. No real wallet handshake yet.
  const connect = () => router.push("/onboarding");

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      {/* Minimal top bar — brand + back + theme toggle */}
      <header className="flex h-16 flex-none items-center gap-4 border-b border-border-soft px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold">
          <SparkMark size={22} />
          <span>SparkPoint</span>
        </Link>
        <div className="flex-1" />
        <Link
          href="/"
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft size={15} />
          Back
        </Link>
        <ThemeToggle variant="icon" />
      </header>

      {/* Centered connect card */}
      <main className="flex flex-1 items-center justify-center p-6">
        <div className="card w-full max-w-[420px] p-8 shadow-md">
          <div className="mb-2 flex justify-center">
            <SparkMark size={34} />
          </div>

          <h1 className="t-h2 text-center">Connect your wallet</h1>
          <p className="mx-auto mt-2 max-w-[340px] text-center text-sm leading-relaxed text-muted-foreground">
            Fully self-custodial &mdash; you keep your keys; SparkPoint never holds
            your funds.
          </p>

          {/* Wallet options (dummy) */}
          <div className="mt-6 flex flex-col gap-2.5">
            {WALLETS.map((w) => (
              <button
                key={w.name}
                type="button"
                onClick={connect}
                className={cn(
                  "group flex items-center gap-3.5 rounded-[var(--radius)] border border-border bg-background p-3.5",
                  "text-left transition hover:border-primary hover:bg-card-2",
                )}
              >
                <span
                  className="flex size-9 flex-none items-center justify-center rounded-[10px] text-[11px] font-semibold tracking-wide text-white"
                  style={{ background: w.tile }}
                  aria-hidden
                >
                  {w.glyph}
                </span>
                <span className="flex-1 text-sm font-semibold">{w.name}</span>
                <ChevronRight
                  size={16}
                  className="text-muted-foreground transition group-hover:text-foreground"
                />
              </button>
            ))}
          </div>

          {/* Reassurance */}
          <div className="mt-5 flex items-start gap-2.5 rounded-[var(--radius)] bg-[var(--spark-subtle)] p-3 text-xs leading-relaxed text-muted-foreground">
            <ShieldCheck size={16} className="mt-0.5 flex-none text-primary" />
            <span>
              You own your keys and your account. We never generate a wallet for you
              or hold your keys.
            </span>
          </div>

          {/* Base network note */}
          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span className="size-2.5 flex-none rounded-full bg-[#0052FF]" aria-hidden />
            Base network
          </div>

          {/* Scaffold marker */}
          <p className="mt-3 text-center text-[11px] text-muted-foreground/70">
            Demo scaffold &mdash; no real wallet connection yet.
          </p>
        </div>
      </main>

      {/* Returning users → straight to the app */}
      <footer className="flex-none pb-8 text-center">
        <Link
          href="/chat"
          className="text-xs text-muted-foreground transition hover:text-foreground"
        >
          Returning? Skip to the app
        </Link>
      </footer>
    </div>
  );
}
