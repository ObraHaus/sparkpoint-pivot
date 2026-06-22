import { AdminStub } from "@/components/admin-shell";

export default function Page() {
  return (
    <AdminStub
      title="Config"
      subtitle="Operational config that is not custody-critical."
      note="Whitelist invites, feature flags, and dashboard settings. These are the only writes in the panel — they gate app access and features, route through the product's governed path with their own audit, and can never move funds or block withdrawals (read-only over funds)."
    />
  );
}
