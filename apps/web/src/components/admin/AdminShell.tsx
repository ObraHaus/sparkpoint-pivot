"use client";

/**
 * AdminShell — the Sparky Ops / stakeholder panel shell.
 * Distinct from the main app shell. Faithful 1:1 port of the `shell()` chrome in
 * docs/design-handover/showcase/SparkPoint Admin.html: the ops top bar, a
 * persistent "Observe-only · read-only over funds" indicator, a "View as" role
 * switcher (Super-Admin / Ops / Stakeholder / Client) backed by AdminRoleContext,
 * a role-filtered side nav, a scaffold (no auth) banner, and a bottom light/dark
 * theme toggle wired to next-themes.
 *
 * SCAFFOLD: reachable at /admin with NO authentication or authorization. Nothing
 * in this panel can move user funds; the kill-switch is propose-and-sign only.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { activeNav } from "@/lib/admin/nav";
import { useTheme } from "next-themes";
import { Icon, SparkMark } from "@/lib/icons";
import { StageBadge } from "@/components/ui/stage-badge";
import {
  AdminRoleProvider,
  useAdminRole,
  ROLES,
  NAVMETA,
  NAV_HREF,
  type RoleKey,
  type NavKey,
} from "./role-context";

// Stable `useSyncExternalStore` args for a hydration-safe "is mounted on the client" flag: the store
// never changes (no-op subscribe), the client snapshot is `true`, the server/hydration snapshot is
// `false`. Module-scoped so their identities are stable across renders.
const _subscribeNoop = (): (() => void) => () => {};
const _snapshotTrue = (): boolean => true;
const _snapshotFalse = (): boolean => false;

function NavItem({ nav, active, onNav }: { nav: NavKey; active: boolean; onNav: () => void }) {
  const [label, icon] = NAVMETA[nav];
  const router = useRouter();
  return (
    <div
      className={`navitem ${active ? "active" : ""}`}
      data-s={nav}
      onClick={() => {
        router.push(NAV_HREF[nav]);
        onNav();
      }}
    >
      <Icon name={icon} size={17} />
      {label}
      {nav === "revenue" ? <span className="star">★</span> : null}
    </div>
  );
}

function RoleSwitch() {
  const { role, setRole } = useAdminRole();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({ top: 0, right: 8 });

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  return (
    <span className="roleswitch">
      View as
      <button
        type="button"
        className="rolebtn"
        ref={btnRef}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          const next = !open;
          setOpen(next);
          if (next && btnRef.current) {
            const r = btnRef.current.getBoundingClientRect();
            setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
          }
        }}
      >
        <span className="rl">{ROLES[role].label}</span>
        <svg
          className="cv"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div
        className={`rolemenu ${open ? "open" : ""}`}
        role="listbox"
        style={{ top: pos.top, right: pos.right }}
      >
        {(Object.entries(ROLES) as [RoleKey, (typeof ROLES)[RoleKey]][]).map(([k, v]) => (
          <div
            key={k}
            className={`roleopt ${k === role ? "sel" : ""}`}
            role="option"
            data-role={k}
            aria-selected={k === role}
            onClick={() => {
              setRole(k);
              setOpen(false);
              router.push(NAV_HREF[ROLES[k].home]);
            }}
          >
            {v.label}
            <svg
              className="chk"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
        ))}
      </div>
    </span>
  );
}

/** map the current location to the active nav key.
 *
 * 032 — three nav entries now point at ONE page with a `?section=`, so the pathname alone cannot
 * tell them apart: without the section, clicking "Tips" would highlight "Knowledge". The section
 * is matched first, then the pathname as before. */

function Shell({ children }: { children: ReactNode }) {
  const { role } = useAdminRole();
  const pathname = usePathname() || "/admin";
  const { resolvedTheme, setTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  // Dismissible scaffold notice — once closed, the panel matches the design 1:1.
  const [bannerOpen, setBannerOpen] = useState(true);

  // Mount guard (fixes a shell-wide React #418 hydration mismatch): next-themes resolves the real
  // theme from <html> BEFORE React hydrates, so reading `resolvedTheme` during the first client
  // render differs from the SSR default (undefined → dark) and throws a text mismatch on the toggle
  // label. `useSyncExternalStore` returns the server snapshot (false) through hydration, then the
  // client snapshot (true) after — hydration-safe, and no setState-in-effect. The real theme applies
  // post-mount (one clean re-render, no flash of wrong content).
  const mounted = useSyncExternalStore(_subscribeNoop, _snapshotTrue, _snapshotFalse);
  const isLight = mounted && resolvedTheme === "light";

  const r = ROLES[role];
  // 035 — the "Admin" sub-group held exactly `cfg` and `audit`, and both are now sections of a
  // console. A heading over an empty list is worse than no heading, so the split goes with them.
  const primary = r.nav;
  const cur = activeNav(pathname);
  const closeNav = () => setNavOpen(false);

  return (
    <div className="ad" id="ad">
      <div className="opsbar">
        <button className="adburger" aria-label="Open menu" onClick={() => setNavOpen((v) => !v)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 6h18M3 12h18M3 18h18" />
          </svg>
          Menu
        </button>
        <span className="adbrand">
          <SparkMark size={21} className="smk" />
          Sparky Ops
        </span>
        <StageBadge className="envbadge" led={false} />
        <span className="grow" />
        <span
          className="obschip"
          title="This panel can watch Sparky but cannot move a single unit of user funds. The kill-switch shown here proposes a multisig pause — it can never move user funds."
        >
          <Icon name="lock" size={13} /> <span className="hide-sm">Observe-only · read-only over funds</span>
        </span>
        <RoleSwitch />
      </div>

      {bannerOpen && (
        <div className="adscaffold">
          <Icon name="alert" size={14} />
          <span>
            <b>Admin access is enforced</b> (SIWE admin session — non-admins get a 404), but several panels
            still show <b>illustrative sample data</b>, not live figures. Live today: LLM gateway, Allowlist,
            Kill-switch, System. The &ldquo;View as&rdquo; switcher is cosmetic. Nothing here can move user
            funds; the kill-switch is propose-and-sign only.
          </span>
          <button
            className="adscaffold-x"
            type="button"
            aria-label="Dismiss scaffold notice"
            onClick={() => setBannerOpen(false)}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}

      <div className="adbody">
        <div className={`adnav-scrim ${navOpen ? "show" : ""}`} onClick={closeNav} />
        <nav className={`adnav ${navOpen ? "open" : ""}`}>
          <button className="navclose" onClick={closeNav}>
            <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, fontWeight: 600, color: "var(--muted-foreground)" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
              Close
            </span>
          </button>
          {primary.map((n) => (
            <NavItem key={n} nav={n} active={cur === n} onNav={closeNav} />
          ))}
          <button className="navtheme" type="button" onClick={() => setTheme(isLight ? "dark" : "light")}>
            <Icon name={isLight ? "sun" : "moon"} size={16} />
            <span>{isLight ? "Light mode" : "Dark mode"}</span>
            <span className={`adsw ${isLight ? "on" : ""}`} />
          </button>
        </nav>
        <main className="adcontent max">{children}</main>
      </div>
    </div>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <AdminRoleProvider>
      <Shell>{children}</Shell>
    </AdminRoleProvider>
  );
}
