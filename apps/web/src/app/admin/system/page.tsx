"use client";

/**
 * 035 — is it up, is it healthy, can I stop it, and what happened — in one console.
 *
 * Five nav entries for five questions asked in the same breath. The kill-switch in particular sat
 * on its own, so an admin reaching for it during an incident had to remember it was NOT under
 * System. During an incident is the worst possible time to be asked to remember where something is.
 *
 * The kill-switch is unchanged and remains propose-and-sign only: it can never move user funds.
 */

import { AdminSections } from "@/components/admin/SectionTabs";
import { AuditLogPanel } from "@/components/admin/AuditLogPanel";
import { DiagnosticsPanel } from "@/components/admin/DiagnosticsPanel";
import { KillSwitchPanel } from "@/components/admin/KillSwitchPanel";
import { RpcProxyPanel } from "@/components/admin/RpcProxyPanel";
import { SystemPanel } from "@/components/admin/SystemPanel";
import { UptimePanel } from "@/components/admin/UptimePanel";

export default function Page() {
  return (
    <AdminSections
      sections={[
        {
          id: "status",
          label: "System",
          hint: "Services, versions and the state of the deployment. Live.",
          render: () => <SystemPanel />,
        },
        {
          id: "uptime",
          label: "Uptime",
          hint: "What has been up, and what has not.",
          render: () => <UptimePanel />,
        },
        {
          id: "diagnostics",
          label: "Diagnostics",
          hint: "Chain and wallet checks, for when something looks wrong.",
          render: () => <DiagnosticsPanel />,
        },
        {
          id: "killswitch",
          label: "Kill-switch",
          hint: "Propose a multisig pause. Deposits only — the exit is never gated.",
          render: () => <KillSwitchPanel />,
        },
        {
          id: "audit",
          label: "Audit log",
          hint: "What admins did, and when.",
          render: () => <AuditLogPanel />,
        },
        {
          id: "rpc",
          label: "RPC proxy",
          hint: "Every chain read rides the proxy. Health, cache, budget — live.",
          render: () => <RpcProxyPanel />,
        },
      ]}
    />
  );
}
