import { AdminStub } from "@/components/admin-shell";

export default function Page() {
  return (
    <AdminStub
      title="Kill-switch"
      subtitle="Governed manual kill-switch — pause/unpause status and proposals."
      note="Pause-only · 2-of-3 multisig · never blocks withdrawals · propose-and-sign only. This panel can propose & sign a pause/unpause but can never execute one — execution requires the on-chain 2-of-3 multisig threshold. Never blocks withdrawals; never moves funds (read-only over funds)."
    />
  );
}
