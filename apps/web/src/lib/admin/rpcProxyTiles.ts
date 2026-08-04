/**
 * 039 — the RPC-proxy console section's PURE core: Prometheus text → typed snapshot → tiles.
 *
 * LEAF on purpose (no `@/` value imports), like `systemTiles.ts` and for the same reason: the
 * contract this module encodes was the site of the console's worst bug — a renamed wire field
 * rendering as a fake outage for five weeks — so it must be testable directly, with the wire
 * names pinned in one place.
 *
 * TWO RULES, both inherited from hard lessons:
 *
 *  1. ABSENCE IS NOT FAILURE (systemTiles, 035). A series the proxy does not report renders
 *     "not reported" — never "Down". Metrics differ across eRPC versions; a quiet rename must
 *     surface as honest absence, not a red tile an operator learns to ignore.
 *
 *  2. WIRE NAMES ARE PINNED, NEVER GUESSED (037's `tip.topic`: guessed keys passed 12 unit
 *     tests while every real request fell through). `SERIES` below is the single place a name
 *     may live. The names ship as documented by eRPC's docs and are VERIFIED against the live
 *     `/metrics` output at Stage 0 (tasks T006) — if the live endpoint disagrees, this table
 *     (and only this table) changes, and the fixture-driven tests re-pin automatically because
 *     the fixtures are composed from the same constants.
 */

import type { Tile, Tone } from "./systemTiles";

/**
 * The Prometheus series this module reads — the ONLY place these names may appear.
 * PINNED at Stage 0 (2026-08-04) from the LIVE /metrics output of ghcr.io/erpc/erpc:0.1.1 —
 * and the pin earned its keep immediately: the two cache names differed from the docs-derived
 * guesses ("erpc_cache_get_hit_total" does not exist; "success" is in the real name), and the
 * guessed rate-limit counter doesn't exist at all in 0.1.1 (verified by hammering a budget=1
 * config: no local rate-limited counter moved), so that tile now reads the CORS-block counter —
 * a series that exists and is a real abuse signal for the public lane.
 */
export const SERIES = {
  requestTotal: "erpc_upstream_request_total",
  durationSeconds: "erpc_upstream_request_duration_seconds", // histogram (_bucket/_sum/_count)
  errorsTotal: "erpc_upstream_request_errors_total",
  corsBlockedTotal: "erpc_cors_disallowed_origin_total",
  cacheHitTotal: "erpc_cache_get_success_hit_total",
  cacheMissTotal: "erpc_cache_get_success_miss_total",
} as const;

export type BreakerState = "closed" | "open" | "half-open";

export interface UpstreamStat {
  /** The `upstream` label, verbatim — an id we don't recognize still renders (never filtered). */
  id: string;
  /** Digits extracted from the network label (e.g. "evm:84532" → 84532); undefined if unlabelled. */
  chainId?: number;
  /** Cumulative since proxy start (counters have no window) — the panel labels them so. */
  requests?: number;
  errorRatePct?: number;
  sharePct?: number;
  p50Ms?: number;
  p95Ms?: number;
}

export interface RpcProxySnapshot {
  /** false ⇒ the scrape failed (or isn't configured); the panel says so, nothing else breaks. */
  reachable: boolean;
  /** false ⇒ RPC_PROXY_METRICS_URL is unset — "not configured", which is a state, not an error. */
  configured: boolean;
  /** ISO-8601, stamped by the route from the server clock in UTC. */
  scrapedAt: string;
  upstreams?: UpstreamStat[];
  cache?: { hitRatePct?: number; savedCalls?: number };
  corsBlocked?: number;
}

/* ------------------------------- Prometheus parsing ------------------------------- */

interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

const LINE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(-?[0-9.eE+]+|NaN|\+Inf|-Inf)\s*$/;
const LABEL = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;

function parseLines(text: string): Sample[] {
  const out: Sample[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = LINE.exec(line);
    if (m === null) continue;
    const labels: Record<string, string> = {};
    if (m[2] !== undefined) {
      for (const lm of m[2].matchAll(LABEL)) labels[lm[1]] = lm[2];
    }
    const value = m[3] === "+Inf" ? Infinity : m[3] === "-Inf" ? -Infinity : Number(m[3]);
    if (Number.isNaN(value)) continue; // an unparseable value is dropped, not clamped to 0
    out.push({ name: m[1], labels, value });
  }
  return out;
}

/** The upstream id a sample belongs to, across plausible label spellings. */
function upstreamOf(labels: Record<string, string>): string | undefined {
  return labels["upstream"] ?? labels["upstream_id"] ?? labels["upstreamId"];
}

/** Digits of the network label ("evm:84532" | "84532" | "evm_84532") — undefined when absent. */
function chainIdOf(labels: Record<string, string>): number | undefined {
  const raw = labels["network"] ?? labels["network_id"] ?? labels["chain_id"];
  if (raw === undefined) return undefined;
  const digits = raw.replace(/\D/g, "");
  if (digits === "") return undefined;
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : undefined;
}

/** Standard Prometheus histogram quantile via linear interpolation over cumulative buckets. */
function quantileMs(buckets: Map<number, number>, q: number): number | undefined {
  const sorted = [...buckets.entries()].sort((a, b) => a[0] - b[0]);
  if (sorted.length === 0) return undefined;
  const total = sorted[sorted.length - 1][1];
  if (!(total > 0)) return undefined;
  const target = q * total;
  let prevLe = 0;
  let prevCount = 0;
  for (const [le, count] of sorted) {
    if (count >= target) {
      if (!Number.isFinite(le)) return prevLe * 1000; // landed in +Inf: report the last finite edge
      const span = count - prevCount;
      const frac = span > 0 ? (target - prevCount) / span : 1;
      return (prevLe + (le - prevLe) * frac) * 1000;
    }
    prevLe = Number.isFinite(le) ? le : prevLe;
    prevCount = count;
  }
  return undefined;
}

const pct = (part: number, whole: number): number | undefined =>
  whole > 0 ? Math.min(100, Math.max(0, (part / whole) * 100)) : undefined;

/**
 * Parse a Prometheus exposition into the snapshot's data fields. Emits ONLY what the text
 * actually contains — a missing series yields `undefined`, which the tiles render as
 * "not reported" (rule 1). Never throws on malformed lines; they are skipped.
 */
export function parseRpcProxyMetrics(
  text: string,
): Pick<RpcProxySnapshot, "upstreams" | "cache" | "corsBlocked"> {
  const samples = parseLines(text);

  interface Acc {
    chainId?: number;
    requests: number;
    errors: number;
    buckets: Map<number, number>;
  }
  const byUpstream = new Map<string, Acc>();
  const acc = (id: string): Acc => {
    let a = byUpstream.get(id);
    if (a === undefined) {
      a = { requests: 0, errors: 0, buckets: new Map() };
      byUpstream.set(id, a);
    }
    return a;
  };

  let sawRequestSeries = false;
  let cacheHits: number | undefined;
  let cacheMisses: number | undefined;
  let corsBlocked: number | undefined;

  for (const s of samples) {
    const up = upstreamOf(s.labels);
    if (s.name === SERIES.requestTotal && up !== undefined) {
      sawRequestSeries = true;
      const a = acc(up);
      a.requests += s.value;
      a.chainId ??= chainIdOf(s.labels);
    } else if (s.name === SERIES.errorsTotal && up !== undefined) {
      const a = acc(up);
      a.errors += s.value;
      a.chainId ??= chainIdOf(s.labels);
    } else if (s.name === `${SERIES.durationSeconds}_bucket` && up !== undefined) {
      const le = s.labels["le"] === "+Inf" ? Infinity : Number(s.labels["le"]);
      if (!Number.isNaN(le)) {
        const a = acc(up);
        a.buckets.set(le, (a.buckets.get(le) ?? 0) + s.value);
      }
    } else if (s.name === SERIES.cacheHitTotal) {
      cacheHits = (cacheHits ?? 0) + s.value;
    } else if (s.name === SERIES.cacheMissTotal) {
      cacheMisses = (cacheMisses ?? 0) + s.value;
    } else if (s.name === SERIES.corsBlockedTotal) {
      corsBlocked = (corsBlocked ?? 0) + s.value;
    }
  }

  const totalRequests = [...byUpstream.values()].reduce((sum, a) => sum + a.requests, 0);
  const upstreams: UpstreamStat[] | undefined = sawRequestSeries
    ? [...byUpstream.entries()].map(([id, a]) => ({
        id,
        chainId: a.chainId,
        requests: a.requests,
        errorRatePct: pct(a.errors, a.requests),
        sharePct: pct(a.requests, totalRequests),
        p50Ms: quantileMs(a.buckets, 0.5),
        p95Ms: quantileMs(a.buckets, 0.95),
      }))
    : undefined;

  const cache =
    cacheHits !== undefined || cacheMisses !== undefined
      ? {
          hitRatePct:
            cacheHits !== undefined && cacheMisses !== undefined
              ? pct(cacheHits, cacheHits + cacheMisses)
              : undefined,
          savedCalls: cacheHits,
        }
      : undefined;

  return { upstreams, cache, corsBlocked };
}

/* ------------------------------------- Tiles ------------------------------------- */

const fmtInt = (n: number): string => Math.round(n).toLocaleString("en-US");
const fmtPct = (n: number): string => `${n.toFixed(1)}%`;

/**
 * The section's summary tiles. Same tri-state contract as `systemTiles.tilesFrom`:
 * ok = reported-healthy · amber = reported-unhealthy · info = loading / NOT REPORTED.
 */
export function rpcProxyTilesFrom(
  state: "loading" | "ok" | "error",
  snap: RpcProxySnapshot | null,
): Tile[] {
  const labels = ["RPC proxy", "Cache hit rate", "Calls saved by cache", "Foreign-origin blocks", "Upstreams reporting"];
  if (state === "loading") {
    return labels.map((label) => ({ label, tone: "info" as Tone, value: "checking…" }));
  }
  // The admin ROUTE errored (distinct from the proxy being down — the route reports that as data).
  if (state === "error" || snap === null) {
    return labels.map((label) => ({ label, tone: "amber" as Tone, value: "unknown" }));
  }

  const proxy: Tile = !snap.configured
    ? { label: "RPC proxy", tone: "info", value: "not configured" }
    : snap.reachable
      ? { label: "RPC proxy", tone: "ok", value: "Up" }
      : { label: "RPC proxy", tone: "amber", value: "Unreachable" };

  /** A numeric fact: shown when reported, "not reported" when the series is absent (rule 1). */
  const fact = (label: string, v: number | undefined, render: (n: number) => string): Tile =>
    v === undefined
      ? { label, tone: "info", value: snap.reachable ? "not reported" : "—" }
      : { label, tone: "ok", value: render(v) };

  const healthy = snap.upstreams?.filter((u) => (u.errorRatePct ?? 0) < 2).length;

  return [
    proxy,
    fact("Cache hit rate", snap.cache?.hitRatePct, fmtPct),
    fact("Calls saved by cache", snap.cache?.savedCalls, fmtInt),
    fact("Foreign-origin blocks", snap.corsBlocked, fmtInt),
    snap.upstreams === undefined
      ? { label: "Upstreams reporting", tone: "info", value: snap.reachable ? "not reported" : "—" }
      : {
          label: "Upstreams reporting",
          tone: healthy === snap.upstreams.length ? "ok" : "amber",
          value: `${healthy}/${snap.upstreams.length} healthy`,
        },
  ];
}
