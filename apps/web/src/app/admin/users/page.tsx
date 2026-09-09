"use client";

/**
 * 035 — everything about who uses SparkPoint and what they are allowed to do, in one console.
 *
 * These four screens were four nav entries, and they are always read together: you look at a
 * cohort, then at what it costs, then at who is let in, then at their limits. Splitting them meant
 * an admin checking a user's tier had to know that lived under "Limits & Tiers" rather than under
 * "Users" — a piece of knowledge the nav demanded rather than supplied.
 *
 * The panels are unchanged: same APIs, same behaviour. Only the way in is different, and every old
 * route still resolves.
 */

import { AdminSections } from "@/components/admin/SectionTabs";
import { AllowlistPanel } from "@/components/admin/AllowlistPanel";
import { LimitsTiersPanel } from "@/components/admin/LimitsTiersPanel";
import { UsagePanel } from "@/components/admin/UsagePanel";
import { UserAnalyticsPanel } from "@/components/admin/UserAnalyticsPanel";

export default function Page() {
  return (
    <AdminSections
      sections={[
        {
          id: "analytics",
          label: "User analytics",
          hint: "Who is here, what they do, and how that is trending.",
          render: () => <UserAnalyticsPanel />,
        },
        {
          id: "usage",
          label: "AI usage",
          hint: "What the assistant is being asked to do, and what it costs.",
          render: () => <UsagePanel />,
        },
        {
          id: "allowlist",
          label: "Allowlist",
          hint: "Who may enter the app, and who holds admin. Live.",
          render: () => <AllowlistPanel />,
        },
        {
          id: "limits",
          label: "Limits and tiers",
          hint: "What each tier may spend, and which wallets sit in which tier.",
          render: () => <LimitsTiersPanel />,
        },
      ]}
    />
  );
}
