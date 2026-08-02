"use client";

/**
 * Admin "View as" role context — a cosmetic role switcher for the ops panel.
 * Faithful to the ROLES / NAVMETA model in SparkPoint Admin.html. This is a
 * SCAFFOLD: there is NO authentication or authorization. Switching roles only
 * adjusts which nav sections are shown — it grants no real access and the panel
 * can never move user funds.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

export type RoleKey = "super" | "ops" | "stake" | "client";

/** nav keys, in source order. */
export type NavKey =
  | "overview"
  | "users"
  | "allowlist"
  | "usage"
  | "gateway"
  | "knowledge"
  | "updates"
  | "tips"
  | "uptime"
  | "diagnostics"
  | "tvl"
  | "vaults"
  | "faucet"
  | "revenue"
  | "system"
  | "killswitch"
  | "stake"
  | "cfg"
  | "audit";

export interface RoleDef {
  label: string;
  nav: NavKey[];
  home: NavKey;
}

/** ROLES — exact labels, nav sets and home screens from the source. */
export const ROLES: Record<RoleKey, RoleDef> = {
  super: {
    label: "Super-Admin",
    nav: ["overview", "users", "allowlist", "usage", "gateway", "knowledge", "updates", "tips", "uptime", "diagnostics", "tvl", "vaults", "faucet", "revenue", "system", "killswitch", "stake", "cfg", "audit"],
    home: "overview",
  },
  ops: {
    label: "Ops / Internal",
    nav: ["overview", "users", "allowlist", "usage", "gateway", "knowledge", "updates", "tips", "uptime", "diagnostics", "tvl", "vaults", "faucet", "revenue", "system", "killswitch", "stake", "cfg", "audit"],
    home: "overview",
  },
  stake: {
    label: "Stakeholder",
    nav: ["overview", "tvl", "revenue", "stake"],
    home: "stake",
  },
  client: {
    label: "Client",
    nav: ["stake"],
    home: "stake",
  },
};

/** NAVMETA — [label, icon name] per nav key. The source admin file shipped its
 *  own icon paths; here we map each to the closest icon in @/lib/icons (most are
 *  path-identical: overview=grid, usage=activity, system=shield, cfg=settings). */
export const NAVMETA: Record<NavKey, [string, string]> = {
  overview: ["Overview", "grid"],
  users: ["Users", "user"],
  allowlist: ["Allowlist", "shieldcheck"],
  usage: ["Usage", "activity"],
  gateway: ["LLM gateway", "zap"],
  knowledge: ["Knowledge", "book"],
  updates: ["Updates", "bell"],
  tips: ["Tips", "info"],
  uptime: ["Uptime", "activity"],
  diagnostics: ["Diagnostics", "flask"],
  tvl: ["TVL / Vault", "vault"],
  vaults: ["Vaults", "vault"],
  faucet: ["SRK faucet", "coins"],
  revenue: ["Revenue", "portfolio"],
  system: ["System", "shield"],
  killswitch: ["Kill-switch", "pause"],
  stake: ["Stakeholder", "coins"],
  cfg: ["Limits & Tiers", "settings"],
  audit: ["Audit log", "book"],
};

/** route href per nav key (the App Router equivalent of the source's `screen`). */
export const NAV_HREF: Record<NavKey, string> = {
  overview: "/admin",
  users: "/admin/users",
  allowlist: "/admin/allowlist",
  usage: "/admin/usage",
  gateway: "/admin/gateway",
  knowledge: "/admin/knowledge",
  updates: "/admin/updates",
  tips: "/admin/tips",
  uptime: "/admin/uptime",
  diagnostics: "/admin/diagnostics",
  tvl: "/admin/tvl",
  vaults: "/admin/vaults",
  faucet: "/admin/faucet",
  revenue: "/admin/revenue",
  system: "/admin/system",
  killswitch: "/admin/killswitch",
  stake: "/admin/stake",
  cfg: "/admin/config",
  audit: "/admin/audit",
};

interface AdminRoleCtx {
  role: RoleKey;
  setRole: (r: RoleKey) => void;
}

const Ctx = createContext<AdminRoleCtx | null>(null);

export function AdminRoleProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<RoleKey>("super");
  return <Ctx.Provider value={{ role, setRole }}>{children}</Ctx.Provider>;
}

/** Read the current "View as" role (and setter). */
export function useAdminRole(): AdminRoleCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAdminRole must be used within <AdminRoleProvider>");
  return ctx;
}
