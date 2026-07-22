# Research: Admin Revenue Dashboard (real data) (Phase 0)

Decisions and rationale grounding the plan. Sources: a direct code read of `apps/web/src/app/admin/revenue/page.tsx` + `apps/web/src/components/admin/{data,charts}.tsx`, the swap fee path (`apps/web/src/lib/swap/{math,useExecuteSwapTx,useSwapConfirm,abis}.ts`), the agent backend (`services/agent/src/sparkpoint_agent/{api,data,db,chain}/*`), the existing performance-fee aggregator (`data/fee_indexer.py:611`), the admin-endpoint + live-fetch-page precedents (`api/admin_usage.py`, `apps/web/src/app/admin/{gateway,system}/page.tsx`), and the migration ledger (`MIGRATIONS.md`, `services/agent/migrations/`). The governing principle throughout is **III — Provable, Not Promised**.

## D1 — Show only on-chain-reconstructable revenue; honest-degrade per stream

**Decision**: The dashboard renders **only** figures derived from an on-chain ledger or a live on-chain read. Each of the three streams is resolved independently; a stream whose source is unavailable returns `{configured:false}` and renders an explicit "not instrumented / cannot load" state carrying no number.

**Rationale**: `admin/revenue/page.tsx` is 100% mock today (inline `revByStream` from `data.tsx:13`, literal `$13.9K`/`$82.8K` KPIs) behind a "Sample data" pill — exactly the fabricated-figure posture Principle III forbids for anything shown as real. The honest-degrade shape is already proven in `api/admin_usage.py` + `admin/usage/page.tsx` ("Requires the 0015 migration applied"). Per-stream (not page-level) resolution means one dead source never blanks the others. Rejected: a single all-or-nothing summary (one RPC outage would blank real streams); keeping any illustrative fill (violates III).

## D2 — A real `$0` is not the same as `configured:false`

**Decision**: A live-but-empty stream (genuine zero realized revenue) renders as a real `$0`; an un-configured/unavailable stream renders `configured:false`. The two states are distinct in the wire shape and on the page.

**Rationale**: On testnet the perf stream is legitimately ~zero (little realized yield). Presenting a real zero honestly is Principle III; collapsing "zero" and "unknown" into one state would either hide an outage or fabricate certainty. The `configured` boolean carries the distinction end to end.

## D3 — Swap fee: index ERC-20 `Transfer(from = SwapRouter02, to = feeRecipient)` (no bespoke event exists)

**Decision**: Capture the 0.20% swap routing fee by indexing the standard ERC-20 `Transfer` log on the **output token**, filtered to `from == the swap router` and `to == the fee recipient`, into a new `swap_fee_events` ledger.

**Rationale**: The fee is taken inside the user-signed swap via Uniswap's `sweepTokenWithFee`/`unwrapWETH9WithFee` (`useExecuteSwapTx.ts:146-159`), whose ABIs have **empty `outputs`** (`abis.ts:118-142`) — there is **no dedicated fee event** to key on. The only log-visible signal is the fee-recipient's inbound `Transfer` from the router. `data/log_source.py` already decodes indexed address topics keccak-free (`_addr_from_topic:95`) and reads raw `eth_getLogs` results (`HttpxLogsRpc:64`), so the machinery exists. The router addresses are known (Base Sepolia `uniswapV3SwapRouter02 = 0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4`). Rejected: parsing a bespoke event (none exists); trusting the client's displayed `feeAmount` (`useSwapConfirm.ts`) — display-only, non-authoritative, violates Principle III/IV.

## D4 — Disclose the native-ETH-out under-count rather than depend on trace RPC

**Decision**: The logs-only indexer accepts that it under-counts the native-ETH-out fee leg and the dashboard **discloses** the gap; `debug_traceTransaction` capture is a documented later enhancement, not MVP.

**Rationale**: `unwrapWETH9WithFee` unwraps WETH and sends **native ETH** to the recipient via a low-level call that emits **no log** — it is invisible to `eth_getLogs`. Capturing it requires tx tracing (a heavier RPC dependency, not universally available on free tiers). Per Principle VII, don't take on that dependency for the MVP; per Principle III, don't pretend the total is complete — disclose the shortfall on the stream. Rejected: silently omitting the gap (dishonest total); blocking the feature on trace RPC (over-engineered for a testnet MVP).

## D5 — Idempotent ledger keyed `(network_id, tx_hash, log_index)`, finality-bounded cursor

**Decision**: `swap_fee_events` carries `UNIQUE(network_id, tx_hash, log_index)` with `ON CONFLICT DO NOTHING`; the indexer persists a `(network, stream='swap_fee')` row in the existing `indexer_cursors` table (0001) and advances the cursor only past a finality margin, re-scanning unfinalized blocks.

**Rationale**: This is the exact, proven shape of the vault flow/fee indexers (`0002_vault.sql` `UNIQUE(network_id, tx_hash, log_index)`; `fee_indexer.py` cursor at `:757-779`). Idempotency makes re-runs and overlapping ranges safe; the finality margin ensures a reorged-out fee `Transfer` is re-scanned away rather than retained as revenue (testnet reorgs are common). Reusing `indexer_cursors` avoids a second cursor mechanism. Rejected: a fresh cursor table (redundant); advancing to chain head (would retain reorged fees).

## D6 — Backfill from the vault-deploy (fee-recipient-inception) block so the first number is honest

**Decision**: The swap indexer backfills from the vault-deploy block (the point the fee recipient began receiving fees) forward, not from a recent window.

**Rationale**: All realized SparkPoint revenue to date is unindexed swap fees sitting in the fee-recipient EOA (`0xA71e…5c30`). A cumulative that started "yesterday" would understate revenue and mislead the operator (Principle III). Anchoring to inception makes the first cumulative total honest. The deploy block is a per-network non-key constant read at config time.

## D7 — Disambiguate shared-treasury transfers so no `Transfer` is counted twice

**Decision**: Each stream has a disjoint attribution key: **swap** = `from == router`; **membership** = feature 012's `payments` ledger (`from == buyer ∧ token == SRK`); **perf** = the `fee_events` vault ledger. The swap indexer rejects any inbound transfer whose `from` is not the router.

**Rationale**: If the premium treasury, the swap fee recipient, and the 014 multisig are the **same Safe**, a naive "credits to the recipient" indexer would ingest an SRK membership `Transfer` (buyer → treasury) as swap revenue and double-count it against 012's ledger. The `from == router` filter makes the swap stream immune; membership comes only from 012's own ledger; perf comes only from vault events. Rejected: keying the swap indexer on `to == recipient` alone (the double-count trap).

## D8 — Reuse `FeeIndexer.revenue_summary` for the perf stream; do not re-implement

**Decision**: The performance-fee stream calls the existing `FeeIndexer.revenue_summary` (`data/fee_indexer.py:611`) over the `fee_events` ledger (migration 0002), returning its cumulative + per-period `PeriodBucket`s unchanged.

**Rationale**: The aggregator already exists, is unit-tested (`tests/data/test_fee_indexer.py`), and produces exactly the cumulative + monthly shape the dashboard needs — it is simply wired to nothing but tests today. Re-deriving it would risk divergence from the tested truth (a Principle III hazard) and duplicate logic (Principle VII). A parity test asserts the endpoint equals the aggregator. Rejected: a second perf aggregation in the endpoint (divergence + duplication).

## D9 — Membership stream = SUM over feature 012's `payments`, honest-degrading when absent

**Decision**: The membership stream sums 012's `payments` table by period, counting only verified payments, and returns `configured:false` when the table does not exist — so 013 ships independently of 012.

**Rationale**: 012 owns the `payments` ledger (its migration, next-free `0017`). 013 must not block on 012 landing; the try/except-to-`configured:false` pattern (from `admin_usage.py`) lets the stream be live-or-absent cleanly. Counting only verified payments avoids crediting a pending/unverified submission as revenue (Principle III). Rejected: deriving membership from the swap indexer (wrong ledger, double-count risk — see D7); a hard 012 dependency (blocks independent shipping).

## D10 — Aggregation endpoint mirrors `admin_usage.py`: `GET /admin/revenue/summary`, admin-gated, per-stream try/except

**Decision**: A new `api/admin_revenue.py` exposes `GET /admin/revenue/summary` under `require_admin` (404-invisible posture), resolving each stream inside its own try/except and returning `{swap, perf, premium}` shaped to drop into the page's series. Mounted in `main.py` with one `include_router` line.

**Rationale**: `admin_usage.py:31` is the exact precedent — admin-gated read, honest-degrade per source, canonical error envelope. The 404-posture (`require_admin`, `allowlist.py:42`) keeps the surface invisible to non-admins keyed on the server-verified owner, never a client claim (Principle IV). Shaping the response as `{swap, perf, premium}` matches the page's existing stream keys so `charts.tsx` primitives consume it unchanged. Rejected: a public endpoint (leaks revenue); a 403 (reveals existence).

## D11 — Web page swaps the mock import for a live fetch; keep `charts.tsx` primitives verbatim

**Decision**: `admin/revenue/page.tsx` replaces `import { revByStream, … } from "@/components/admin/data"` with `fetch("/api/agent/admin/revenue/summary", { headers: { "x-chain-id": "84532" }, cache: "no-store" })` + `loaded/loadErr/busy` state, and drops the "Sample data" pill per-stream. The `StackedBars/Trajectory/DualArea/Composed` primitives are unchanged; `Kpi` + `LegendStreams` are relocated from `data.tsx` into `charts.tsx` (presentational, not mock data) so the page reads nothing from `data.tsx` (SC-001). All take plain `number[]`/`{x,…}[]` + a computed `max`.

**Rationale**: `admin/system/page.tsx` already proves the intended split — importing `charts.tsx` (primitives) is fine; importing `data.tsx` (the mock series) is what makes a page fake. `admin/gateway/page.tsx` is the closest precedent: real BFF fetch + hand-built charts + `cache:"no-store"` + honest-degrade copy. Wiring real series is just "fetch, compute max, pass in" — no chart change. Rejected: rewriting the charts (unnecessary); a client-supplied identity (the BFF injects `x-owner` from the session — the client sends only `x-chain-id`).

## D12 — Multisig balances via live reads only — no indexer, no migration, no snapshot

**Decision**: The Multisig balances card reads the treasury Safe's native + ERC-20 balances live (`eth_getBalance` + ERC-20 `balanceOf`) on render; nothing is indexed or stored. The Safe address comes from feature 014 (a non-key config constant); the card honest-degrades when unconfigured.

**Rationale**: Balances are a point-in-time on-chain fact — a live read is the most provable form and needs no ledger (Principle III + VII). The existing transports (`chain/vault_reader.py` `HttpxJsonRpcTransport` for `eth_getBalance`, viem `PublicClient` on the web) already do this keylessly. The card also states the Safe's **actual** on-chain power (a plain holder, no user-fund-movement authority — N5), proving rather than asserting. Rejected: a balance-snapshot table (unneeded persistence; a historical-balance chart is a later want, not MVP).

## D13 — New billing/indexer constants read outside `AgentConfig`, values in base units (no USD oracle)

**Decision**: The fee-recipient set, swap-router address, and vault-deploy block per network are read directly in the new modules (as `main.py` already reads `PREMIUM_ALLOWLIST` outside `AgentConfig`), not funneled through the keyless vault-read config. The multisig **Safe address** for the balances card is owned by feature 014 and consumed as `FEE_WALLET_ADDRESS`. Fee values are recorded/summed in each token's base units with its decimals; the dashboard shows no USD figure it cannot source.

**Rationale**: `AgentConfig` is a deliberately closed, keyless allowlist guarded by `_assert_no_key_material`; keeping non-key display constants out of it preserves that provable-keyless posture. There is no on-chain SRK/token USD oracle, so summing in base units is the only honest aggregation (Principle III); a fabricated USD conversion would be a promise, not a proof. Rejected: routing constants through `AgentConfig` (muddies the keyless guarantee); implying USD totals without an oracle.

## D14 — Ship the swap-fee ledger first (Phase 0/A), then the page (Phase B) — recipient-cutover aware

**Decision**: The indexer + `0018` land before the page rebuild, and the swap indexer's `to`-recipient filter is a **configurable set** so that when feature 014 moves the fee recipient to the Safe, the filter can union the old EOA and the new Safe across the cutover block.

**Rationale**: The ledger must be backfilling before the dashboard can show a real swap number; landing the migration + indexer first (Phase 0/A) means Phase B's page immediately has data. Feature 014 will re-point the vault `feeRecipient` (via the Timelock) and the `robinhoodTestnet.ts` constant; a single-address `to` filter would drop the stream at the cutover block, so making it a set future-proofs the indexer without building 014 here. The migration `0018` **number is the next free sequential number — confirm it is still the next free sequential number at apply time (feature 011 merged `0016_vault_factory` to develop 2026-07-22).** Rejected: hard-coding one recipient (breaks at the 014 cutover); building 014's recipient move here (out of scope).

## Adversarial review notes (recorded)

- **Shared-treasury double-count (highest).** If premium treasury == swap fee recipient == the 014 Safe, a "credits to recipient" indexer double-counts membership payments as swap revenue. **Answered** by D7's disjoint attribution keys: swap requires `from == router`; membership comes only from 012's ledger; perf only from `fee_events`. A single inbound `Transfer` can match at most one stream. A test drives one membership `Transfer`, one perf event, and one swap fee to a **shared** address and asserts each lands in exactly one stream (SC-004).
- **Native-ETH-out revenue gap.** `unwrapWETH9WithFee` emits no log → logs-only indexing silently under-counts. **Answered** by D4: the gap is disclosed on the stream (never presented as complete), with trace-based capture deferred. Fabricating or omitting the gap would violate Principle III.
- **Reorg / finality.** A shallow-confirmed fee `Transfer` can reorg out, leaving phantom revenue. **Answered** by D5: the cursor advances only past a finality margin and unfinalized blocks are re-scanned, so a reorged-out block retains zero events (SC-009). Idempotent `(network_id, tx_hash, log_index)` makes the re-scan safe.
- **Fabricated-figure regression (Principle III).** The current page's whole value proposition is fabricated. **Answered** by D1/D2/D11: the mock import is removed, every figure is ledger- or live-read-derived, a real `$0` is distinct from `configured:false`, and the "Sample data" pill drops only per live stream. A Playwright test asserts no `data.tsx` mock series feeds the page (SC-001).
- **Perf divergence.** A re-implemented perf aggregation could drift from the tested `revenue_summary`. **Answered** by D8: the endpoint calls the existing aggregator; a parity test asserts equality (SC-006).
- **Access leak.** Revenue is operator-sensitive. **Answered** by D10: `require_admin` 404-invisible posture keyed on the server-verified owner; non-admins cannot distinguish the surface from a non-existent route (SC-010). The client never supplies identity — the BFF injects `x-owner` from the SIWE session.
- **N5 / Timelock ceremony context (from adjacent 014).** Moving the fee recipient to the Safe is a Timelock `schedule`→`execute` ceremony, and the Safe must gain **zero** fund-movement power. 013 does not perform that move, but its swap indexer's `to`-filter is a configurable set (D14) so the recipient cutover doesn't drop the stream, and its multisig card (D12) displays the Safe's actual (nil) custody power — proving N5 rather than asserting it.
- **Cross-feature ordering.** 013 reads 012's `payments` and 014's Safe address but owns neither. **Answered** by D9/D12 honest-degrade: each stream/card is live-or-absent independently, so 013 ships to `develop` before or after 012/014 without a hard dependency.
