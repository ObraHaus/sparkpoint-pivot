import { AdminStub } from "@/components/admin-shell";

export default function Page() {
  return (
    <AdminStub
      title="Users"
      subtitle="Who the users are and how they behave — pseudonymized by default."
      note="User KPIs, signup/cohort/funnel charts, and a top-users table. Pseudonymous refs by default; full-address reveal is step-up + audited. No fund-action column — observe-only (read-only over funds)."
    />
  );
}
