"use client";

/**
 * Admin "View as" role context — a cosmetic role switcher for the ops panel.
 * Faithful to the ROLES / NAVMETA model in SparkPoint Admin.html. This is a
 * SCAFFOLD: there is NO authentication or authorization. Switching roles only
 * adjusts which nav sections are shown — it grants no real access and the panel
 * can never move user funds.
 */

import { createContext, useContext, useState, type ReactNode } from "react";

// 035 — the nav map lives in a PURE leaf module so its rule can be tested directly rather than
// re-implemented in a test file. Re-exported here so existing importers are unaffected.
import { NAVMETA, NAV_HREF, type NavKey } from "@/lib/admin/nav";

export { NAVMETA, NAV_HREF };
export type { NavKey };

export type RoleKey = "super" | "ops" | "stake" | "client";



export interface RoleDef {
  label: string;
  nav: NavKey[];
  home: NavKey;
}

/** ROLES — exact labels, nav sets and home screens from the source. */
export const ROLES: Record<RoleKey, RoleDef> = {
  super: {
    label: "Super-Admin",
    nav: ["overview", "users", "gateway", "knowledge", "vault", "faucet", "revenue", "system", "stake"],
    home: "overview",
  },
  ops: {
    label: "Ops / Internal",
    nav: ["overview", "users", "gateway", "knowledge", "vault", "faucet", "revenue", "system", "stake"],
    home: "overview",
  },
  stake: {
    label: "Stakeholder",
    nav: ["overview", "vault", "revenue", "stake"],
    home: "stake",
  },
  client: {
    label: "Client",
    nav: ["stake"],
    home: "stake",
  },
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
