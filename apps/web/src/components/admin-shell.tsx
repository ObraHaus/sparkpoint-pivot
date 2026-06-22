"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  LayoutGrid, Users, Activity, Landmark, TrendingUp, ShieldCheck,
  PauseOctagon, SlidersHorizontal, ScrollText, ChevronDown, Check, Lock, AlertTriangle,
} from "lucide-react";
import { SparkMark } from "@/components/spark-mark";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------------------------
   Admin / stakeholder panel shell — a DISTINCT surface from the app shell.
   Reachable directly at /admin (no auth gate yet — scaffold).
   Mirrors docs/admin-panel/design-spec.md §2.1: a plain non-sticky ops bar
   (NO position:sticky, NO transform), a role-scoped left sidebar, and a
   persistent observe-only / read-only-over-funds posture.
   --------------------------------------------------------------------------- */

const PRIMARY_NAV = [
  { href: "/admin", label: "Overview", icon: LayoutGrid },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/usage", label: "Usage", icon: Activity },
  { href: "/admin/tvl", label: "TVL & Vaults", icon: Landmark },
  { href: "/admin/revenue", label: "Revenue", icon: TrendingUp, star: true },
  { href: "/admin/system", label: "System", icon: ShieldCheck },
  { href: "/admin/killswitch", label: "Kill-switch", icon: PauseOctagon },
] as const;

const ADMIN_NAV = [
  { href: "/admin/config", label: "Config", icon: SlidersHorizontal },
  { href: "/admin/audit", label: "Audit", icon: ScrollText },
] as const;

const ROLES = ["Super-Admin", "Ops", "Stakeholder", "Client"] as const;
type Role = (typeof ROLES)[number];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [role, setRole] = useState<Role>("Super-Admin");
  const [roleOpen, setRoleOpen] = useState(false);

  // /admin must match exactly; sub-routes match by prefix.
  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname === href || pathname.startsWith(href + "/");

  const NavLink = ({ item }: { item: { href: string; label: string; icon: typeof Users; star?: boolean } }) => {
    const active = isActive(item.href);
    return (
      <Link
        href={item.href}
        onClick={() => setNavOpen(false)}
        className={cn(
          "flex items-center gap-2.5 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition",
          active
            ? "border-primary bg-[var(--spark-subtle)] text-foreground"
            : "border-transparent text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <item.icon size={17} className={cn("flex-none", active && "text-primary")} />
        <span className="flex-1">{item.label}</span>
        {item.star && <span className="text-xs text-primary">★</span>}
      </Link>
    );
  };

  const sidebar = (
    <nav className="space-y-1">
      {PRIMARY_NAV.map((n) => (
        <NavLink key={n.href} item={n} />
      ))}
      <div className="eyebrow px-3 pt-4 pb-1">Admin</div>
      {ADMIN_NAV.map((n) => (
        <NavLink key={n.href} item={n} />
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* ---- ops bar: plain, NON-sticky, NO transform (design §2.1) ---- */}
      <header className="relative flex flex-wrap items-center gap-3 border-b border-border-soft bg-card px-4 py-2.5 sm:px-5">
        {/* mobile sidebar toggle */}
        <button
          type="button"
          onClick={() => setNavOpen((v) => !v)}
          aria-label="Toggle navigation"
          aria-expanded={navOpen}
          className="inline-flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground hover:border-primary hover:text-foreground lg:hidden"
        >
          <LayoutGrid size={16} />
        </button>

        <Link href="/admin" className="flex items-center gap-2 font-semibold">
          <SparkMark />
          <span>SparkPoint Admin</span>
        </Link>

        {/* persistent observe-only chip */}
        <span
          title="This panel can watch SparkPoint and propose & sign a pause — but it cannot move a single unit of user funds. The kill-switch is pause-only and never blocks withdrawals; execution requires the on-chain 2-of-3 multisig threshold, not this panel."
          className="hidden items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--info)_26%,transparent)] bg-[var(--info-subtle)] px-3 py-1.5 text-xs font-semibold text-info md:inline-flex"
        >
          <Lock size={13} />
          Observe-only · read-only over funds
        </span>

        <div className="flex-1" />

        {/* "View as" role switcher — scaffold only (relabels the displayed role) */}
        <div className="relative flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">View as</span>
          <button
            type="button"
            onClick={() => setRoleOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={roleOpen}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground hover:border-primary"
          >
            <span className="max-w-[7.5rem] truncate">{role}</span>
            <ChevronDown size={13} className={cn("text-muted-foreground transition", roleOpen && "rotate-180")} />
          </button>
          {roleOpen && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setRoleOpen(false)} />
              <div
                role="listbox"
                className="absolute right-0 top-9 z-40 w-44 rounded-lg border border-border bg-popover p-1.5 shadow-[var(--shadow-md)]"
              >
                {ROLES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="option"
                    aria-selected={r === role}
                    onClick={() => {
                      setRole(r);
                      setRoleOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-muted",
                      r === role ? "font-semibold text-primary" : "text-foreground"
                    )}
                  >
                    <span className="flex-1 text-left">{r}</span>
                    {r === role && <Check size={14} />}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <ThemeToggle variant="icon" />
      </header>

      {/* ---- body: sidebar (desktop) + content ---- */}
      <div className="flex flex-1">
        {/* desktop sidebar */}
        <aside className="hidden w-56 flex-none border-r border-border-soft bg-card p-3 lg:block">
          {sidebar}
        </aside>

        {/* mobile drawer */}
        {navOpen && (
          <>
            <div className="fixed inset-0 z-30 bg-black/55 lg:hidden" onClick={() => setNavOpen(false)} />
            <aside className="fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto border-r border-border-soft bg-card p-3 shadow-[var(--shadow-lg)] lg:hidden">
              {sidebar}
            </aside>
          </>
        )}

        <main className="min-w-0 flex-1 overflow-x-hidden p-4 sm:p-6">
          {/* scaffold caution banner */}
          <div className="mb-6 flex items-start gap-2.5 rounded-lg border border-[color-mix(in_srgb,var(--caution)_28%,transparent)] bg-[var(--caution-subtle)] px-4 py-3 text-sm text-caution">
            <AlertTriangle size={16} className="mt-0.5 flex-none" />
            <p className="leading-snug">
              <b>Scaffold — no authentication or authorization yet.</b> This panel is reachable directly
              at <span className="mono">/admin</span>; real admin SSO + RBAC are pending. Read-only over
              funds by design.
            </p>
          </div>

          {children}
        </main>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   AdminStub — a local skeleton for admin routes (heading + subtitle + note).
   --------------------------------------------------------------------------- */
export function AdminStub({
  title,
  subtitle,
  note,
}: {
  title: string;
  subtitle: string;
  note?: string;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="t-h1">{title}</h1>
      <p className="mt-1 text-muted-foreground">{subtitle}</p>
      <div className="card mt-6 p-6">
        <span className="badge-ai">Scaffold</span>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          {note ??
            "Scaffolded admin route — theme, tokens, and the admin shell are wired. The high-fidelity design lives in docs/admin-panel/design-spec.md; port it here next. Observe-only: no fund-moving controls."}
        </p>
      </div>
    </div>
  );
}
