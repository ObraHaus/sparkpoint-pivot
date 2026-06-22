import { AdminStub } from "@/components/admin-shell";

export default function Page() {
  return (
    <AdminStub
      title="Revenue"
      subtitle="Revenue in action — realized solid, projected dashed. We never lead with a projection."
      note="Graphical revenue dashboard (centerpiece): revenue-by-stream stacked over time, cumulative, trajectory & forecast, MRR/ARR, take-rate, the HWM panel, and the 'we only earn when you earn' dual-area. Visualizes revenue only — no fee-authorizing controls (read-only over funds)."
    />
  );
}
