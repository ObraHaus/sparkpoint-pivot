import { TIER } from "@/lib/mock-data";

/** Segmented 5-step risk meter. */
export function RiskMeter({ tier }: { tier: number }) {
  const t = TIER[tier];
  return (
    <span className="riskmeter">
      {tier === 0 ? (
        <i />
      ) : (
        Array.from({ length: 5 }, (_, i) => (
          <i key={i} style={{ background: i < tier ? `var(${t.v})` : "var(--border)" }} />
        ))
      )}
    </span>
  );
}

/** Risk chip — meter + label, tinted by tier (mirrors the design's `riskChip`). */
export function RiskChip({ tier }: { tier: number }) {
  const t = TIER[tier];
  const label = tier === 0 ? "Cash" : `${t.n} · ${tier}/5`;
  return (
    <span
      className="riskchip"
      style={{
        background: tier === 0 ? "var(--muted)" : `var(${t.v}-subtle)`,
        color: `var(${t.v})`,
        border: tier === 0 ? "1px solid var(--border)" : `1px solid color-mix(in srgb,var(${t.v}) 30%,transparent)`,
      }}
    >
      <RiskMeter tier={tier} />
      {label}
    </span>
  );
}
