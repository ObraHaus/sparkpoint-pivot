# Implementation Plan: RPC Proxy — resilient, cached chain access

**Branch**: `feat/039-erpc-rpc-proxy` | **Date**: 2026-08-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/042-erpc-rpc-proxy/spec.md`

## Summary

Put a self-hosted **eRPC** proxy (single Go container) in front of every blockchain RPC dependency, then cut consumers over in independently reversible, env-only stages: background indexers → agent request path → browsers. The proxy adds retries/hedging/circuit-breaking failover, finalized-only caching with in-flight dedup, per-consumer budgets, and method routing that pins the five ERC-4337 bundler methods to Alchemy (which silently doubles as the bundler today) and `eth_getLogs` to the range-capable public upstream with auto-split. The Alchemy key leaves the public JS bundle and is rotated. Stage 4 is the only code stage: a sixth read-only **"RPC proxy"** section in `/admin/system` fed by an admin-gated server route that scrapes eRPC's Prometheus metrics, plus pinning the public `/exit` page's reads to a public endpoint so the escape hatch never depends on the new component (N2). Authoritative technical reference: the operator-approved plan artifact `254642b6` (2026-08-03), grounded in a full repo RPC audit and the live Coolify env.

## Technical Context

**Language/Version**: TypeScript 5 / Next.js App Router (apps/web); YAML (eRPC config); no agent (Python) code changes — the cutover is env-only by design (FR-010)

**Primary Dependencies**: eRPC `ghcr.io/erpc/erpc` (pinned tag, Apache-2.0); existing wagmi/viem read clients; existing `AdminSections`/`SectionTabs` console framework; no new npm/python dependencies

**Storage**: none — no DB migrations; eRPC Stage-A cache is in-process memory (512 MB budget)

**Testing**: repo's existing web unit runner for pure leaf modules (`rpcProxyTiles.test.ts` mirrors `systemTiles.test.ts`, incl. the strict `typecheck:test` leaf constraints — no `@/` value imports); Playwright for the console section (minted `sp_session` pattern); live verification per quickstart.md for each cutover stage

**Target Platform**: Coolify service on the existing host (LAN name for `core` lane; public HTTPS FQDN via Coolify's proxy for the `app` lane); consumers are the agent container, the web server, and user browsers

**Project Type**: web application (monorepo: apps/web + services/agent) + ops config (new `ops/erpc/`)

**Performance Goals**: SC-004 — paid-provider rate never exceeds its 15 req/s budget (safely under Alchemy free's 500 CU/s ≈ ~19 eth_call/s); SC-005 — console data ≤15 s stale; SC-003 — repeat backfill ≤1% of original provider calls

**Constraints**: cache MUST be finalized/immutable-only (stale-balance bug impossible by construction — mutable-data caching is a separate future feature); writes never retried into double-submit; each stage reversible ≤5 min by env restore (SC-007); exit page functional with the proxy stopped (SC-008); metric names read off the live endpoint, never guessed

**Scale/Scope**: alpha/testnet (~15k background RPC calls/day + browser traffic); 3 networks (84532, 1, 46630); ~6 new web files + 2 edited, ~3 ops files, 0 migrations

## Constitution Check

*GATE: evaluated against constitution v3.0.0 — PASS (pre-research and re-checked post-design). No Complexity Tracking entries needed.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Non-custodial (N1–N5) | PASS | The proxy is read/relay infrastructure with no keys, no fund path, no authority over transaction content. **N2 explicitly designed for**: the public `/exit` page gets a dedicated public-RPC read client so the escape hatch gains no SparkPoint-operated dependency (FR-016/SC-008); withdraw path untouched. |
| II. AI proposes, policy + user dispose | PASS | No agent/policy/signing logic touched. Signed payloads remain byte-verbatim; simulation-before-sign unchanged (FR-015). |
| III. Provable, not promised | PASS | The console section renders live metrics with the tri-state tile contract — a metric the proxy doesn't report reads "not reported", never a fabricated state (FR-012; the `base_rpc` 5-week false-"Down" lesson). |
| IV. Bounded blast radius | PASS | Worst case of proxy compromise/outage = failed or degraded *reads*; writes fail closed and honestly. Budgets bound quota abuse; CORS bounds browser abuse; rollback = env restore. The existing fail-closed chain-identity assertion validates every proxied network (FR-014). |
| V. Conservative launch / VII. YAGNI | PASS | No new protocols, no new paid services, one container. Mutable-data caching, Chainstack, Etherscan proxying explicitly deferred. Constitution's "Alchemy (Base RPC)" tooling line is unchanged in substance — Alchemy remains the provider, now behind an operated intermediary; no amendment required. |
| VI. Spec-driven | PASS | This plan traces to spec 039; tasks will trace to both. |

## Project Structure

### Documentation (this feature)

```text
specs/042-erpc-rpc-proxy/
├── spec.md
├── checklists/requirements.md
├── plan.md              # This file
├── research.md          # Phase 0 — decisions + verified findings
├── data-model.md        # Phase 1 — metrics snapshot & tile contract shapes
├── quickstart.md        # Phase 1 — stage-by-stage live verification
├── contracts/
│   ├── admin-metrics-api.md   # GET /api/admin/rpc-proxy
│   └── proxy-endpoints.md     # consumer-lane URL scheme + env mapping + config contract
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
ops/erpc/                                  # NEW — proxy IaC (versioned, operator-applied)
├── erpc.yaml                              # projects core/app, upstreams, routing, budgets, Stage-A cache
├── compose.yaml                           # pinned image, ports 4000 (rpc) / 4001 (metrics, LAN-only)
└── ROLLBACK.md                            # the env-restore runbook the console links to

apps/web/src/
├── lib/admin/rpcProxyTiles.ts             # NEW — pure leaf: metrics JSON → tiles (tri-state)
├── lib/admin/rpcProxyTiles.test.ts        # NEW — pins the tile contract + real metric names
├── app/api/admin/rpc-proxy/route.ts       # NEW — admin-gated scrape of eRPC :4001/metrics → typed JSON
├── components/admin/RpcProxyPanel.tsx     # NEW — sixth section: tiles, upstream table, charts, links
├── app/admin/system/page.tsx              # EDIT — add { id: "rpc", label: "RPC proxy" } section
└── lib/chain/exit.ts (+ clients)          # EDIT — pin /exit reads to a public endpoint (N2/FR-016)

CHANGELOG.md                               # EDIT — developer changelog (FR-017)
services/agent/content_seed/whats-new.json # EDIT — client-facing in-app entry (FR-017)
```

**Structure Decision**: web-app monorepo paths follow the 035 console pattern exactly (panel component + pure-leaf tile module + test on each side of the wire). Proxy configuration is IaC under `ops/erpc/` — versioned in-repo, applied to Coolify by the operator (confirm-before-infra rule); the console only observes. Env cutovers happen in Coolify, not in repo code, which is what makes stages 1–3 reversible without deploys.

## Cutover Stages (order of execution)

| Stage | What changes | Where | Reversal |
|---|---|---|---|
| 0 | Deploy proxy + Kuma monitor, smoke-verify, read real metric names | Coolify (operator-confirmed) | remove service |
| 1 | `VAULT_INDEX_RPC_URL` → core lane | agent env | restore var |
| 2 | `BASE_SEPOLIA_RPC_URL`, `ETH_MAINNET_RPC_URL`, `ROBINHOOD_RPC_URL` → core lane | agent env | restore vars |
| 3 | `NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL` → app lane; server-side SIWE var → core lane; then **rotate Alchemy key** | web env | restore vars |
| 4 | Console section + exit-page pin + both changelogs (the only code PR) | repo | revert PR |

Stages gate on the quickstart verification of the previous stage. Stage 4 code can be developed and tested in parallel with stages 0–3 (the route reads its target from env and the panel handles "unreachable" honestly), but merges only with both changelogs.

## Complexity Tracking

No constitution violations to justify. The one deliberate addition of operational complexity — a new single point of failure for chain reads — is accepted with mitigations (uptime monitoring FR-018, env-restore rollback SC-007, exit-page independence FR-016) rather than justified as a violation.
