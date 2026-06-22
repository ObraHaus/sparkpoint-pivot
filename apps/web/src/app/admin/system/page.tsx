import { AdminStub } from "@/components/admin-shell";

export default function Page() {
  return (
    <AdminStub
      title="System"
      subtitle="Is the machine healthy? Health surfaces never expose a fund control."
      note="Status tiles (agent service, RPC, indexer lag, subgraphs, sim, error rate, kill-switch), policy-engine decisions, sim latency, error rates, and guardrail triggers. The kill-switch tile is read-only and links to the governed kill-switch screen (read-only over funds)."
    />
  );
}
