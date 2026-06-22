import { AdminStub } from "@/components/admin-shell";

export default function Page() {
  return (
    <AdminStub
      title="Audit"
      subtitle="Forensics — the admin audit log."
      note="Append-only record of admin actions (config changes, address reveals, kill-switch proposals/signs, exports). Step-up re-auth gated in production. Read-only forensics — no fund-moving controls (read-only over funds)."
    />
  );
}
