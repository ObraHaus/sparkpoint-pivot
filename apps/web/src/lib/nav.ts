import type { IconName } from "@/lib/icons";

/** Navigation config mirroring the design's PUBLIC / PRIMARY / SECONDARY arrays. */

export interface NavItem {
  route: string;
  label: string;
  icon: IconName;
}

export const PUBLIC = ["landing", "connect", "verify"] as const;

/** Top-bar primary nav + mobile tab bar. */
export const PRIMARY: NavItem[] = [
  { route: "chat", label: "Chat", icon: "chat" },
  { route: "portfolio", label: "Portfolio", icon: "portfolio" },
  { route: "vault", label: "Vault", icon: "vault" },
  { route: "strategies", label: "Strategies", icon: "strategies" },
];

/** Left "Trust & control" rail (and the More sheet). */
export const SECONDARY: NavItem[] = [
  { route: "swap", label: "Swap", icon: "swap" },
  { route: "bridge", label: "Bridge", icon: "refresh" },
  { route: "trust", label: "Trust Center", icon: "shieldcheck" },
  { route: "automation", label: "Automation", icon: "zap" },
  { route: "outcomes", label: "Outcome Log", icon: "activity" },
  { route: "fees", label: "Fees", icon: "coins" },
  { route: "premium", label: "Premium", icon: "zap" },
  { route: "learn", label: "Learn", icon: "book" },
  { route: "srk", label: "SRK", icon: "coins" },
  { route: "settings", label: "Settings", icon: "settings" },
];

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
