import { Landmark, Users, CircleDollarSign, TrendingUp } from "lucide-react";

const KPIS = [
  { label: "TVL", value: "$12.0M", icon: Landmark, note: "all vaults + Aave, USDC-quote" },
  { label: "Active users", value: "910", icon: Users, note: "WAU · DAU/MAU toggle" },
  { label: "Cumulative revenue", value: "$13.9K", icon: CircleDollarSign, note: "all streams, all-time" },
  { label: "MRR-equivalent", value: "$6.9K", icon: TrendingUp, note: "normalized monthly run-rate" },
];

export default function Page() {
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="t-h1">Overview</h1>
      <p className="mt-1 text-muted-foreground">How we&apos;re doing, right now, at a glance. North-star KPIs.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {KPIS.map((k) => (
          <div key={k.label} className="card p-5">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <k.icon size={14} className="text-primary" />
              {k.label}
            </div>
            <div className="t-display tnum mt-2 leading-none">{k.value}</div>
            <p className="mt-2 text-xs text-muted-foreground">{k.note}</p>
          </div>
        ))}
      </div>

      <div className="card mt-6 p-6">
        <span className="badge-ai">Scaffold</span>
        <p className="mt-3 max-w-prose text-sm text-muted-foreground">
          Placeholder KPI band. The full Overview adds sparklines, semantic deltas, and the
          Growth / Revenue-snapshot / Activity charts from docs/admin-panel/design-spec.md (A1).
          Observe-only: no fund-moving controls.
        </p>
      </div>
    </div>
  );
}
