# Implementation Plan: Admin Revenue Dashboard (real data)

**Branch**: `feature/013-admin-revenue-dashboard` | **Date**: 2026-07-21 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/013-admin-revenue-dashboard/spec.md`

## Summary

Replace the **100% mock** Admin → Revenue panel with **real, on-chain-derived revenue** across three streams. Today `apps/web/src/app/admin/revenue/page.tsx` does zero fetches and renders inline literals from `apps/web/src/components/admin/data.tsx` (`revByStream` at `:13`) behind a "Sample data" pill (`revenue/page.tsx:56-58`). The replacement fetches a new **admin-gated aggregation endpoint** — `GET /admin/revenue/summary` in a new `services/agent/src/sparkpoint_agent/api/admin_revenue.py` (mirroring `api/admin_usage.py`) — which resolves each stream independently and **honest-degrades to `{configured:false}`** when a source is down:

- **Swap routing fee (new indexer)** — the 0.20% fee (`ROUTING_FEE_BIPS = 20`, `apps/web/src/lib/swap/math.ts:17`) is taken on-chain inside the user-signed Uniswap swap (`sweepTokenWithFee`/`unwrapWETH9WithFee`) but is **indexed nowhere today**. Since those helpers emit no bespoke event (empty `outputs`), a new indexer keys on ERC-20 `Transfer(from = SwapRouter02, to = feeRecipient)`, persisted to a new idempotent ledger `swap_fee_events` (migration **`0017_swap_fee_events.sql`**) with a `(network, stream)` cursor in the existing `indexer_cursors` table (0001). The native-ETH-out leg emits no log → the logs-only MVP under-counts it and **discloses that gap** on the dashboard (Principle III).
- **Performance fee (wire the existing aggregator)** — `FeeIndexer.revenue_summary` (`services/agent/src/sparkpoint_agent/data/fee_indexer.py:611`) already aggregates the `fee_events` ledger (migration 0002) into cumulative + per-period buckets, but is wired only to unit tests; the new endpoint simply calls it.
- **SRK membership (read 012)** — SUM over feature 012's `payments` table by period; `configured:false` until 012's migration is applied.

The web page swaps its `data.tsx` mock import for a `fetch("/api/agent/admin/revenue/summary", { headers: { "x-chain-id": "84532" }, cache: "no-store" })` + state, **keeping the `components/admin/charts.tsx` primitives verbatim** (they take plain `number[]` + a `max`), and drops the "Sample data" pill per-stream as each goes live. A **Multisig balances card** reads the treasury Safe's live native + ERC-20 balances (`eth_getBalance` / `balanceOf`) with no indexer and no migration; the Safe address comes from feature 014.

**Technical approach** (from research.md): extend the proven indexer + admin-endpoint + live-fetch-page patterns rather than add new infrastructure. The swap-fee indexer copies the shape of `data/fee_indexer.py` (idempotent `ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING`, `(network, stream)` cursor, finality margin, reuse `data/log_source.py` `HttpxLogsRpc` + `_addr_from_topic` for keccak-free Transfer decode); the admin endpoint copies `api/admin_usage.py` (require_admin, 404-posture, per-source honest-degrade); the page copies `admin/gateway/page.tsx` (real fetch + hand-built charts) and `admin/system/page.tsx` (which already imports `charts.tsx` primitives). The feature reads on-chain ledgers only and **touches no custody, policy, or funds-movement path** — it is pure instrumentation.

## Technical Context

**Language/Version**: Python 3.12 (`services/agent`, FastAPI/Starlette) — the new swap-fee indexer, the aggregation endpoint, and the perf/membership wiring; TypeScript 5 (Next.js 15 App Router, React 19) for `apps/web` — the rebuilt Revenue page + the multisig balances card. Solidity/Foundry unaffected (no contract change — the fee is already collected on-chain by feature 007's swap path).

**Primary Dependencies**: FastAPI dependencies (`require_admin`), `asyncpg` (Postgres pool), `yoyo` (migrations); the existing keyless JSON-RPC transports (`data/log_source.py` `HttpxLogsRpc` for `eth_getLogs`/receipts, `chain/vault_reader.py` `HttpxJsonRpcTransport` for `eth_getBalance`/`eth_call`); the existing `FeeIndexer.revenue_summary` aggregator; the Next.js BFF (`apps/web/src/app/api/agent/[...path]/route.ts`); existing admin UI primitives (`components/admin/charts.tsx` — `StackedBars, Trajectory, DualArea, Composed, Kpi, LegendStreams`). **No new runtime dependency.**

**Storage**: Postgres (agent-owned) — **1 new table** via `services/agent/migrations/0017_swap_fee_events.sql` (`swap_fee_events`, idempotent on `(network_id, tx_hash, log_index)`) plus a `(network, stream='swap_fee')` row in the existing `indexer_cursors` (0001). The perf stream reads the existing `fee_events` (0002); the membership stream reads feature 012's `payments`. Multisig balances are **live reads — no persistence**.

**Testing**: `pytest` for the agent (swap-fee indexer decode/idempotency/finality/disambiguation units; the `admin_revenue` endpoint incl. per-stream honest-degrade + admin 404-posture; a parity test asserting the perf stream equals `FeeIndexer.revenue_summary`); `node:test`/Vitest for web helpers (series-shaping + max computation); Playwright e2e under `apps/web/e2e/pw` (Revenue page shows real streams + per-stream not-instrumented states + no mock import). A live, non-destructive RPC probe validates the multisig balances card.

**Target Platform**: Web (desktop + mobile admin) + the Python agent service, on the Coolify dev/staging alpha.

**Project Type**: Web application — Next.js frontend + Python agent service.

**Performance Goals**: the summary endpoint is read-only aggregation over indexed ledgers + a cached vault read — sub-request latency; the swap-fee indexer runs as a background loop (mirror the existing `_index_vault_flows_loop`), not on the request path; the multisig card's live reads are a small fixed number of `eth_getBalance`/`balanceOf` calls.

**Constraints**: **provable-only** — no fabricated/projected figures ever render (Principle III); **per-stream honest-degrade** to `configured:false`; **idempotent + finality-safe** swap indexing (no double-count, no reorg retention); **disambiguate shared-treasury transfers** (swap = `from == router`; membership = 012 ledger; perf = `fee_events`); **disclose the native-ETH-out under-count**; server-resolved admin identity only (404-posture); **never** touch a custody/withdraw/exit path; single-replica alpha; testnet scope (8453 / 84532 / 46630).

**Scale/Scope**: 3 revenue streams; 1 new indexer + 1 new table + 1 new cursor row; 1 new admin endpoint; 1 rebuilt page + 1 new balances card; 3 networks; ~1 agent replica.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Checked against `.specify/memory/constitution.md` v1.3.0.

| Principle | Assessment |
|---|---|
| **I. Non-Custodial by Construction (N1–N5, NON-NEGOTIABLE)** | **PASS.** The feature is read-only instrumentation: it indexes and aggregates fees already collected on-chain and reads balances/ledgers. It adds **no** code path that moves user funds (N1), sits nowhere near the withdraw/redeem/exit path (N2 — FR-020), generates/holds no keys (N3), and changes no custody semantics (N4, N5). The multisig card *displays* the Safe's actual on-chain power (a plain holder, no fund-movement authority) — proving N5, not weakening it. |
| **II. AI Proposes, Deterministic Policy + User Disposes (NON-NEGOTIABLE)** | **PASS.** No AI or policy surface is touched. The dashboard is an operator-only read of realized revenue; nothing here proposes, gates, or executes an on-chain action. |
| **III. Provable, Not Promised** | **PASS — this feature is the *embodiment* of the principle.** It replaces fabricated sample revenue with figures reconstructable from on-chain ledgers (FR-001), honest-degrades per stream to `configured:false` (FR-002), distinguishes a real `$0` from an un-configured stream (FR-005), discloses the native-ETH-out under-count (FR-009), and forbids any projection or yield promise (FR-021). Mirrors the 008 FR-022/SC-004 honest-degrade pattern. |
| **IV. Security & Bounded Blast Radius** | **PASS.** The new endpoint is admin-gated with the 404-invisible posture (FR-016), keyed on the server-verified owner (never a client claim). The swap indexer is idempotent and finality-bounded (FR-006–008), so a reorg or a re-run cannot corrupt the ledger. No contract change; no new externally-reachable surface beyond an admin read. |
| **V. Conservative, Transparent Launch** | **PASS.** Nothing here gates any core capability on SRK or premium; the membership *revenue* is merely *reported*, not a gate. The vault fee model is unchanged — the perf stream reads the existing `fee_events` ledger. SRK stays non-essential (the membership stream honest-degrades when 012 is absent). |
| **VI. Spec-Driven Development (NON-NEGOTIABLE)** | **PASS.** This plan follows spec → plan → tasks; no code lands before tasks exist; plan/spec/research trace to each other and to the constitution. |
| **VII. Simplicity & YAGNI** | **PASS with a recorded scope note (below).** Reuses existing patterns (`fee_indexer` indexer shape, `log_source` decode, `admin_usage` endpoint, `charts.tsx`, `admin/gateway` fetch page); one new table, one new cursor row, one new endpoint; logs-only swap capture with a disclosed gap rather than a `debug_traceTransaction` dependency; live balance reads instead of a snapshot table. Networks stay Base 8453 / 84532 / 46630. |

**Recorded scope note (Principle VII / III — logs-only swap capture + cross-feature reads).** The swap-fee indexer captures the ERC-20-out fee leg from `Transfer` logs and **deliberately does not** add `debug_traceTransaction` for the native-ETH-out leg (`unwrapWETH9WithFee` emits no log). That is a YAGNI choice for the MVP: rather than take on a trace-RPC dependency, the shortfall is **disclosed** on the dashboard (Principle III), and trace-based capture is a documented later enhancement. The feature also **reads** feature 012's `payments` table and feature 014's multisig address, but owns neither — both are honest-degraded when absent, so 013 ships independently to `develop`. This is client/operator-directed (2026-07-21) and does not touch N1–N5, the policy engine, the kill-switch, or the non-upgradeable vault (it is read-only instrumentation), so no re-ratification is required. The migration `0017_swap_fee_events.sql` **number is provisional — reconcile with the parallel 010/011 work before applying; use the next free sequential number.**

**Result: GATE PASS** — proceed to Phase 0. No unresolved NON-NEGOTIABLE violations.

## Project Structure

### Documentation (this feature)

```text
specs/013-admin-revenue-dashboard/
├── plan.md                        # This file
├── spec.md                        # WHAT/WHY (approved)
├── research.md                    # Phase 0 — decisions & rationale
├── data-model.md                  # Phase 1 — entities, tables, wire shapes
├── quickstart.md                  # Phase 1 — how to run/verify locally + per-story checks
├── contracts/
│   └── revenue-interfaces.md      # Phase 1 — internal interface contracts (indexer, admin API, summary wire)
├── checklists/
│   └── requirements.md            # Spec-quality checklist (from specify)
└── tasks.md                       # Phase 2 — /speckit-tasks output (task list)
```

### Source Code (repository root)

```text
services/agent/migrations/
└── 0017_swap_fee_events.sql       # NEW (number PROVISIONAL — reconcile with 010/011; use next free number) —
                                   #   swap_fee_events UNIQUE(network_id, tx_hash, log_index) + seed a
                                   #   (network, stream='swap_fee') row in the EXISTING indexer_cursors (0001)

services/agent/src/sparkpoint_agent/
├── data/swap_fee_indexer.py       # NEW — SwapFeeIndexer: replay Transfer(from=SwapRouter02, to=feeRecipient) on the
│                                  #   output token into swap_fee_events; idempotent ON CONFLICT; (network,stream)
│                                  #   cursor; finality margin; from==router disambiguation. Copies fee_indexer.py shape;
│                                  #   reuses data/log_source.py HttpxLogsRpc + _addr_from_topic (keccak-free decode)
├── db/swap_fees.py                # NEW — PgSwapFeeEventStore (asyncpg): idempotent insert + revenue_summary-style
│                                  #   cumulative/per-period aggregation (mirrors fee_indexer's PgFeeEventStore)
├── api/admin_revenue.py           # NEW — GET /admin/revenue/summary (require_admin, 404-posture): resolves
│                                  #   {swap, perf, premium}, each per-source try/except → configured:false;
│                                  #   perf calls FeeIndexer.revenue_summary; membership SUMs 012's payments
├── api/main.py                    # include_router(admin_revenue); start SwapFeeIndexer background loop
│                                  #   (mirror _index_vault_flows_loop) — best-effort, fail-open
├── data/fee_indexer.py            # UNCHANGED — reuse FeeIndexer.revenue_summary (:611) for the perf stream
└── config.py / main.py            # read non-key constants: fee-recipient set + swap-router + vault-deploy block per
                                   #   network, read outside AgentConfig like PREMIUM_ALLOWLIST; the Safe address is feature 014's FEE_WALLET_ADDRESS

apps/web/src/
├── app/admin/revenue/page.tsx     # REPLACE the data.tsx mock import with fetch("/api/agent/admin/revenue/summary",
│                                  #   {headers:{"x-chain-id":"84532"},cache:"no-store"}) + loaded/loadErr/busy state;
│                                  #   drop the "Sample data" pill per-stream; KEEP charts.tsx primitives verbatim
├── components/admin/charts.tsx    # UNCHANGED — StackedBars/Trajectory/DualArea/Composed/Kpi/LegendStreams (plain number[]+max)
├── components/admin/revenue-multisig.tsx  # NEW — Multisig BALANCES card: live eth_getBalance + erc20 balanceOf
│                                  #   reads (viem PublicClient) for the 014 Safe; honest-degrade when unconfigured
└── components/admin/data.tsx      # revByStream mock no longer imported by revenue/page.tsx (left for other mock pages)

Living docs: CHANGELOG.md · MIGRATIONS.md (0017 apply record) · DEVELOPMENT.md (new env: fee-recipient set,
SWAP_ROUTER + VAULT_DEPLOY_BLOCK per network; the Safe address is feature 014's FEE_WALLET_ADDRESS) · DEPLOYMENT.md/COOLIFY.md (indexer loop) ·
services/agent/content_seed/whats-new.json (client-facing "Revenue is now real, per-stream" entry, stable slug)
```

**Structure Decision**: Web-application layout (Next.js frontend + Python agent). The feature's authoritative logic is concentrated in `services/agent` (the new swap-fee indexer + store + migration, the aggregation endpoint, and the perf/membership wiring); `apps/web` swaps one mock import for a live fetch and adds a live-read balances card. No contract change and no new top-level project — the fee is already collected on-chain by feature 007's swap path.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A new swap-fee indexer + `0017` table | The 0.20% swap fee is collected on-chain but indexed nowhere; the helpers emit no bespoke event, so there is no existing ledger to read — a keyed `Transfer(from=router)` indexer is the only source of a real swap number | Reading swap revenue live per page-load is infeasible (no aggregate on-chain) and non-idempotent; reusing `fee_events` is wrong (that is the vault perf fee, a different mechanism) |
| Logs-only capture with a disclosed native-ETH-out gap | `unwrapWETH9WithFee` sends native ETH via a low-level call that emits no log; capturing it needs `debug_traceTransaction` | Adding a trace-RPC dependency for one leg is over-engineering for the MVP (Principle VII); the honest fix is to disclose the under-count (Principle III) and add tracing later |
| Cross-feature reads of 012 `payments` + 014 multisig address | The three-stream picture and the treasury card need data owned by adjacent features shipping in parallel | Blocking 013 on 012/014 would prevent independent shipping; honest-degrade lets each stream/card be live-or-absent without a hard dependency |

## Phased design (maps to spec user stories)

Each phase is independently shippable to `develop` and honest at its own boundary.

- **Phase 0 — Data + indexer groundwork (no dashboard change).** `0017_swap_fee_events.sql` (idempotent table + a `(network, stream='swap_fee')` cursor row in the existing `indexer_cursors`), `db/swap_fees.py` store, `data/swap_fee_indexer.py` (decode/idempotency/finality/`from==router` disambiguation), and its background loop in `main.py`. Applied with `PGCLIENTENCODING=UTF8` before the agent boots; `MIGRATIONS.md` updated. Nothing renders yet — the ledger simply starts filling from the backfill block.
- **Phase A → US2 (swap stream, P1).** The swap-fee indexer backfills from the vault-deploy block and stays current under a finality margin; the swap stream's cumulative + per-period aggregation exposed via the store. The native-ETH-out under-count is captured as a disclosure flag on the stream.
- **Phase B → US1 (🎯 MVP).** `api/admin_revenue.py` `GET /admin/revenue/summary` (require_admin, 404-posture) returning `{swap, perf, premium}` each with its `configured` state; rebuild `admin/revenue/page.tsx` to fetch it, drop the `data.tsx` mock import, and remove the "Sample data" pill per-stream — keeping `charts.tsx` verbatim. With just the swap stream live and perf/membership honest-degrading, the page is already trustworthy (viable MVP).
- **Phase C → US3 (perf stream, P2).** Wire the perf stream to `FeeIndexer.revenue_summary` over `fee_events`; honest-degrade to `configured:false` when the vault/ledger is unavailable; a parity test asserts equality with the aggregator.
- **Phase D → US4 (membership stream, P2).** Wire the membership stream to SUM feature 012's `payments` by period (verified rows only); honest-degrade to `configured:false` when the `payments` table is absent, so the page renders the other streams unaffected.
- **Phase E → US5 (🛡️).** `components/admin/revenue-multisig.tsx` balances card: live `eth_getBalance` + ERC-20 `balanceOf` reads for feature 014's Safe (no indexer, no migration); truthfully state the Safe's actual on-chain power (nil over user funds, N5); honest-degrade when no address is configured.
