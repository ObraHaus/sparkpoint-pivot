import { AdminStub } from "@/components/admin-shell";

export default function Page() {
  return (
    <AdminStub
      title="TVL & Vaults"
      subtitle="The money view — onchain truth. Display-only, never a gate."
      note="Per-vault TVL, deposits/withdrawals & net flows, caps utilization, share price & net APY, plus the withdraw-always drill + kill-switch STATUS panels. Status only — no controls (read-only over funds)."
    />
  );
}
