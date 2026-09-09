/**
 * 042 — pins the RPC-proxy section's two survival rules.
 *
 * 1. ABSENCE IS NOT FAILURE: a series the proxy never sent renders "not reported", never a red
 *    tile (the 035 lesson — a renamed readiness field rendered as a fake outage for five weeks).
 * 2. WIRE NAMES LIVE IN ONE PLACE: every fixture below is COMPOSED from `SERIES`, so when Stage 0
 *    (tasks T006) verifies the names against the live /metrics output and corrects the table,
 *    these tests re-pin to the corrected names automatically — a fixture written with literal
 *    strings would keep passing against names the real proxy no longer emits (the 037 lesson:
 *    guessed wire keys passed 12 unit tests while every real request fell through).
 */

import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  parseRpcProxyMetrics,
  rpcProxyTilesFrom,
  SERIES,
  type RpcProxySnapshot,
} from "./rpcProxyTiles.ts";

/** A realistic exposition composed from SERIES — two upstreams, cache counters, rate limits. */
const EXPOSITION = `
# HELP ${SERIES.requestTotal} Total requests attempted per upstream
# TYPE ${SERIES.requestTotal} counter
${SERIES.requestTotal}{project="core",network="evm:84532",upstream="alchemy-base-sepolia"} 600
${SERIES.requestTotal}{project="core",network="evm:84532",upstream="base-sepolia-public"} 400
${SERIES.errorsTotal}{project="core",network="evm:84532",upstream="base-sepolia-public"} 12
${SERIES.durationSeconds}_bucket{upstream="alchemy-base-sepolia",le="0.05"} 300
${SERIES.durationSeconds}_bucket{upstream="alchemy-base-sepolia",le="0.25"} 540
${SERIES.durationSeconds}_bucket{upstream="alchemy-base-sepolia",le="+Inf"} 600
${SERIES.durationSeconds}_sum{upstream="alchemy-base-sepolia"} 41.5
${SERIES.durationSeconds}_count{upstream="alchemy-base-sepolia"} 600
${SERIES.cacheHitTotal}{connector="mem"} 750
${SERIES.cacheMissTotal}{connector="mem"} 250
${SERIES.corsBlockedTotal}{project="app"} 17
`;

const snapshot = (over: Partial<RpcProxySnapshot>): RpcProxySnapshot => ({
  reachable: true,
  configured: true,
  scrapedAt: "2026-08-04T00:00:00.000Z",
  ...over,
});

const tile = (tiles: ReturnType<typeof rpcProxyTilesFrom>, label: string) => {
  const t = tiles.find((x) => x.label === label);
  assert.ok(t, `tile ${label} must exist`);
  return t;
};

test("parses per-upstream totals, error rate, share, and quantiles from the exposition", () => {
  const parsed = parseRpcProxyMetrics(EXPOSITION);
  assert.ok(parsed.upstreams);
  const byId = new Map(parsed.upstreams.map((u) => [u.id, u]));

  const alchemy = byId.get("alchemy-base-sepolia");
  assert.ok(alchemy);
  assert.equal(alchemy.chainId, 84532);
  assert.equal(alchemy.requests, 600);
  assert.equal(alchemy.sharePct, 60);
  // p50: target 300 of 600 lands exactly on the 0.05s bucket edge → 50ms.
  assert.ok(alchemy.p50Ms !== undefined && Math.abs(alchemy.p50Ms - 50) < 1e-6);
  // p95: target 570 exceeds the last finite bucket (540) → lands in +Inf, which reports the
  // last finite edge (250ms) rather than inventing a number beyond what the histogram knows.
  assert.ok(alchemy.p95Ms !== undefined && Math.abs(alchemy.p95Ms - 250) < 1e-6);

  const pub = byId.get("base-sepolia-public");
  assert.ok(pub);
  assert.equal(pub.errorRatePct, 3);
  // No histogram for this upstream → latency honestly absent, not zero.
  assert.equal(pub.p50Ms, undefined);

  assert.equal(parsed.cache?.hitRatePct, 75);
  assert.equal(parsed.cache?.savedCalls, 750);
  assert.equal(parsed.corsBlocked, 17);
});

test("THE RULE: a series the proxy never sent is absent — not zero, not an outage", () => {
  const parsed = parseRpcProxyMetrics(
    `${SERIES.requestTotal}{upstream="alchemy-base-sepolia",network="84532"} 10\n`,
  );
  assert.equal(parsed.cache, undefined, "no cache series ⇒ no cache object");
  assert.equal(parsed.corsBlocked, undefined);

  const tiles = rpcProxyTilesFrom("ok", snapshot(parsed));
  assert.equal(tile(tiles, "Cache hit rate").tone, "info");
  assert.equal(tile(tiles, "Cache hit rate").value, "not reported");
  assert.equal(tile(tiles, "Foreign-origin blocks").value, "not reported");
  // But what WAS reported renders as data:
  assert.equal(tile(tiles, "Upstreams reporting").value, "1/1 healthy");
});

test("an upstream id we don't recognize still renders — never filtered to an expected list", () => {
  const parsed = parseRpcProxyMetrics(
    `${SERIES.requestTotal}{upstream="renamed-by-an-upgrade",network="evm:1"} 5\n`,
  );
  assert.equal(parsed.upstreams?.length, 1);
  assert.equal(parsed.upstreams?.[0].id, "renamed-by-an-upgrade");
  assert.equal(parsed.upstreams?.[0].chainId, 1);
});

test("proxy unreachable is a reported state (amber tile), and facts show em-dash, not 'not reported'", () => {
  const tiles = rpcProxyTilesFrom("ok", snapshot({ reachable: false }));
  assert.equal(tile(tiles, "RPC proxy").tone, "amber");
  assert.equal(tile(tiles, "RPC proxy").value, "Unreachable");
  assert.equal(tile(tiles, "Cache hit rate").value, "—");
});

test("not configured is info — an unset env var is a state, never an outage", () => {
  const tiles = rpcProxyTilesFrom("ok", snapshot({ reachable: false, configured: false }));
  assert.equal(tile(tiles, "RPC proxy").tone, "info");
  assert.equal(tile(tiles, "RPC proxy").value, "not configured");
});

test("the admin ROUTE erroring is distinct from the proxy being down: every tile goes unknown", () => {
  for (const t of rpcProxyTilesFrom("error", null)) {
    assert.equal(t.tone, "amber");
    assert.equal(t.value, "unknown");
  }
  for (const t of rpcProxyTilesFrom("loading", null)) {
    assert.equal(t.tone, "info");
    assert.equal(t.value, "checking…");
  }
});

test("an upstream at ≥2% errors turns the aggregate tile amber", () => {
  const parsed = parseRpcProxyMetrics(
    `${SERIES.requestTotal}{upstream="ok-one",network="84532"} 100\n` +
      `${SERIES.requestTotal}{upstream="sick-one",network="46630"} 100\n` +
      `${SERIES.errorsTotal}{upstream="sick-one",network="46630"} 5\n`,
  );
  const tiles = rpcProxyTilesFrom("ok", snapshot(parsed));
  assert.equal(tile(tiles, "Upstreams reporting").tone, "amber");
  assert.equal(tile(tiles, "Upstreams reporting").value, "1/2 healthy");
});

test("malformed lines and NaN values are skipped, never clamped into fake zeros", () => {
  const parsed = parseRpcProxyMetrics(
    `garbage line without value\n` +
      `${SERIES.requestTotal}{upstream="a",network="84532"} NaN\n` +
      `${SERIES.requestTotal}{upstream="a",network="84532"} 7\n`,
  );
  assert.equal(parsed.upstreams?.[0].requests, 7);
});

test("an unreachable snapshot carries its failure class into the tile", () => {
  const tiles = rpcProxyTilesFrom("ok", snapshot({ reachable: false, reason: "dns" }));
  assert.equal(tile(tiles, "RPC proxy").tone, "amber");
  assert.equal(tile(tiles, "RPC proxy").value, "Unreachable (dns)");
});
