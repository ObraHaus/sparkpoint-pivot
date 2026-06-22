/**
 * /learn — Plain-language explanations so users can judge recommendations, not just trust them.
 *
 * Faithful 1:1 port of the design's `learn` screen
 * (docs/design-handover/showcase/screens/support.js). Markup, classes, and copy verbatim.
 */

import { Icon } from "@/lib/icons";
import "@/components/screens/support.css";

const topics: [string, string][] = [
  ["What's net APY?", "Your estimated yearly return after all costs, if the current rate held."],
  ["What are vault shares?", "Your slice of the vault — count stays fixed, value grows as it earns."],
  ["What's slippage?", "How much price can move against you before a trade lands. We cap it."],
  [
    "What is self-custody?",
    "You stay in full control of your funds at all times. SparkPoint can direct strategy, never take, move, or hold your money.",
  ],
  ["What are guardrails?", "Deterministic rules that check every AI suggestion before you sign."],
  ["What's a session key?", "A scoped, time-limited permission for hands-off rebalancing — revocable instantly."],
];

export default function Page() {
  return (
    <div className="page page-narrow">
      <div className="pagehead">
        <div>
          <h1>Learn</h1>
          <div className="sub">Plain explanations, so you can judge our recommendations — not just trust them.</div>
        </div>
      </div>
      <div className="learn-grid">
        {topics.map((t) => (
          <div className="learn-card" key={t[0]}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7, color: "var(--info)" }}>
              <Icon name="info" size={16} />
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--foreground)" }}>{t[0]}</span>
            </div>
            <div style={{ fontSize: 13, color: "var(--muted-foreground)", lineHeight: 1.55 }}>{t[1]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
