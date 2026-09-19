"use client";

/**
 * 035 — the vault, in one console: what it is doing, and how it is configured.
 *
 * "TVL / Vault" and "Vaults" were two nav entries a letter apart, and nothing in either label told
 * you which was the live figures and which was the registry. Now the tabs say so.
 */

import { AdminSections } from "@/components/admin/SectionTabs";
import { CuratedVaultsPanel } from "@/components/admin/CuratedVaultsPanel";
import { VaultConfigPanel } from "@/components/admin/VaultConfigPanel";
import { VaultOverviewPanel } from "@/components/admin/VaultOverviewPanel";

export default function Page() {
  return (
    <AdminSections
      sections={[
        {
          id: "overview",
          label: "Overview",
          hint: "What the vault holds and what it is earning, right now.",
          render: () => <VaultOverviewPanel />,
        },
        {
          id: "curated",
          label: "Curated",
          hint: "What Sparky found and recommends — approve, pin, edit or hide it. Off-chain.",
          render: () => <CuratedVaultsPanel />,
        },
        {
          id: "config",
          label: "Config",
          hint: "The deployed vaults and their settings.",
          render: () => <VaultConfigPanel />,
        },
      ]}
    />
  );
}
