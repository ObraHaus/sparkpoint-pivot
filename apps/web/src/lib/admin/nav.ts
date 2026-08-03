/**
 * 035 — the admin nav map and the rule that decides which entry is highlighted.
 *
 * PURE and LEAF: no React, no `@/` value imports, so the strip-types test runner can load it and
 * the tests can check the REAL rule. The previous test re-implemented `activeNav` and said so in a
 * comment — a test that carries its own copy of the logic passes when the copy is right, which is
 * not the question anyone is asking.
 *
 * WHY THE NAV IS SHORT. It had nineteen entries, most of them one screen each, and the grouping was
 * something you had to know rather than something you could see: the kill-switch was not under
 * System, a user's tier was not under Users. Screens that get read together are now sections of one
 * console, so the nav names nine destinations. Every removed entry's ROUTE still resolves — this
 * shortened the menu, it did not remove anything.
 */

/** Nav keys, in the order they appear. */
export type NavKey =
  | "overview"
  | "users"
  | "gateway"
  | "knowledge"
  | "vault"
  | "faucet"
  | "revenue"
  | "system"
  | "stake";

/** `[label, icon name]` per nav key. */
export const NAVMETA: Record<NavKey, [string, string]> = {
  overview: ["Overview", "grid"],
  users: ["Users & access", "user"],
  gateway: ["LLM gateway", "zap"],
  knowledge: ["Knowledge", "book"],
  vault: ["Vault", "vault"],
  faucet: ["SRK faucet", "coins"],
  revenue: ["Revenue", "portfolio"],
  system: ["System", "shield"],
  stake: ["Stakeholder", "coins"],
};

/** Route per nav key. */
export const NAV_HREF: Record<NavKey, string> = {
  overview: "/admin",
  users: "/admin/users",
  gateway: "/admin/gateway",
  knowledge: "/admin/knowledge",
  vault: "/admin/vault",
  faucet: "/admin/faucet",
  revenue: "/admin/revenue",
  system: "/admin/system",
  stake: "/admin/stake",
};

/**
 * Every route that used to be its own nav entry, and the section it now lives in.
 *
 * Kept as data rather than scattered through the route files so the set is inspectable — a test can
 * assert that every one of them still resolves, which is the promise being made to anyone who
 * bookmarked one.
 */
export const LEGACY_ROUTES: Record<string, string> = {
  "/admin/allowlist": "/admin/users?section=allowlist",
  "/admin/usage": "/admin/users?section=usage",
  "/admin/config": "/admin/users?section=limits",
  "/admin/tvl": "/admin/vault?section=overview",
  "/admin/vaults": "/admin/vault?section=config",
  "/admin/uptime": "/admin/system?section=uptime",
  "/admin/diagnostics": "/admin/system?section=diagnostics",
  "/admin/killswitch": "/admin/system?section=killswitch",
  "/admin/audit": "/admin/system?section=audit",
  "/admin/tips": "/admin/knowledge?section=tips",
  "/admin/updates": "/admin/knowledge?section=updates",
};

/**
 * Which nav entry a path belongs to.
 *
 * Longest href first, so `/admin/users` never loses to `/admin` — `startsWith` alone would make
 * every admin route look like Overview. A `?section=` change stays on the same entry, which is the
 * whole point of a console: moving between tabs is not navigation.
 */
export function activeNav(pathname: string): NavKey {
  const entry = (Object.entries(NAV_HREF) as [NavKey, string][])
    .sort((a, b) => b[1].length - a[1].length)
    .find(([, href]) => pathname === href || pathname.startsWith(href + "/"));
  return entry ? entry[0] : "overview";
}
