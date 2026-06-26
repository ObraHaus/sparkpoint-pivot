"use client";

/**
 * AdminShell — the SparkPoint Ops / stakeholder panel shell.
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

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Icon, SparkMark } from "@/lib/icons";
import {
  AdminRoleProvider,
  useAdminRole,
  ROLES,
  NAVMETA,
  NAV_HREF,
  type RoleKey,
  type NavKey,
} from "./role-context";

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

/** map the current pathname to the active nav key. */
function activeNav(pathname: string): NavKey {
  const entry = (Object.entries(NAV_HREF) as [NavKey, string][])
    // longest href first so /admin/users wins over /admin
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, href]) => pathname === href || pathname.startsWith(href + "/"));
  return entry ? entry[0] : "overview";
}

function Shell({ children }: { children: ReactNode }) {
  const { role } = useAdminRole();
  const pathname = usePathname() || "/admin";
  const { resolvedTheme, setTheme } = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  // Dismissible scaffold notice — once closed, the panel matches the design 1:1.
  const [bannerOpen, setBannerOpen] = useState(true);

  // next-themes leaves resolvedTheme undefined until hydration, so this defaults
  // to the source's dark theme (moon / "Dark mode") with no flash and no mount flag.
  const isLight = resolvedTheme === "light";

  const r = ROLES[role];
  const primary = r.nav.filter((n) => !["cfg", "audit"].includes(n));
  const admin = r.nav.filter((n) => ["cfg", "audit"].includes(n));
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
          SparkPoint Ops
        </span>
        <span className="envbadge">PROD</span>
        <span className="fresh hide-sm">
          <Icon name="refresh" size={13} /> data fresh 42s ago
        </span>
        <span className="grow" />
        <span
          className="obschip"
          title="This panel can watch SparkPoint but cannot move a single unit of user funds. The kill-switch shown here proposes a multisig pause — it can never move user funds."
        >
          <Icon name="lock" size={13} /> <span className="hide-sm">Observe-only · read-only over funds</span>
        </span>
        <RoleSwitch />
      </div>

      {bannerOpen && (
        <div className="adscaffold">
          <Icon name="alert" size={14} />
          <span>
            <b>Scaffold — no authentication or authorization yet.</b> This panel is reachable without sign-in and
            the &ldquo;View as&rdquo; switcher is cosmetic. Nothing here can move user funds; the kill-switch is
            propose-and-sign only.
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
          {admin.length ? <div className="seclbl">Admin</div> : null}
          {admin.map((n) => (
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
