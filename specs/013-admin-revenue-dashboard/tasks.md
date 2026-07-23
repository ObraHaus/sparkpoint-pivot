---
description: "Task list for 013-admin-revenue-dashboard"
---

# Tasks: Admin Revenue Dashboard (real data)

**Input**: Design documents in `specs/013-admin-revenue-dashboard/` (spec.md, plan.md, research.md, data-model.md, contracts/revenue-interfaces.md, quickstart.md)

**Tests**: Included — this feature *is* the embodiment of **Provable, Not Promised** (Constitution III), so the invariants that keep it honest are tested: swap-fee indexer decode + idempotent `(network_id, tx_hash, log_index)` replay + finality/reorg re-scan + `from == router` disambiguation (no shared-treasury double-count), per-stream honest-degrade to `configured:false` when a source is absent, a real `$0` distinct from `configured:false`, the perf stream **exactly equal** to `FeeIndexer.revenue_summary` (parity), membership summing verified rows only, and the admin summary invisible (404) to non-admins. Requested via the spec's Independent Tests + Success Criteria (SC-001…SC-010).

**Organization**: Grouped by user story (US1–US5 from spec.md) so each ships independently to `develop`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency)
- **[Story]**: US1 / US2 / US3 / US4 / US5 (or SETUP / POLISH)
- Include exact file paths in descriptions

## Definition of Done (every SparkPoint feature)

A task-group / phase is "done" only when:

- [ ] `CHANGELOG.md` — a dev bullet under `## [Unreleased]` for every behavior/schema/infra change (the `0018` `swap_fee_events` table + cursor row, the new swap-fee indexer + background loop, the `GET /admin/revenue/summary` endpoint, the rebuilt Revenue page dropping the mock series, the multisig balances card each qualify).
- [ ] `services/agent/content_seed/whats-new.json` — a **client-facing** entry for each user-visible phase with a stable `slug` (A: "Revenue is now real, per stream"; B: "Swap-fee revenue is indexed on-chain (native-ETH gap disclosed)"; C: "Vault performance-fee revenue is live"; D: "Membership revenue is on the board"; E: "Treasury multisig balances are shown live") — semi-technical, making clear the numbers changed from sample to on-chain even though the page looks similar.
- [ ] `MIGRATIONS.md` records `0018_swap_fee_events.sql` applied per environment; the migration applies with `PGCLIENTENCODING=UTF8` **before** the agent boots. **Confirm `0018` is still the next-free sequential number at apply time** (feature 011 merged `0016_vault_factory` to develop; feature 012 holds `0017_subscriptions`). **No new agent seed dir** is introduced (0018 seeds only a cursor row via SQL), so no `services/agent/Dockerfile` `COPY` is needed — confirm none was added.
- [ ] `DEVELOPMENT.md` documents the new non-key display constants (the swap **router** address, the **fee-recipient set**, and the **vault-deploy block** per network, read outside `AgentConfig` like `PREMIUM_ALLOWLIST`); note that the multisig **Safe address** for the balances card is feature 014's `FEE_WALLET_ADDRESS`. `DEPLOYMENT.md`/`COOLIFY.md` document the swap-fee indexer background loop + its RPC/env requirements.
- [ ] `changelog-required` CI green (or `skip-changelog` + justification); `pnpm -w typecheck && lint && build` green; agent `pytest` green. **No contract change** — the fee is already collected on-chain by feature 007's swap path — so no `forge test` is required; confirm none was added.
- [ ] **Provable, Not Promised confirmed in review** (Constitution III): zero fabricated/projected figures render, every stream honest-degrades, a real `$0` is distinct from `configured:false`, the native-ETH-out under-count is disclosed; **non-custody confirmed** (Constitution I, N1–N5 / FR-020): read-only instrumentation, no deposit/withdraw/redeem/swap/exit path touched.
- [ ] No new env var / display constant left undocumented.

---

## Phase 0: Groundwork — swap-fee ledger, store, indexer + loop (no dashboard change)

**Purpose**: land the `swap_fee_events` ledger + its store + the background indexer so the swap stream has a real source before anything renders. Ships alone; the ledger simply starts filling from the backfill block. Nothing on the Revenue page changes yet.

- [ ] T001 [SETUP] `services/agent/migrations/0018_swap_fee_events.sql` — create `swap_fee_events` per data-model.md (`BIGSERIAL id`; `network_id TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id)`; `tx_hash`, `log_index`, `block_number`, `block_time`, `token_address`+`token_decimals`, `fee_value_raw NUMERIC(78,0) CHECK (>= 0)`, `from_address`, `to_address`, `indexed_at`; lowercase CHECKs; `UNIQUE (network_id, tx_hash, log_index)`; indexes `(network_id, block_time DESC)` + `(network_id, block_number)`), and seed a `(network, stream='swap_fee')` row into the existing `indexer_cursors` (0001). Apply with `PGCLIENTENCODING=UTF8`; update `MIGRATIONS.md` (Develop → 0018) after confirming 0018 is still next-free.
- [ ] T002 [P] [SETUP] `services/agent/tests/db/test_swap_fees.py` — write first (fails until T004): idempotent `record` on `(network_id, tx_hash, log_index)` (second insert returns `False`, no duplicate); `revenue_summary` sums only stored rows in **base units** (no USD fabricated); a network with **no rows** yields a **real** cumulative `0` (distinct from `configured:false`); per-period buckets truncate `block_time` the same way `FeeIndexer._bucket_periods` does (contracts §2).
- [ ] T003 [P] [SETUP] `services/agent/tests/data/test_swap_fee_indexer.py` — write first (fails until T005): a `Transfer(from == router, to == recipient)` on the output token is recorded as exactly one row with the correct token + `fee_value_raw`; a re-run over the same range records **zero** duplicates (SC-003); the cursor advances only past `FINALITY_MARGIN` and a reorged-out block leaves **zero** retained rows on re-scan (SC-009); an inbound transfer whose `from` is **not** the router (a membership `from == buyer`, or a perf transfer) to a **shared** recipient address is **rejected**, never ingested (SC-004 / D7); backfill starts at the vault-deploy block so the first cumulative reflects inception (D6); absent display constants degrade to a no-op rather than crashing (fail-open).
- [ ] T004 [SETUP] `services/agent/src/sparkpoint_agent/db/swap_fees.py` — `PgSwapFeeEventStore` (asyncpg dataclass, mirrors `PgFeeEventStore`): `record(ev) -> bool` (idempotent `ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING`), `fetch(network_id, since, until)`, `revenue_summary(network_id, …, period='month') -> SwapFeeRevenueSummary` (Python aggregation → `cumulative_fee_raw` + `SwapFeePeriodBucket[]`); dataclasses `SwapFeeEvent`/`SwapFeeEventRow`/`SwapFeeRevenueSummary`/`SwapFeePeriodBucket` per data-model.md. Export from `db/__init__.py` (depends on T001/T002).
- [ ] T005 [SETUP] `services/agent/src/sparkpoint_agent/data/swap_fee_indexer.py` — `SwapFeeIndexer.index_once(network_id) -> IndexResult` (copies `data/fee_indexer.py` shape; reuses `data/log_source.py` `HttpxLogsRpc` + `_addr_from_topic` for keccak-free Transfer decode): read the `(network, stream='swap_fee')` cursor (first run = vault-deploy block); `eth_getLogs` `Transfer(topic0=ERC20_TRANSFER_TOPIC0)` on the output token(s) filtered `to ∈ fee-recipient set` **and** `from == router`, up to `head - FINALITY_MARGIN`; decode `fee_value_raw = uint256(data)` + cached `decimals()`; idempotent upsert via `PgSwapFeeEventStore.record`; advance cursor only to `head - FINALITY_MARGIN`, re-scan unfinalized blocks (contracts §1) (depends on T004).
- [ ] T006 [SETUP] `services/agent/src/sparkpoint_agent/api/main.py` — read the per-network non-key display constants **outside `AgentConfig`** (like `PREMIUM_ALLOWLIST`): `SWAP_ROUTER[network]`, `FEE_RECIPIENT_SET[network]` (a **set** so a 014 recipient cutover unions old EOA + new Safe — D14), `VAULT_DEPLOY_BLOCK[network]`; start the `SwapFeeIndexer` background loop mirroring `_index_vault_flows_loop` — best-effort, fail-open, never on the request path (contracts §6) (depends on T005).
- [ ] T007 [P] [SETUP] `CHANGELOG.md` `## [Unreleased]` bullet: "feat(agent): swap-fee ledger (0018) + swap_fee_events store + background indexer" and `DEVELOPMENT.md` entry for the new display constants (depends on T001).

**Checkpoint**: `0018` applied; store + indexer green; the `swap_fee_events` ledger backfills from the vault-deploy block; nothing renders yet.

---

## Phase A → User Story 1 — Operator sees real revenue by stream, each honest about its own state (Priority: P1) 🎯 MVP

**Goal**: `Admin → Revenue` fetches a real, admin-gated summary; each of the three streams renders a real number when live and an explicit "not instrumented / cannot load" state when not; the mock series import and the page-level "Sample data" pill are gone.

**Independent Test**: quickstart US1 — with the swap stream live and perf/membership un-configured, the live stream shows real cumulative + per-period totals, the un-configured streams show a not-instrumented state (no number), no `$13.9K`/`$82.8K` literal renders, and stopping the endpoint degrades the page honestly (no reversion to the mock series).

### Tests for US1 (write first, ensure they fail)

- [ ] T008 [P] [US1] `services/agent/tests/api/test_admin_revenue.py` — a non-admin gets `404` (not 403), indistinguishable from a non-existent route (SC-010); the endpoint returns `{swap, perf, premium, networkId}` shaped per data-model.md; one dead source degrades **only its own stream** to `configured:false` and never blanks the others (SC-002); a live-but-empty swap stream returns `cumulative_raw == 0` with `configured:true` (a **real** zero, distinct from `configured:false` — SC-002/D2); values are base units with `token_decimals`, **no** USD fabricated (D13); no projected/fabricated number is ever returned (FR-001/FR-021).
- [ ] T009 [P] [US1] `apps/web/e2e/pw/revenue.spec.ts` — write first: the page performs **zero** reads from `components/admin/data.tsx` (`revByStream` import removed) and no `$13.9K`/`$82.8K` literal renders (SC-001); a `configured:false` stream renders an explicit not-instrumented state with **no** number, per-stream, without blanking the others (SC-002); an entirely unreachable endpoint degrades honestly ("cannot load") rather than reverting to a mock series (FR-004) (`domcontentloaded` + long hydration budget — CPU-starved box).

### Implementation for US1

- [ ] T010 [US1] `services/agent/src/sparkpoint_agent/api/admin_revenue.py` — `GET /admin/revenue/summary` under `Depends(require_admin)` (404-posture, keyed on server-verified `X-Owner`), GET-only; each stream resolved in its **own** `try/except` → `configured:false` on failure (mirror `api/admin_usage.py`); wire the **swap** stream from `PgSwapFeeEventStore.revenue_summary(network_id)` (Phase 0); return `perf` + `premium` as `configured:false` placeholders for now (wired in Phase C/D); shape `StreamSeries {configured, cumulative_raw, token_decimals, periods:[{period_start, value_raw}], disclosures}` per data-model.md (contracts §3) (depends on T004/T008).
- [ ] T011 [US1] `services/agent/src/sparkpoint_agent/api/main.py` — `include_router(admin_revenue_router)` (one line) (depends on T010).
- [ ] T012 [US1] `apps/web/src/app/admin/revenue/page.tsx` — **replace** `import { revByStream, … } from "@/components/admin/data"` with `fetch("/api/agent/admin/revenue/summary", { headers: { "x-chain-id": "84532" }, cache: "no-store" })` + `loaded/loadErr/busy` state (copies the `admin/gateway/page.tsx` pattern: `useCallback` refresh + `useEffect` on mount, honest-degrade copy); render each stream's real cumulative + per-period series, a per-stream not-instrumented state on `configured:false`, and an honest "cannot load" state when the fetch fails; import every presentational primitive (`StackedBars/Trajectory/DualArea/Composed/Kpi/LegendStreams`) from `@/components/admin/charts.tsx` — **after T012a relocates `Kpi`/`LegendStreams` there** — so the page reads **nothing** from `components/admin/data.tsx` (SC-001/FR-003); each takes plain `number[]`/`{x,…}[]` + a computed `max` (contracts §4) (depends on T010, T012a).
- [ ] T012a [US1] `apps/web/src/components/admin/charts.tsx` + `data.tsx` — **relocate the presentational `Kpi` and `LegendStreams` components from `components/admin/data.tsx` into `components/admin/charts.tsx`** (they are chart primitives, not mock data); leave only the mock series (`data`, `revByStream`) in `data.tsx`; update the four other admin importers (`admin/page.tsx`, `admin/users/page.tsx`, `admin/stake/page.tsx`, `admin/tvl/page.tsx`) to import `Kpi`/`LegendStreams` from `charts.tsx`. Lets `revenue/page.tsx` import every primitive from `charts.tsx` and read nothing from `data.tsx` (unblocks T012; SC-001/FR-003) (depends on T008).
- [ ] T013 [US1] `apps/web/src/app/admin/revenue/page.tsx` — **drop the "Sample data" pill per-stream**: remove the inline page-level pill (currently `revenue/page.tsx:56-58`) once any stream is live; a still-degrading stream keeps its own honest not-instrumented affordance (FR-003) (depends on T012).
- [ ] T014 [P] [US1] Living docs: `CHANGELOG.md` bullet + `services/agent/content_seed/whats-new.json` client entry (stable slug, "Revenue is now real, per stream").

**Checkpoint**: `Admin → Revenue` shows only ledger-derived figures; per-stream honest-degrade; the mock import + page-level pill are gone; non-admins get 404.

---

## Phase B → User Story 2 — Swap routing fee indexed on-chain, native-ETH gap disclosed (Priority: P1)

**Goal**: the swap stream's number is honest end-to-end — backfilled from inception, finality-safe, immune to the shared-treasury double-count, and its native-ETH-out under-count **disclosed** rather than presented as complete.

**Independent Test**: quickstart US2 — a token-out swap fee is recorded exactly once (idempotent on re-run), attributed to the correct output token/value, surfaced in the swap stream's totals; a native-ETH-out swap is reflected by a disclosed under-count note; a membership/perf `Transfer` to the **same** address as the fee recipient is not ingested (`from == router`); the cumulative reflects the vault-deploy block, not a recent window.

### Tests for US2 (write first, ensure they fail)

- [ ] T015 [P] [US2] `services/agent/tests/api/test_admin_revenue.py` — extend: when the swap stream is `configured`, its `disclosures` **always** carries the native-ETH-out under-count note (FR-009 / SC-005); a shared-treasury scenario (one membership `Transfer`, one perf event, one swap fee to a **single** shared address) lands each in **exactly one** stream and the swap stream counts **only** the `from == router` fee (SC-004); the swap cumulative reflects the vault-deploy-block backfill, not a recent window (D6).

### Implementation for US2

- [ ] T016 [US2] `services/agent/src/sparkpoint_agent/api/admin_revenue.py` — populate the swap `StreamSeries.disclosures` with the explicit native-ETH-out (`unwrapWETH9WithFee`, no log) under-count note whenever the swap stream is configured (FR-009) (depends on T010).
- [ ] T017 [US2] `apps/web/src/app/admin/revenue/page.tsx` — render the swap stream's `disclosures` (the native-ETH-out under-count) plainly on the card, so the logs-only figure is never presented as complete (FR-009 / SC-005) (depends on T012/T016).
- [ ] T018 [P] [US2] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("Swap-fee revenue is indexed on-chain (native-ETH gap disclosed)", stable slug) + `DEPLOYMENT.md`/`COOLIFY.md` note for the swap-fee indexer background loop.

**Checkpoint**: the swap stream carries a real, inception-honest, finality-safe number that no shared-treasury transfer can inflate, and its native-ETH gap is disclosed.

---

## Phase C → User Story 3 — Performance-fee stream wired from the existing aggregator (Priority: P2)

**Goal**: surface the vault 10%/high-water-mark performance fee by calling the existing `FeeIndexer.revenue_summary` — reused, not re-implemented — honest-degrading when the vault/ledger is unavailable.

**Independent Test**: quickstart US3 — with `fee_events` populated (or seeded), the perf stream's cumulative + per-period buckets **exactly match** `FeeIndexer.revenue_summary` over the same rows; with the vault/ledger unavailable, the stream returns `configured:false`, not an error or a zero-as-real.

### Tests for US3 (write first, ensure they fail)

- [ ] T019 [P] [US3] `services/agent/tests/api/test_admin_revenue.py` — **parity** test: the perf stream's cumulative + per-period figures **exactly equal** `FeeIndexer.revenue_summary` over the same `fee_events` rows (no divergent re-derivation — FR-011 / SC-006); with the vault/ledger unavailable the perf stream returns `configured:false` (honest-degrade), never an error and never a zero-as-real (FR-012).

### Implementation for US3

- [ ] T020 [US3] `services/agent/src/sparkpoint_agent/api/admin_revenue.py` — wire the `perf` stream: call the existing `FeeIndexer(...).revenue_summary(network_id, vault_address, period="month")` (`data/fee_indexer.py:611`, **UNCHANGED**) inside its own `try/except` → `configured:false` when the vault/ledger is unavailable; fold its cumulative + `PeriodBucket`s into the `StreamSeries` (contracts §3, D8) (depends on T010).
- [ ] T021 [US3] `apps/web/src/app/admin/revenue/page.tsx` — drop the not-instrumented affordance for the perf stream once it reports real data; render its real series via the unchanged `charts.tsx` primitives (depends on T012/T020).
- [ ] T022 [P] [US3] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("Vault performance-fee revenue is live", stable slug).

**Checkpoint**: the perf stream matches the tested aggregator exactly and honest-degrades when the vault is unavailable.

---

## Phase D → User Story 4 — Membership stream reads feature 012's payments (Priority: P2)

**Goal**: sum SRK membership revenue from feature 012's `payments` table (verified rows only), honest-degrading to `configured:false` when the table is absent — so 013 ships and is useful before 012 lands.

**Independent Test**: quickstart US4 — with 012's `payments` present and verified rows, the `premium` stream sums those payments by period (verified only); with the table absent, the stream returns `configured:false` and the other two streams render unaffected.

### Tests for US4 (write first, ensure they fail)

- [ ] T023 [P] [US4] `services/agent/tests/api/test_admin_revenue.py` — the membership (`premium`) stream sums **only verified** payment rows by period (never a pending/unverified submission — FR-013 / SC-007); it is derived from 012's `payments` ledger only, never the swap indexer, so a membership transfer is never counted as swap revenue (FR-014 / SC-004 / D7); when the `payments` table is **absent** the stream returns `configured:false` and the swap + perf streams render unaffected (SC-007 / D9).

### Implementation for US4

- [ ] T024 [US4] `services/agent/src/sparkpoint_agent/api/admin_revenue.py` — wire the `premium` stream: `SUM(payments.amount_raw)` bucketed by period over feature 012's `payments` (0017), **verified rows only**, inside its own `try/except` → `configured:false` when the table does not exist (relies on 012's `UNIQUE(network_id, tx_hash)` so a payment is summed once) (contracts §3, D9) (depends on T010).
- [ ] T025 [US4] `apps/web/src/app/admin/revenue/page.tsx` — drop the not-instrumented affordance for the membership stream once it reports real data; render its real series via the unchanged `charts.tsx` primitives (depends on T012/T024).
- [ ] T026 [P] [US4] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("Membership revenue is on the board", stable slug).

**Checkpoint**: the membership stream sums verified 012 payments and honest-degrades to `configured:false` when 012 is absent, the other streams unaffected.

---

## Phase E → User Story 5 — Multisig treasury balances shown live (Priority: P3) 🛡️

**Goal**: show the treasury Safe's live native + ERC-20 balances from direct on-chain reads (no indexer, no migration, no snapshot) and state the Safe's **actual** on-chain power truthfully — a plain holder with nil authority over user funds (N5).

**Independent Test**: quickstart US5 — with the Safe address configured (from 014), the card shows live native + ERC-20 balances matching a block explorer at the same block, states the Safe's power truthfully, and stores nothing; with no address configured, the card honest-degrades.

### Tests for US5 (write first, ensure they fail)

- [ ] T027 [P] [US5] Live, non-destructive RPC probe (documented in quickstart US5) — with the Safe configured, the card's native + ERC-20 balances match a block explorer for the same address at the same block (SC-008); with **no** Safe address the card honest-degrades ("unavailable") rather than showing a placeholder balance (FR-019); **no** migration and **no** stored balance row is introduced (SC-008); the stated power reflects the Safe's real (nil over user funds) authority, proving N5 rather than asserting it (FR-019).

### Implementation for US5

- [ ] T028 [US5] `apps/web/src/components/admin/revenue-multisig.tsx` — NEW live-read balances card: `getPublicClient(chainId)` (`apps/web/src/lib/chain/clients.ts`) → `client.getBalance({ address: safe })` (native) + `client.readContract({ …, functionName: "balanceOf", args: [safe] })` per relevant ERC-20; `safe = getAddresses(chainId).feeTreasury` (feature 014's `FEE_WALLET_ADDRESS`); `configured:false` honest-degrade when the address is undefined; **no** indexer, **no** migration, **no** snapshot; the card **states** the Safe's actual on-chain power (`power: "recipient-only"` — a plain holder, nil authority over user funds, N5) (contracts §5, D12).
- [ ] T029 [US5] `apps/web/src/app/admin/revenue/page.tsx` — mount `<RevenueMultisig />` on the Revenue page below the streams (depends on T012/T028).
- [ ] T030 [P] [US5] Living docs: `CHANGELOG.md` bullet + `whats-new.json` client entry ("Treasury multisig balances are shown live", stable slug).

**Checkpoint**: the operator can verify treasury holdings live against the indexed revenue; the Safe's nil custody power is shown truthfully; nothing is persisted.

---

## Phase POLISH: Cross-cutting

- [ ] T031 [POLISH] `apps/web/e2e/pw/revenue.spec.ts` — round out the e2e: all three streams live render real series + the multisig card renders; a mixed live/degrading state renders per-stream honestly; no `data.tsx` mock series ever feeds the page (SC-001) (`domcontentloaded` + long hydration budget).
- [ ] T032 [POLISH] Re-verify on the develop/alpha environment across 84532 + 46630: run the swap-fee indexer, confirm a real swap cumulative appears within one indexer interval, confirm perf/membership honest-degrade when their sources are absent, and paste evidence (block-explorer parity for the multisig card) into the PR body.
- [ ] T033 [POLISH] Provable-Not-Promised + non-custody self-review vs Constitution III / I (N1–N5): zero fabricated/projected figures render; every stream honest-degrades; a real `$0` is distinct from `configured:false`; the native-ETH-out under-count is disclosed; the summary is admin-invisible (404); no deposit/withdraw/redeem/swap/exit path is touched (FR-020) — before requesting review.

---

## Dependencies & Execution Order

- **Phase 0** first (ledger + store + indexer + loop) — the swap stream reads it. Store/indexer tests (T002/T003) precede their implementations (T004/T005); T005 depends on T004; T006 depends on T005.
- **US1 (P1, MVP)** → **US2 (P1)** → **US3 (P2)** → **US4 (P2)** → **US5 (P3)**. Each ships to `develop` independently once green.
- Within US1: tests (T008/T009) before implementation. `admin_revenue.py` (T010) gates the router mount (T011), the page rewire (T012), the pill drop (T013), and every later stream wiring (T016/T020/T024). The page rewire (T012) gates the disclosure render (T017), the perf/membership affordance drops (T021/T025), and the multisig mount (T029).
- US2 adds the swap disclosure on top of the Phase-0 indexer + US1 endpoint/page. US3 (perf) reuses `FeeIndexer.revenue_summary` **unchanged** (`data/fee_indexer.py`). US4 (membership) reads feature 012's `payments` (honest-degrades if 012 is unapplied). US5 (multisig) reads feature 014's `feeTreasury`/`FEE_WALLET_ADDRESS` (honest-degrades if 014 is unapplied) — a live-read card layered on top.

## Parallel Opportunities

- Tests are `[P]` (different files / independent): T002 · T003 · T008/T009 · T015 · T019 · T023 · T027.
- Independent docs `[P]`: T007, T014, T018, T022, T026, T030.
- Shared-file tasks serialize: `api/admin_revenue.py` (T010 → T016 → T020 → T024), `admin/revenue/page.tsx` (T012 → T013 → T017 → T021 → T025 → T029), `tests/api/test_admin_revenue.py` (T008 → T015 → T019 → T023).

## Implementation Strategy

- **MVP-first**: Phase 0 + US1 alone make the page trustworthy — the swap stream is live and perf/membership honest-degrade, which already replaces the fiction the mock invited. Ship that to `develop`, then layer US2's disclosure, US3's perf parity, US4's membership sum, and US5's multisig card incrementally, each independently shippable and honest at its own boundary.
- **Incremental**: every stream is resolved in its own `try/except` — landing a stream never risks the others; a phase can ship the moment its stream/card is green.

## Notes

- Commit after each task or logical group; branch **`feature/013-admin-revenue-dashboard`** off `develop`.
- **Confirm before any `git push` / PR / merge** (repo CLAUDE.md) and before any Coolify/prod action.
- Apply `0018` with `PGCLIENTENCODING=UTF8` **before** the agent boots (the indexer loop is best-effort/fail-open — a missing table degrades the swap stream to `configured:false`, never a crash); **confirm 0018 is still next-free at apply time** (011 merged `0016`, 012 holds `0017`); never-Friday prod deploys; batched prod date.
- **No contract change** (the fee is already collected on-chain by feature 007's swap path) and **no new seed dir** (0018 seeds only a cursor row) — confirm neither a `forge test` obligation nor a `Dockerfile` `COPY` was introduced.
- **Provable, Not Promised (Constitution III) + non-custody (N1–N5) are review gates, not afterthoughts.** A fabricated/projected figure, a conflated `$0`/`configured:false`, an undisclosed native-ETH gap, or any funds-path touch is a blocking defect.
