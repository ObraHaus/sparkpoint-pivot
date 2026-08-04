# Data Model: RPC Proxy — resilient, cached chain access

**Date**: 2026-08-04 · No database entities and no migrations. The feature's data model is (1) the typed metrics snapshot crossing the admin wire, (2) the tile contract derived from it, and (3) the configuration entities that live in `ops/erpc/erpc.yaml` (IaC, summarized in [contracts/proxy-endpoints.md](contracts/proxy-endpoints.md)).

## 1. RpcProxySnapshot (wire shape: `GET /api/admin/rpc-proxy` → panel)

Every field that can be absent is optional **with meaning**: absent = "not reported", never a failure (FR-012). The route emits only what it actually parsed from live metrics; it never fabricates zeros.

```ts
export type BreakerState = "closed" | "open" | "half-open";

export interface UpstreamStat {
  id: string;                    // e.g. "alchemy-base-sepolia" — from the metrics label, verbatim
  chainId: number;               // 84532 | 1 | 46630
  errorRatePct?: number;         // absent ⇒ not reported
  p50Ms?: number;
  p95Ms?: number;
  sharePct?: number;             // of served (non-cache) requests, window = scrape window
  breaker?: BreakerState;
  rateLimitedCount?: number;     // requests this upstream refused/deferred on budget
}

export interface RpcProxySnapshot {
  reachable: boolean;            // false ⇒ scrape failed; panel renders "unreachable", rest untouched
  scrapedAt: string;             // ISO-8601, server clock (UTC — the 032/033 future-dated lesson)
  proxy?: { version?: string; uptimeS?: number };
  upstreams?: UpstreamStat[];    // absent ≠ empty: absent ⇒ series missing; [] ⇒ series present, none
  cache?: { hitRatePct?: number; savedCalls?: number };   // over the scrape window
  budget?: { alchemyUsedPct?: number };                   // used/cap over the last second-bucket
  absorbed429s?: number;         // provider throttles retried away (window)
}
```

**Validation rules**
- `scrapedAt` is stamped by the route from the server clock in UTC.
- Percentages clamped to [0, 100]; negative counters dropped (treated as not reported), never clamped to 0.
- Upstream `id` and metric names are **verbatim from the live endpoint** — pinned in `rpcProxyTiles.test.ts` at Stage 0, never guessed (research D7).
- Unknown upstream ids render as rows anyway (the panel must not filter to an expected list — a renamed upstream must appear, not vanish).

## 2. Tile contract (`rpcProxyTiles.ts` — pure leaf)

Derivation `tilesFrom(state, snapshot) → Tile[]`, mirroring `systemTiles.ts`:

| Tile | Source | ok | amber | info ("not reported" / "checking…") |
|---|---|---|---|---|
| Proxy | `reachable` (+ version/uptime) | reachable | unreachable | route itself errored → "unknown" |
| Cache hit rate | `cache.hitRatePct` | value shown (no thresholding — a number, not a judgment) | — | absent |
| Calls saved | `cache.savedCalls` | value | — | absent |
| 429s absorbed | `absorbed429s` | value ("N retried, 0 surfaced") | — | absent |
| Alchemy budget | `budget.alchemyUsedPct` | <80% | ≥80% | absent |
| Per-upstream rows | `upstreams[]` | errorRate <2% ∧ breaker=closed | otherwise | field-level absent → "—" |

**Tri-state rule (pinned by test, both sides of the wire)**: `true`/present-healthy → ok; present-unhealthy → amber; **absent → info "not reported"** — never amber. The panel contains no mutating controls (FR-013); links only (endpoints, metrics, Kuma, `ops/erpc/ROLLBACK.md`).

## 3. Configuration entities (IaC — not runtime data)

| Entity | Cardinality | Key attributes (contract in proxy-endpoints.md) |
|---|---|---|
| Consumer lane (eRPC project) | 2: `core`, `app` | auth posture (secret vs none), CORS origins (`app` only), budget ref, reachable networks |
| Upstream | 4 | endpoint, chainId, budget ref (Alchemy only), `ignoreMethods` scope, score multiplier |
| Routing policy | per network | AA-methods pin (Alchemy-only), getLogs exclusion + auto-split, hedge/retry/timeout |
| Cache policy | Stage A set | finality=finalized, ttl=permanent, memory connector; **no mutable-data entries may exist** (FR-003 — reviewed as part of any `erpc.yaml` change) |
| Budget | 2 | `alchemy-free` 15 req/s; `app-public` 100 req/s |

## State transitions

Only the cutover itself has state: `direct → proxied` per consumer (indexers, agent, browsers), each transition being one env value in Coolify and its inverse the rollback (SC-007). No runtime state machine exists in repo code; upstream breaker states are eRPC-internal and merely *rendered* here.
