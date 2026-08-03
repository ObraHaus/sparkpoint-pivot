/**
 * 035 — which dependency tiles the System panel shows, and what each one says.
 *
 * PURE and LEAF so it can be tested directly. It is here because the bug it now prevents was
 * invisible for weeks and could only have been caught by a test of exactly this shape.
 *
 * WHAT HAPPENED. Feature 023 renamed the agent's readiness check `base_rpc` to `chain_rpc` and
 * added `chain_identity`. This panel kept reading `base_rpc`. The field was optional, so
 * `undefined` was legal TypeScript, and `undefined ? up : down` rendered **"Down"**. From
 * 2026-07-30 the console reported a Base RPC outage continuously while the RPC was entirely
 * healthy — verified at the time of the fix: chain 84532, block 44,998,642, and the agent reading
 * the next block one second later.
 *
 * THE RULE THAT REPLACES IT: absence is not failure. `true` is up, `false` is down, and a key the
 * agent did not send reads as "not reported". An operator who learns to ignore a red tile is how a
 * real outage gets missed, and a panel that cries wolf is how they learn.
 */

export type Tone = "ok" | "amber" | "info";
export type Tile = { label: string; tone: Tone; value: string };

/** The checks this panel expects from `/readyz`. Pinned by a test on each side of the wire. */
export const EXPECTED_CHECKS = ["chain_rpc", "chain_identity", "sim_fork", "llm", "postgres"] as const;

export interface ReadyzDetail {
  ready?: boolean;
  checks?: Partial<Record<(typeof EXPECTED_CHECKS)[number], boolean>>;
}

export function tilesFrom(state: "loading" | "ok" | "error", d: ReadyzDetail | null): Tile[] {
  const labels = [
    "Agent service",
    "Chain RPC",
    "Chain identity",
    "Simulator (Anvil fork)",
    "Database",
    "LLM gateway (LiteLLM)",
  ];
  if (state === "loading") {
    return labels.map((label) => ({ label, tone: "info" as Tone, value: "checking…" }));
  }

  const reachable = state === "ok" && d !== null;
  const c = d?.checks ?? {};

  /** `true` up · `false` down · `undefined` NOT REPORTED — never silently "down". */
  const check = (label: string, ok: boolean | undefined, up: string, down: string): Tile => {
    if (!reachable) return { label, tone: "amber", value: "unknown" };
    if (ok === undefined) return { label, tone: "info", value: "not reported" };
    return { label, tone: ok ? "ok" : "amber", value: ok ? up : down };
  };

  return [
    { label: "Agent service", tone: reachable ? "ok" : "amber", value: reachable ? "Up" : "Unreachable" },
    check("Chain RPC", c.chain_rpc, "Healthy", "Down"),
    // 023 added this and nothing surfaced it, though it is the check that matters most: an RPC
    // that answers while reporting the WRONG chain would otherwise read as perfectly healthy.
    check("Chain identity", c.chain_identity, "Verified", "Mismatch"),
    check("Simulator (Anvil fork)", c.sim_fork, "Available", "Down"),
    check("Database", c.postgres, "Connected", "Down"),
    check("LLM gateway (LiteLLM)", c.llm, "Live", "Down"),
  ];
}
