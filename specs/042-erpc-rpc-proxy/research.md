# Research: RPC Proxy — resilient, cached chain access

**Date**: 2026-08-04 · All findings below were live-verified during the 2026-08-03 investigation that produced the approved plan artifact `254642b6`. No NEEDS CLARIFICATION markers remained in the spec; this file records the decisions, their rationale, and the verified facts they rest on.

## Verified findings (the ground truth this feature is built on)

| # | Finding | How verified |
|---|---|---|
| F1 | The Alchemy key ships inside the public JS bundle via `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` | Live Coolify env of the web app (read-only token); `NEXT_PUBLIC_*` is compiled into served JS |
| F2 | Zero RPC 429/retry handling anywhere: every transport treats non-200 as flat failure | Repo audit: `vault_reader.py` (VaultUnavailable), `execution/rpc.py` (→ `None`), `log_source.py`/`swap_fee_indexer.py` (window//=4 on any exception) |
| F3 | Indexers are exiled to public `sepolia.base.org` (UA spoof + 0.35 s pacing) because Alchemy free caps `eth_getLogs` at 10 blocks | `VAULT_INDEX_RPC_URL=https://sepolia.base.org` in live agent env; `log_source.py` comments + pinned tests |
| F4 | Alchemy silently doubles as the ERC-4337 bundler: UserOps go to the same RPC URL | `orchestrate.py:549` sends `eth_sendUserOperation` to `config.rpc_url`; `BUNDLER_URL` env exists but is unread |
| F5 | Alchemy free = 500 CU/s ≈ ~19 `eth_call`/s shared by agent + all browsers; one swap-quote keystroke fires up to 12 parallel calls | Alchemy docs (throughput/compute-units); `lib/swap/route.ts` fan-out |
| F6 | The agent's fail-closed chain-identity assertion probes `eth_chainId` per (chain, url) with a 60 s TTL | Feature 023; `chain/chain_identity.py` |
| F7 | eRPC: ports 4000/4001, finality-aware cache policies, `ignoreMethods`/`allowMethods` routing, per-upstream rate budgets + auto-tune, `eth_getLogsSplitOnError`, hedging/circuit breakers, Prometheus metrics (`erpc_upstream_request_total`, `_duration_seconds`, `_errors_total`, `erpc_rate_limits_total`) | eRPC docs (deployment, cache drivers/policies, upstreams, production) |
| F8 | `/admin/system` is a five-section `AdminSections` console; tiles follow a tri-state contract pinned by `systemTiles(.test).ts` ("absence is not failure") | Repo at `origin/develop` (post-035) |
| F9 | The public `/exit` page reads chain state through the shared web read client — the same client Stage 3 points at the proxy | `lib/chain/exit.ts` / `lib/chain/clients.ts` |
| F10 | Etherscan/BaseScan API is deploy-time-only (forge verify); the web app only links to BaseScan; portfolio history comes from the platform's own indexer | Full-tree grep incl. `origin/develop`; position page labels history "indexed on-chain" |

## Decisions

### D1 — Proxy software: eRPC
**Decision**: eRPC (`ghcr.io/erpc/erpc`, pinned tag).
**Rationale**: purpose-built for this exact read pattern (indexers + high-poll frontends): reorg-aware finality-scoped caching, in-flight dedup, method-level routing, per-upstream budgets with auto-tune, getLogs auto-split — each maps 1:1 onto a verified finding (F2, F3, F4, F5). Multi-chain in one instance covers 84532 + 1 + 46630.
**Alternatives considered**: **proxyd** (OP Labs) — unmatched pedigree, but immutable-only caching, effectively per-chain instances, and no cache-driven cost story (our stated goal); kept as fallback if eRPC misbehaves. **Goldsky Edge** — managed eRPC; rejected: paid external dependency contradicts the self-hosted/$0 goal. **blutgang / rpcgate / web3-proxy / dshackle** — lighter or unmaintained; rejected on maturity.

### D2 — Hosting: Coolify service on the existing host
**Decision**: Coolify service `sparkpoint-erpc` from `ops/erpc/compose.yaml`; LAN name for the `core` lane, public HTTPS FQDN (Coolify's proxy terminates TLS) for the `app` lane; port 4001 (metrics) LAN-only.
**Rationale**: same host as agent + web ⇒ container-network reachability, no new LXC, no new cost; Coolify is the established deploy surface (and its env editor is what makes stages 1–3 one-line reversible).
**Alternatives**: new LXC (more isolation, more ops surface — unneeded at alpha); spark-mon box (512 MB, already tight with Kuma).

### D3 — Two consumer lanes (eRPC projects): `core` and `app`
**Decision**: `core` = agent + web server + indexers, secret-token auth, LAN URL. `app` = browsers, public HTTPS, CORS allowlist (alpha.sparkpoint.io + aldrickb domains), own budget, no secret.
**Rationale**: browsers can't hold secrets, so the public lane must be open — separating lanes gives it its own budget (abuse can't drain the paid provider, FR-007) and separates metrics by consumer. CORS stops browsers; the budget bounds curl-level abuse (accepted residual risk on a testnet).
**Alternatives**: one shared public project (agent traffic then unauthenticated + budgets/metrics blended — rejected); per-IP limiting (revisit only if the panel shows abuse).

### D4 — Cache policy: Stage-A finalized/immutable only, in-memory
**Decision**: permanent cache for finalized `eth_getLogs`/blocks/receipts/`eth_chainId`; memory connector (512 MB, GOMEMLIMIT ≈ 90% of container); **no mutable-data caching in this feature**.
**Rationale**: the one product-breaking failure mode is a stale balance after a deposit — Stage A makes it impossible by construction (spec edge case; FR-003). Finalized-only alone makes backfills and indexer tail re-scans nearly free (SC-003). eRPC's realtime freshness gate fails open in its first ~60 s after boot — another reason mutable caching waits for its own feature.
**Alternatives**: 2 s realtime TTL now (rejected: needs its own in-browser deposit-freshness verification); Postgres connector for restart-survival (upgrade path if memory eviction churns — revisit with a week of hit-rate data).

### D5 — Method routing
**Decision**: the five AA methods (`eth_sendUserOperation`, `eth_estimateUserOperationGas`, `eth_getUserOperationReceipt`, `eth_getUserOperationByHash`, `eth_supportedEntryPoints`) are `ignoreMethods` on every non-Alchemy upstream ⇒ pinned to the bundler-capable provider (F4, FR-005) **with zero agent code change** — the unread `BUNDLER_URL` split becomes unnecessary. `eth_getLogs` is `ignoreMethods` on Alchemy (10-block cap, F3) ⇒ served by `sepolia.base.org` with `eth_getLogsSplitOnError: true` (FR-006). Everything else: health-scored, hedged at p80 ≥150 ms, Alchemy budget-capped.
**Alternatives**: honoring `BUNDLER_URL` in agent code (rejected: violates the env-only cutover, FR-010); letting Alchemy take getLogs with auto-split (rejected: a 2000-block window would split into ~200 sub-requests against the budget).

### D6 — Alchemy budget: 15 req/s hard cap + auto-tune
**Decision**: `rateLimitBudget` 15 req/s on the Alchemy upstream.
**Rationale**: 500 CU/s ÷ 26 CU (`eth_call`) ≈ 19 req/s effective ceiling; 15 leaves headroom for method-cost variance (F5). Auto-tune backs off further on error-rate spikes; overflow fails over to the public upstream instead of erroring (FR-002/SC-004).

### D7 — Console data plumbing: server-side metrics scrape, names pinned from live output
**Decision**: `GET /api/admin/rpc-proxy` (admin-gated, ~5 s in-route cache) fetches `http://<erpc-lan>:4001/metrics`, parses a **selected** set of `erpc_*` series into the typed snapshot in data-model.md. The exact metric names are read off the live endpoint during Stage 0 and pinned in `rpcProxyTiles.test.ts` — never guessed (the 037 `tip.topic` lesson: guessed wire keys passed 12 unit tests while every real request fell through).
**Rationale**: keeps the metrics port off the public internet; matches the console's existing agent-scrape rhythm (15 s poll); the pure-leaf tile module mirrors `systemTiles` because that shape is what made the 5-week false-"Down" bug impossible to reintroduce (F8).
**Alternatives**: browser fetches metrics directly (rejected: exposes 4001 + traffic shape); extending agent `/readyz` (rejected: agent stays untouched; EXPECTED_CHECKS is a pinned two-sided contract).

### D8 — Exit-page independence (N2)
**Decision**: `/exit` reads move to a dedicated read client pinned to public endpoints (viem's default public RPC for the chain), regardless of `NEXT_PUBLIC_*` proxy values (F9, FR-016, SC-008).
**Rationale**: the constitution's N2 requires exit to work with SparkPoint entirely offline; Stage 3 would otherwise silently route the escape hatch through the new single point of failure. Verified live with the proxy stopped (quickstart).
**Alternatives**: leaving exit on the proxied client with a documented fallback (rejected: N2 is by-construction, not by-runbook).

### D9 — Rollout order and reversibility
**Decision**: stages 0–4 as in plan.md, lowest blast radius first, each gated on the previous stage's quickstart verification, every stage reversible by env restore (SC-007); Kuma monitor added at Stage 0 (FR-018); Alchemy key rotated only after SC-002's bundle grep passes.
**Rationale**: mirrors the shipped playbook of 026–038: live-verify each increment (the 029 lesson — a browser run catches what a green suite cannot).

## Open items deliberately deferred (recorded, not blocking)

- Stage-B mutable-data caching (own feature, own freshness verification).
- Chainstack as an additional upstream (revisit when the panel shows Alchemy budget sustained >70%).
- Postgres cache connector (revisit with real hit-rate data).
- Public FQDN choice: `rpc.aldrickb.app` default; a sparkpoint.io subdomain is one CORS line + one env later.
- Indexer cursor-lag tile in the System section (separate small feature; noted during review).

## Stage-0 captured facts (2026-08-04 — live boots of ghcr.io/erpc/erpc:0.1.1)

**Deployment reality**: the Coolify host is a public VPS (139.59.99.233), NOT the home LAN —
so no host ports are mapped at all. Both lanes ride the service's generated domain
`erpc-t84o44c0ss04k0oswc00wg0k.aldrickb.app` through Coolify's TLS proxy (`core` protected by
`?secret=`, `app` CORS-fenced + own budget); the metrics port 4001 has no domain and is
reachable only container-to-container (`http://sparkpoint-erpc:4001/metrics`).

**Schema corrections found by booting (the deploy IS the schema check)**: eRPC 0.1.1 rejects
unknown top-level keys (no `x-*` anchor blocks — anchors now live inline), `failsafe` is a LIST,
`getLogsSplitOnError` lives at `networkDefaults.evm` (not `integrity`), and `hedge` takes
`{delay, maxCount}` (no quantile in 0.1.1). Coolify beta.434's service API additionally requires
the compose to be pure ASCII (`mb_detect_encoding(..., 'ASCII')`) — the SQL_ASCII lesson in a
new costume.

**Verified locally before any traffic**: all three chains answer on `core` (0x14a34 / 0x1 /
0xb626 — note 46630 = 0xb626, an earlier doc said 0xb616); no-secret is refused; CORS allows
the platform origin and returns zero allow-headers to a foreign origin; a 2000-block
`eth_getLogs` (5,878 logs) took 1652ms cold and **30ms cached** on the identical repeat;
`eth_supportedEntryPoints` answers (Alchemy-only AA pin works); a budget=1 hammer showed
failover keeps serving (11/25 during a 25-shot burst) — and revealed 0.1.1 has NO local
rate-limit counter, so the console's fifth tile reads `erpc_cors_disallowed_origin_total`
instead (D7 amended: pinned names now in `SERIES`, corrected from the doc-guessed cache names —
the pin-don't-guess rule caught two wrong guesses exactly as designed).

## Stage-1/2 execution notes (2026-08-04)

- **Stage 1**: all three indexer streams advanced through the core lane within two ticks
  (base +208 / robinhood +1,260 blocks); rollback drill ran (env restore + restart cycle
  well under 60s). `ROBINHOOD_INDEX_RPC_URL` was also set (the 46630 indexer's own env),
  giving the 0.3s-block chain cached, retried reads.
- **Stage 2**: `/readyz` green end-to-end (the 023 chain-identity assertion validating the
  proxy); browser runs: SIWE mint + admit, live portfolio, non-allowlisted wallet through
  the SRK gate (the one mainnet read, via `/core/evm/1`) to the honest block + application
  form; deposit quote returning live chain values; AA path proven by Alchemy's own bundler
  validation error arriving through the proxy. Two STALE E2E EXPECTATIONS surfaced and were
  fixed (a pre-onboarded wallet gets "Continue to app" not "Start onboarding"; stage copy
  says "Alpha" not "Beta") — the specs predated 026/029 copy changes; the product was right.
- **Throttle drill (SC-001)**: with the Alchemy budget crushed to 1 req/s on the LIVE proxy,
  5/5 agent deposit quotes (8 sequential chain reads each) succeeded via failover — slower
  (~6s each), zero user-visible errors. **Cold-start finding**: the same drill run seconds
  after a proxy restart failed 0/5 — for ~60s after boot, upstream scoring is cold and
  failover is unreliable; additionally a chainId up-probe lies (it's answered from the
  permanent cache). Probes must use `eth_blockNumber`; proxy restarts are brief degradation
  windows (Kuma + the panel make them visible). Deferred from T011, recorded honestly: the
  full session-key user journey (SC-006's browser run) and a premium payment verify — the
  routing layer both depend on is proven (AA pin + receipt reads are the same reader class).
