import type { IconName } from "@/lib/icons";

/**
 * Navigation config — the SINGLE source of truth for every nav surface.
 *
 * Four surfaces render this app's navigation (desktop rail, mobile "More" sheet, the ⌘K palette and
 * the avatar menu). They used to each hardcode their own copy, which had already drifted (the ⌘K
 * palette shipped without SRK/Learn). Everything now derives from `PRIMARY` / `SECONDARY` +
 * the pinned items below, so that drift class cannot come back.
 *
 * `SECONDARY` is a TREE: a node is either a leaf (`NavItem`) or a collapsible group (`NavGroup`).
 * Groups are a rail/sheet affordance only — the palette and any route check always see the flat
 * leaf list, so a route can never become unreachable by being collapsed (N2).
 */

export interface NavItem {
  route: string;
  label: string;
  icon: IconName;
  /**
   * Extra ⌘K search terms. The palette previously carried its own phrasings ("Withdraw now",
   * "Fees / how we make money", "Revoke automation"); they live here now so one edit updates
   * every surface.
   */
  keywords?: string[];
}

export interface NavGroup {
  /** Stable key — persists the open/closed state; never render this to the user. */
  key: string;
  label: string;
  icon: IconName;
  children: NavItem[];
}

export type NavNode = NavItem | NavGroup;

export function isNavGroup(node: NavNode): node is NavGroup {
  return Array.isArray((node as NavGroup).children);
}

export const PUBLIC = ["landing", "connect", "verify"] as const;

/** Top-bar primary nav + mobile tab bar. */
export const PRIMARY: NavItem[] = [
  { route: "chat", label: "Chat", icon: "chat", keywords: ["ask sparky", "assistant"] },
  { route: "portfolio", label: "Portfolio", icon: "portfolio", keywords: ["positions", "balances"] },
  { route: "vault", label: "Vault", icon: "vault", keywords: ["deposit", "yield"] },
  { route: "strategies", label: "Strategies", icon: "strategies", keywords: ["recommendations"] },
];

/** Group key for the collapsible "Information" section (persistence + tests reference it). */
export const INFORMATION_GROUP_KEY = "information";

/**
 * Left "Trust & control" rail (and the More sheet). Regroup-only: nothing is hidden — the reference
 * material simply lives one disclosure deep so the actionable surfaces read first.
 */
export const SECONDARY: NavNode[] = [
  { route: "swap", label: "Swap", icon: "swap", keywords: ["swap tokens", "trade"] },
  { route: "bridge", label: "Bridge", icon: "refresh", keywords: ["bridge assets", "move between networks"] },
  {
    key: INFORMATION_GROUP_KEY,
    label: "Information",
    icon: "info",
    children: [
      { route: "trust", label: "Trust Center", icon: "shieldcheck", keywords: ["proof", "guarantees", "custody"] },
      { route: "outcomes", label: "Outcome Log", icon: "activity", keywords: ["results", "attribution", "track record"] },
      { route: "fees", label: "Fees", icon: "coins", keywords: ["how we make money", "pricing", "costs"] },
      { route: "learn", label: "Learn", icon: "book", keywords: ["guides", "education", "glossary"] },
      { route: "srk", label: "SRK", icon: "coins", keywords: ["token", "sparkpoint token"] },
      { route: "changelog", label: "Changelog", icon: "book", keywords: ["what's new", "releases", "updates"] },
    ],
  },
  { route: "settings", label: "Settings", icon: "settings", keywords: ["preferences", "mandate", "account", "premium", "plan", "automation", "session key"] },
];

/**
 * Routes that intentionally left the nav (client decision, Aug 2 evening) but MUST stay
 * reachable — they now surface inside Settings (Premium → Account tab; Automation → Security
 * tab) and remain deep-linkable. The ⌘K palette keeps them searchable via these entries so
 * "premium"/"automation" still find their pages.
 */
export const OFF_NAV_DESTINATIONS: NavItem[] = [
  { route: "premium", label: "Premium", icon: "zap", keywords: ["upgrade", "subscription", "faucet", "claim srk", "plan"] },
  { route: "automation", label: "Automation", icon: "zap", keywords: ["revoke automation", "session key", "hands-off"] },
];

/**
 * Pinned items that are NOT part of the regroupable tree. The exit path in particular is pinned on
 * every surface and must never sit inside a collapsible group (N2 — never bury the way out).
 */
export const EXIT_ITEM: NavItem = {
  route: "trust/exit",
  label: "Withdraw / Exit",
  icon: "door",
  keywords: ["withdraw now", "exit", "get my money out", "cash out"],
};
export const PERMISSIONS_ITEM: NavItem = {
  route: "trust/permissions",
  label: "Prove it — permissions",
  icon: "shieldcheck",
  keywords: ["permissions", "approvals", "prove it"],
};
export const NOTIFICATIONS_ITEM: NavItem = {
  route: "notifications",
  label: "Notifications",
  icon: "bell",
  keywords: ["alerts", "bell"],
};

/** Every leaf in a node list, in source order (groups flattened in place). */
export function navLeaves(nodes: readonly NavNode[]): NavItem[] {
  const out: NavItem[] = [];
  for (const node of nodes) {
    if (isNavGroup(node)) out.push(...node.children);
    else out.push(node);
  }
  return out;
}

/** Every route reachable from a node list. */
export function navRoutes(nodes: readonly NavNode[]): string[] {
  return navLeaves(nodes).map((n) => n.route);
}

/** True when `route` is one of the leaves (used for "More" active state on mobile). */
export function containsRoute(nodes: readonly NavNode[], route: string): boolean {
  return navRoutes(nodes).includes(route);
}

/** The group that owns `route`, if any. */
export function groupForRoute(nodes: readonly NavNode[], route: string): NavGroup | undefined {
  for (const node of nodes) {
    if (isNavGroup(node) && node.children.some((c) => c.route === route)) return node;
  }
  return undefined;
}

/* ------------------------------ group open state ----------------------------- */

/** localStorage key for the rail/sheet disclosure state — `sp.` namespaced + versioned. */
export const NAV_GROUPS_STORAGE_KEY = "sp.nav.groups.v1";

/** Untrusted parsed blob → a clean `{ [groupKey]: boolean }`. Unknown/ill-typed entries dropped. */
export function coerceNavGroupState(raw: unknown): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
  }
  return out;
}

/**
 * Whether a group renders open.
 *
 * - Never toggled by this user ⇒ open ONLY if it holds the active route (so a deep link never lands
 *   on a page whose nav entry is hidden), which means COLLAPSED on a first load of `/chat`.
 * - Explicitly toggled ⇒ honour the stored choice.
 */
export function resolveGroupOpen(
  state: Readonly<Record<string, boolean>>,
  group: NavGroup,
  activeRoute: string,
): boolean {
  const stored = state[group.key];
  if (typeof stored === "boolean") return stored;
  return group.children.some((c) => c.route === activeRoute);
}

/* --------------------------------- ⌘K palette -------------------------------- */

/**
 * The command palette's action list, derived — exit first (fastest path to the money), then the
 * permissions proof, the primary screens, every secondary leaf (groups flattened — collapsing the
 * Information group must never remove it from search), then notifications. Deduped by route.
 */
export function commandActions(): NavItem[] {
  const ordered = [
    EXIT_ITEM,
    PERMISSIONS_ITEM,
    ...PRIMARY,
    ...navLeaves(SECONDARY),
    ...OFF_NAV_DESTINATIONS,
    NOTIFICATIONS_ITEM,
  ];
  const seen = new Set<string>();
  return ordered.filter((a) => (seen.has(a.route) ? false : (seen.add(a.route), true)));
}

/** Case-insensitive match over the label AND the item's keywords. */
export function matchesQuery(item: NavItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.label.toLowerCase().includes(q)) return true;
  return (item.keywords ?? []).some((k) => k.toLowerCase().includes(q));
}

/* ----------------------------------- routing ---------------------------------- */

/** The first path segment of a route (e.g. "vault/deposit" -> "vault"). */
export function baseSegment(pathname: string): string {
  const clean = pathname.replace(/^\//, "");
  return clean.split("/")[0] || "chat";
}

/** Design route string -> Next.js href. "landing" is the marketing root. */
export function toHref(route: string): string {
  if (route === "landing") return "/";
  // routes that collapse onto an existing page in this build
  if (route === "settings/account") return "/settings";
  return "/" + route;
}
