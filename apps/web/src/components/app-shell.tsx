"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  MessageSquare, PieChart, TrendingUp, Landmark, ArrowLeftRight, ShieldCheck,
  GraduationCap, Settings, LogOut, ChevronDown, Wallet, Receipt, Crown, ListChecks, Coins, Info,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

const PRIMARY_NAV = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/portfolio", label: "Portfolio", icon: PieChart },
  { href: "/strategies", label: "Strategies", icon: TrendingUp },
  { href: "/vault", label: "Vault", icon: Landmark },
  { href: "/bridge", label: "Bridge", icon: ArrowLeftRight },
  { href: "/trust", label: "Trust", icon: ShieldCheck },
] as const;

const MENU_NAV = [
  { href: "/fees", label: "Fees", icon: Receipt },
  { href: "/premium", label: "Premium", icon: Crown },
  { href: "/outcomes", label: "Outcomes", icon: ListChecks },
  { href: "/srk", label: "SRK", icon: Coins },
  { href: "/learn", label: "Learn", icon: GraduationCap },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

function SparkMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <defs>
        <linearGradient id="spk" x1="3" y1="2" x2="21" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4D83FF" />
          <stop offset=".5" stopColor="#38C6F4" />
          <stop offset=".8" stopColor="#F5B62E" />
          <stop offset="1" stopColor="#F2683C" />
        </linearGradient>
      </defs>
      <path d="M12 1c.6 5.4 2.6 7.4 8 8-5.4.6-7.4 2.6-8 8-.6-5.4-2.6-7.4-8-8 5.4-.6 7.4-2.6 8-8Z" fill="url(#spk)" />
    </svg>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="flex min-h-screen flex-col">
      {/* ---- top bar ---- */}
      <header className="flex h-14 flex-none items-center gap-3 border-b border-border-soft bg-card px-4 sm:px-5">
        <Link href="/chat" className="flex items-center gap-2 font-semibold">
          <SparkMark />
          <span className="hidden sm:inline">SparkPoint</span>
        </Link>

        <nav className="ml-4 hidden items-center gap-1 lg:flex">
          {PRIMARY_NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition",
                isActive(n.href)
                  ? "bg-[var(--spark-subtle)] text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex-1" />

        {/* fully self-custodial badge */}
        <Link
          href="/trust/permissions"
          className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary md:inline-flex"
        >
          <span className="size-1.5 rounded-full bg-gain" />
          Fully self-custodial
        </Link>

        {/* network switcher (stub) */}
        <button className="hidden items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-primary sm:inline-flex">
          <span className="size-2 rounded-full" style={{ background: "#0052FF" }} />
          Base
          <ChevronDown size={13} className="text-muted-foreground" />
        </button>

        {/* wallet pill (stub) */}
        <button className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-[var(--primary-hover)]">
          <Wallet size={14} />
          <span className="hidden sm:inline">Connect</span>
        </button>

        {/* user menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex size-8 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold hover:border-primary"
            aria-label="Account menu"
            aria-expanded={menuOpen}
          >
            SP
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-10 z-40 w-56 rounded-lg border border-border bg-popover p-1.5 shadow-[var(--shadow-md)]">
                <div className="px-2.5 py-2 text-xs text-muted-foreground">SparkPoint user</div>
                {MENU_NAV.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-foreground hover:bg-muted"
                  >
                    <n.icon size={16} /> {n.label}
                  </Link>
                ))}
                <div className="my-1 border-t border-border-soft" />
                {/* theme toggle — between Learn and Log out, per the design */}
                <ThemeToggle />
                <div className="my-1 border-t border-border-soft" />
                <button className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-loss hover:bg-muted">
                  <LogOut size={16} /> Log out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {/* ---- disclaimer strip ---- */}
      <div className="flex flex-none items-center gap-2 border-b border-border-soft bg-[var(--card-2)] px-4 py-2 text-xs text-muted-foreground sm:px-5">
        <Info size={14} className="flex-none" />
        <p className="leading-snug">
          <b className="text-foreground">The AI proposes. Guardrails check it. You sign it.</b>{" "}
          Not financial advice. Capital at risk. SparkPoint can never move or withhold your funds.{" "}
          <Link href="/trust/permissions" className="text-primary hover:underline">See what we can &amp; can&apos;t do</Link>
          {" · "}
          <Link href="/trust/exit" className="text-primary hover:underline">Exit anytime</Link>
        </p>
      </div>

      {/* ---- body: rail (desktop) + content ---- */}
      <div className="flex flex-1">
        <aside className="hidden w-56 flex-none border-r border-border-soft bg-card p-3 lg:block">
          <nav className="space-y-1">
            {PRIMARY_NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition",
                  isActive(n.href)
                    ? "bg-[var(--spark-subtle)] text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <n.icon size={17} /> {n.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="flex-1 overflow-x-hidden p-4 pb-24 sm:p-6 lg:pb-6">{children}</main>
      </div>

      {/* ---- mobile bottom tabs ---- */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex items-stretch border-t border-border-soft bg-card lg:hidden">
        {PRIMARY_NAV.slice(0, 5).map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2 text-[11px] font-medium transition",
              isActive(n.href) ? "text-primary" : "text-muted-foreground"
            )}
          >
            <n.icon size={18} /> {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
