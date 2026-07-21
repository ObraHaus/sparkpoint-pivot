# Quickstart: Admin Revenue Dashboard (real data)

How to run and verify the feature locally + on the dev/staging (alpha) environment. The governing principle throughout is **III — Provable, Not Promised**: every figure is ledger- or live-read-derived, each stream honest-degrades on its own, and no fabricated or projected number ever renders.

## Prerequisites

- Node 20 (`.nvmrc`), **pnpm 9 (NOT 11 — see the pnpm-version trap)** for any web dep change.
- Python 3.12 + `uv` for `services/agent`.
- Postgres reachable (dev: the develop DB via the LAN IP + published port — see `MIGRATIONS.md`/`COOLIFY.md`; internal container URLs do NOT resolve across Coolify resources).
- `pnpm install --frozen-lockfile` at the repo root.
- A keyless JSON-RPC URL for the target testnet (`BASE_SEPOLIA_RPC_URL`, per `.env.example`) — the swap-fee indexer's `eth_getLogs`/receipts and the multisig card's `eth_getBalance`/`balanceOf` reads use it. No key material.
- The non-key display constants for the target network (read outside `AgentConfig`, like `PREMIUM_ALLOWLIST`): the swap **router** address, the **fee-recipient set**, and the **vault-deploy block** (backfill anchor). The multisig **Safe address** for the balances card comes from feature 014 as `FEE_WALLET_ADDRESS` (in `AgentConfig`). Absent ⇒ the relevant stream/card honest-degrades.

## Apply the migration (before starting the agent)

```bash
cd services/agent
PGCLIENTENCODING=UTF8 uv run --group migrations yoyo apply --batch --database "$DATABASE_URL" ./migrations
```

`0017_swap_fee_events.sql` creates the idempotent `swap_fee_events` ledger and seeds a `(network, stream='swap_fee')` row in the existing `indexer_cursors` (0001). Update `MIGRATIONS.md` (Develop → 0017) in the same change. **Apply before the agent boots** (the boot indexer loop is best-effort/fail-open — a missing table degrades the swap stream to `configured:false`, never a crash).

> **The `0017` number is provisional.** Specs 010/011 are being built in a parallel agent and may claim `0016`/`0017` first — **reconcile with the 010/011 work before applying and use the next free sequential number.** The perf stream reads the existing `fee_events` (0002); the membership stream reads feature 012's `payments` (its provisional `0016`) — neither is created here.

## Run

```bash
# agent (swap-fee indexer loop + the aggregation endpoint + perf/membership wiring)
cd services/agent && uv run uvicorn sparkpoint_agent.api.main:app --reload --port 8000
# web (rebuilt Revenue page + the multisig balances card + BFF proxy)
pnpm --filter @sparkpoint/web dev
```

The `SwapFeeIndexer` background loop (mirrors `_index_vault_flows_loop`) starts on agent boot and backfills `swap_fee_events` from the vault-deploy block forward, then stays current under a finality margin. Nothing on the request path indexes; the endpoint only aggregates.

## Verify by user story

**US1 — real revenue by stream, each honest about its own state (🎯 MVP).** Open **Admin → Revenue**. Confirm every displayed figure comes from a fetch to `/api/agent/admin/revenue/summary` (no `revByStream` import from `components/admin/data.tsx`, no `$13.9K`/`$82.8K` literals, no page-level "Sample data" pill once any stream is live). With one stream live and the others un-configured, confirm the live stream shows real cumulative + per-period totals and each un-configured stream shows an explicit "not instrumented / cannot load" state with **no** number. Stop the endpoint entirely → the page states it cannot load rather than reverting to the old mock series.

**US2 — swap routing fee indexed, native-ETH gap disclosed.** On a network with the fee recipient configured, execute (or replay) a **token-out** swap that pays the 0.20% fee. Run the indexer and confirm a single `swap_fee_events` row (`network_id, tx_hash, log_index` unique) with the correct output token + fee value; re-run the indexer over the same range → **no** duplicate (idempotent). Confirm the swap stream **discloses** that native-ETH-out fees (`unwrapWETH9WithFee`, no log) are not captured by the logs-only indexer. Send an SRK membership `Transfer` (or a perf event) to the **same** address as the fee recipient → confirm the swap indexer does **not** ingest it (`from == router` disambiguation). Confirm the cumulative reflects fees from the vault-deploy block, not a recent window.

**US3 — performance-fee stream wired from the existing aggregator.** With the `fee_events` ledger populated (or seeded in a test), call the summary endpoint and confirm the perf stream's cumulative + per-period buckets **exactly match** `FeeIndexer.revenue_summary` over the same rows. With the vault/ledger unavailable, confirm the perf stream returns `configured:false` (honest-degrade), not an error and not a zero-as-real.

**US4 — membership stream reads feature 012's payments.** With 012's `payments` table present and verified rows, call the endpoint and confirm the membership (`premium`) stream sums those payments by period, **verified rows only**. With the `payments` table absent, confirm the stream returns `configured:false` and the other two streams render unaffected — proving 013 ships independently of 012.

**US5 — multisig treasury balances shown live (🛡️).** With the Safe address configured (from feature 014), open the Revenue page and confirm the balances card shows the live native + ERC-20 balances of that address — matching a block explorer at the same block — with **no** indexer and **no** stored snapshot, and states the Safe's on-chain power truthfully (a plain holder, nil authority over user funds, N5). With no address configured, confirm the card honest-degrades ("unavailable") rather than showing a placeholder balance.

## Tests

```bash
# agent (authoritative logic)
cd services/agent && uv run pytest tests/data/test_swap_fee_indexer.py tests/db/test_swap_fees.py \
  tests/api/test_admin_revenue.py
# web helpers + e2e
pnpm --filter @sparkpoint/web test
pnpm --filter @sparkpoint/web exec playwright test e2e/pw/revenue.spec.ts   # domcontentloaded + long hydration budget (CPU-starved box)
```

Cover: swap-fee `Transfer` decode + idempotent `(network_id, tx_hash, log_index)` upsert + finality/reorg re-scan + `from == router` disambiguation (shared-treasury double-count); the `admin_revenue` endpoint per-stream honest-degrade + admin 404-posture; a **parity** test asserting the perf stream equals `FeeIndexer.revenue_summary`; membership summing verified rows only + `configured:false` when `payments` is absent; a Playwright assertion that no `data.tsx` mock series feeds the page and that un-configured streams render a not-instrumented state; a live, non-destructive RPC probe validating the multisig balances card.

## Living docs to update (same change)

- `CHANGELOG.md` — `## [Unreleased]` bullets (new `swap_fee_events` table + `0017` migration, the swap-fee indexer, the `/admin/revenue/summary` endpoint, the rebuilt Revenue page + multisig card).
- `services/agent/content_seed/whats-new.json` — a client-facing entry per shipped phase (stable slug), e.g. "Revenue is now real, per stream" — semi-technical, makes clear the numbers changed from sample to on-chain even though the page looks similar.
- `MIGRATIONS.md` — record `0017` applied per environment (bump the Develop level + add the per-migration row); **reconcile the number with the parallel 010/011 work first.**
- `DEVELOPMENT.md` — the new non-key display constants: the swap **router** + **fee-recipient set** + **vault-deploy block** per network. (The Safe address for the balances card is feature 014's `FEE_WALLET_ADDRESS`.)
- `DEPLOYMENT.md` / `COOLIFY.md` — the swap-fee indexer background loop (the same operational shape as the vault-flow indexer) and its RPC/env requirements.
