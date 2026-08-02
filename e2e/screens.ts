/**
 * Screen registry — maps every showcase surface to its scaffold route.
 * `showcase` is a path (with hash) under the showcase server root;
 * `scaffold` is a path under the scaffold app.
 *
 * Showcase entry points:
 *   - Spark Core Landing.html      → the marketing landing
 *   - SparkPoint.html#/<route>     → the authed SPA (hash router)
 *   - flows/Onboarding.html        → onboarding
 *   - SparkPoint Admin.html        → admin (in-page nav, see admin.spec.ts)
 */
export type Theme = "dark" | "light";

export interface ScreenDef {
  name: string;
  showcase: string;
  scaffold: string;
  themes?: Theme[];
  /** Spark Core landing: mask the animated particle canvas during visual diff. */
  maskCanvas?: boolean;
  /** Verify auto-advances on timers; wait for the final state before snapping. */
  settleMs?: number;
  note?: string;
}

const SP = (hash: string) => `SparkPoint.html#/${hash}`;

/** Public entry + the authed app screens (hash-routed in the showcase). */
export const SCREENS: ScreenDef[] = [
  { name: "landing", showcase: "Spark Core Landing.html", scaffold: "/", themes: ["dark"], maskCanvas: true, settleMs: 2200, note: "Spark Core animated landing" },
  { name: "connect", showcase: SP("connect"), scaffold: "/connect" },
  { name: "verify", showcase: SP("verify"), scaffold: "/verify", settleMs: 4200, note: "stepped access-check resolves to final state" },
  { name: "onboarding", showcase: "flows/Onboarding.html", scaffold: "/onboarding", themes: ["dark"] },
  { name: "chat", showcase: SP("chat"), scaffold: "/chat" },
  { name: "portfolio", showcase: SP("portfolio"), scaffold: "/portfolio" },
  { name: "vault", showcase: SP("vault"), scaffold: "/vault" },
  { name: "strategies", showcase: SP("strategies"), scaffold: "/strategies" },
  { name: "trust", showcase: SP("trust"), scaffold: "/trust" },
  { name: "trust-permissions", showcase: SP("trust/permissions"), scaffold: "/trust/permissions" },
  { name: "trust-exit", showcase: SP("trust/exit"), scaffold: "/trust/exit" },
  { name: "automation", showcase: SP("automation"), scaffold: "/automation" },
  { name: "bridge", showcase: SP("bridge"), scaffold: "/bridge" },
  { name: "fees", showcase: SP("fees"), scaffold: "/fees" },
  { name: "premium", showcase: SP("premium"), scaffold: "/premium", note: "026: DIVERGES from the showcase by design — carries the live SRK balance + the testnet faucet card, and the price is 10,000 SRK (was 500). Not a parity regression." },
  { name: "outcomes", showcase: SP("outcomes"), scaffold: "/outcomes" },
  { name: "learn", showcase: SP("learn"), scaffold: "/learn" },
  { name: "srk", showcase: SP("srk"), scaffold: "/srk", note: "026: DIVERGES from the showcase by design — now info-only. The showcase's balance card + \"How to earn\" button were dead (a hardcoded 0 SRK and a no-op); balance/faucet moved to /premium." },
  { name: "settings", showcase: SP("settings"), scaffold: "/settings" },
  { name: "notifications", showcase: SP("notifications"), scaffold: "/notifications" },
  { name: "confirm-deposit", showcase: SP("confirm/deposit"), scaffold: "/confirm/deposit", settleMs: 2600, note: "confirm gate simulates then settles" },
];

/** Admin screens: showcase = SparkPoint Admin.html + click .navitem[data-s]; scaffold = /admin/<route>. */
export interface AdminScreenDef {
  name: string;
  navKey: string; // data-s in the showcase
  scaffold: string;
  themes?: Theme[];
}
export const ADMIN_SCREENS: AdminScreenDef[] = [
  { name: "overview", navKey: "overview", scaffold: "/admin" },
  { name: "users", navKey: "users", scaffold: "/admin/users" },
  { name: "usage", navKey: "usage", scaffold: "/admin/usage" },
  { name: "tvl", navKey: "tvl", scaffold: "/admin/tvl" },
  { name: "revenue", navKey: "revenue", scaffold: "/admin/revenue" },
  { name: "system", navKey: "system", scaffold: "/admin/system" },
  { name: "killswitch", navKey: "killswitch", scaffold: "/admin/killswitch" },
  { name: "stake", navKey: "stake", scaffold: "/admin/stake" },
  { name: "config", navKey: "cfg", scaffold: "/admin/config" },
  { name: "audit", navKey: "audit", scaffold: "/admin/audit" },
];

export const ADMIN_SHOWCASE = "SparkPoint Admin.html";
