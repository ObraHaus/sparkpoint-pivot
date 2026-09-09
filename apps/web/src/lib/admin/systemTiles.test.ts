/**
 * The bug this file exists to prevent, and the rule that replaces it.
 *
 * Feature 023 renamed the agent's readiness check `base_rpc` to `chain_rpc`. The System panel kept
 * reading `base_rpc`. The field was optional, so `undefined` was perfectly legal TypeScript, and
 * `undefined ? up : down` rendered "Down". From 2026-07-30 the console reported a Base RPC outage
 * continuously while the RPC was healthy — nothing errored, nothing was logged, and the panel was
 * confidently wrong on the one screen an operator checks during an incident.
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import { EXPECTED_CHECKS, tilesFrom, type ReadyzDetail } from "./systemTiles.ts";

const HEALTHY: ReadyzDetail = {
  ready: true,
  checks: { chain_rpc: true, chain_identity: true, sim_fork: true, llm: true, postgres: true },
};

const valueOf = (d: ReadyzDetail | null, label: string) =>
  tilesFrom("ok", d).find((t) => t.label === label);

test("a healthy agent shows every dependency as up", () => {
  for (const t of tilesFrom("ok", HEALTHY)) {
    assert.equal(t.tone, "ok", `${t.label} should be ok, got ${t.value}`);
  }
});

test("THE BUG: a check the agent never sent must not read as an outage", () => {
  // This is the exact payload that produced the false alarm: the old key is gone, so the panel's
  // lookup returns undefined. It must read as "not reported", never as "Down".
  const renamed = { ready: true, checks: { chain_rpc: true } } as ReadyzDetail;
  const tile = valueOf(renamed, "Simulator (Anvil fork)");
  assert.equal(tile?.value, "not reported");
  assert.notEqual(tile?.tone, "amber", "an absent check must not be shown as a failure");
});

test("a check reported false IS an outage, and still says so", () => {
  // The fix must not make the panel unable to report anything. Absence and failure are different,
  // and only one of them is quiet.
  const down = { ready: false, checks: { ...HEALTHY.checks, chain_rpc: false } } as ReadyzDetail;
  const tile = valueOf(down, "Chain RPC");
  assert.equal(tile?.value, "Down");
  assert.equal(tile?.tone, "amber");
});

test("chain identity is surfaced, because a wrong-chain RPC looks healthy", () => {
  // 023 added this check and nothing displayed it. An RPC that answers while reporting the wrong
  // chain is the dangerous failure — it passes every liveness test there is.
  const mismatch = { ready: false, checks: { ...HEALTHY.checks, chain_identity: false } } as ReadyzDetail;
  const tile = valueOf(mismatch, "Chain identity");
  assert.equal(tile?.value, "Mismatch");
  assert.equal(tile?.tone, "amber");
});

test("an unreachable agent is unknown, not a pile of false outages", () => {
  // If we cannot reach the agent we know nothing about its dependencies. Rendering five red tiles
  // would invent four outages we have no evidence for.
  const tiles = tilesFrom("error", null);
  assert.equal(tiles[0].value, "Unreachable");
  for (const t of tiles.slice(1)) assert.equal(t.value, "unknown");
});

test("loading says loading", () => {
  assert.ok(tilesFrom("loading", null).every((t) => t.value === "checking…" && t.tone === "info"));
});

test("the expected checks match the tiles that are rendered", () => {
  // The list and the rendering must not drift apart: a check added to one and not the other is how
  // the last one went missing.
  assert.deepEqual([...EXPECTED_CHECKS], ["chain_rpc", "chain_identity", "sim_fork", "llm", "postgres"]);
  assert.equal(tilesFrom("ok", HEALTHY).length, EXPECTED_CHECKS.length + 1, "one tile per check, plus the agent itself");
});
