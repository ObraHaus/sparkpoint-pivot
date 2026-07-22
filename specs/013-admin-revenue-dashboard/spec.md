# Feature Specification: Admin Revenue Dashboard (real data)

**Feature Branch**: `feature/013-admin-revenue-dashboard`

**Created**: 2026-07-21

**Status**: Draft

**Input**: User description: "Instrument the admin revenue dashboard with real on-chain data across three streams (swap routing fee, vault performance fee, SRK membership), replacing sample data."

SparkPoint's admin **Revenue** panel is today **100% illustrative**: `apps/web/src/app/admin/revenue/page.tsx` performs zero fetches — every KPI (`$13.9K`, `$82.8K`), every stacked bar, and every trajectory line is an inline literal imported from `apps/web/src/components/admin/data.tsx` (`revByStream` at `:13`), and an inline "Sample data" pill (`revenue/page.tsx:56-58`) admits as much. Meanwhile the platform *does* earn real fees — the 0.20% swap routing fee is collected on-chain into a fee-recipient EOA today but is **indexed nowhere** — so the one honest number the operator most needs does not exist yet. This feature replaces the mock with **real, on-chain-derived revenue** across three streams: **(1) swap routing fee** (0.20%, taken inside the user-signed Uniswap swap — a brand-new indexer), **(2) vault performance fee** (10%/high-water-mark — already aggregated by `FeeIndexer.revenue_summary` over the `fee_events` ledger, currently wired only to unit tests), and **(3) SRK membership** (summed over feature 012's `payments` table). Per the constitution's **Provable, Not Promised** principle, the dashboard shows **only** figures reconstructable from on-chain ledgers, **honest-degrades per stream** to a `configured:false` state when a source is down, and drops the "Sample data" pill **only for a stream that is actually live** — no fabricated, projected, or placeholder figures ever render.

## Clarifications

### Session 2026-07-21

Resolved with the operator before authoring (locked decisions):

- **Q: What may the dashboard show?** → **A: Only realized, on-chain-reconstructable revenue.** No forecasts, no projected/"EST" series, no illustrative fills. A stream with no live ledger shows an explicit "not yet instrumented / cannot load" state, never a number. (Constitution III.)
- **Q: How is the swap routing fee captured, given it emits no bespoke event?** → **A: Index the ERC-20 `Transfer(from = SwapRouter02, to = feeRecipient)` log** on the output token, keyed idempotently. The native-ETH-out leg (`unwrapWETH9WithFee`) emits **no log** and is therefore **under-counted** by a logs-only MVP — this gap MUST be disclosed on the dashboard rather than silently swallowed.
- **Q: Is the performance-fee stream new work?** → **A: No — wire the existing aggregator.** `FeeIndexer.revenue_summary` already computes cumulative + per-period buckets over the `fee_events` ledger (migration 0002); this feature calls it from a new admin endpoint. No new indexer for perf.
- **Q: Where does membership revenue come from?** → **A: Feature 012's `payments` table**, summed by period. This stream honest-degrades to `configured:false` until 012's migration is applied — 013 ships independently of 012.
- **Q: When is the "Sample data" pill removed?** → **A: Per-stream, only when that stream is live.** A stream still on `configured:false` keeps an honest "not instrumented" affordance; the page-level pill is removed once at least one stream reports real data, and each stream self-labels its own state.
- **Q: Does the double-count trap need handling?** → **A: Yes.** If the premium treasury, the swap fee recipient, and the multisig are the same Safe, the swap indexer would otherwise ingest an SRK membership `Transfer` as swap revenue. The indexers MUST disambiguate: swap = `from == router`; membership = `from == buyer ∧ token == SRK`; perf = `fee_events`.
- **Q: How are multisig treasury balances shown?** → **A: Live on-chain reads only** (`eth_getBalance` + ERC-20 `balanceOf`) — no indexer, no migration, no snapshot table for balances. The Safe address is supplied by feature 014.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An operator sees real revenue by stream, each stream honest about its own state (Priority: P1) 🎯 MVP

An operator opens **Admin → Revenue** and sees, from real on-chain ledgers, the platform's cumulative and per-period revenue broken down by stream (swap routing fee, vault performance fee, SRK membership). Each stream shows a real number when its ledger is live and an explicit "not yet instrumented / cannot load" state when it is not — the operator can always tell, per stream, whether a figure is real. No sample series, no projections, and no "Sample data" pill for a stream that is actually reporting.

**Why this priority**: This is the whole point of the feature and the governing constitutional promise (Provable, Not Promised): the panel that today invites the operator to trust fiction must instead show only reconstructable truth, and must degrade honestly. It is a viable MVP on its own — even with just one stream live and the other two honest-degrading, the page is finally trustworthy, which the current mock is not.

**Independent Test**: With the swap-fee (or perf-fee) stream live and the others un-configured, open the Revenue page; confirm the live stream shows real cumulative + per-period totals sourced from its ledger, the un-configured streams render an explicit not-instrumented state (no number), and the page shows no fabricated KPI and no page-level "Sample data" pill once any stream is live.

**Acceptance Scenarios**:

1. **Given** at least one revenue stream has a live ledger, **When** an operator opens the Revenue page, **Then** that stream's cumulative and per-period totals are shown from real records — with **no** "Sample data" placeholder for that stream.
2. **Given** a stream's data source is unavailable or not yet configured, **When** the page renders, **Then** that stream shows an explicit "not instrumented / cannot load" state and **no** number — never a fabricated or carried-over figure.
3. **Given** the summary endpoint is unreachable entirely, **When** the page loads, **Then** it degrades honestly (states it cannot load) rather than falling back to the old mock series.
4. **Given** a non-admin, **When** they attempt to reach the revenue summary surface or its API, **Then** it is invisible to them (indistinguishable from not existing).

---

### User Story 2 - The swap routing fee is indexed on-chain, with the native-ETH gap disclosed (Priority: P1)

The 0.20% swap routing fee — collected on-chain today but recorded nowhere — becomes a real revenue stream. A new indexer replays the fee-recipient's inbound token transfers from the swap router into an idempotent ledger, backfilled from the vault-deploy block so the first cumulative number is honest. Because the native-ETH-out leg of a swap emits no log, the indexer under-counts that case; the dashboard discloses this gap plainly rather than presenting the logs-only figure as complete.

**Why this priority**: The swap fee is the platform's only realized revenue to date and is currently completely invisible to the backend — this stream is where the dashboard's first honest dollar comes from, so it is P1 alongside US1. It is also the only stream requiring a genuinely new indexer; perf and membership are wiring.

**Independent Test**: On a network with the fee recipient configured, execute (or replay) a token-out swap that pays the 0.20% fee; run the indexer and confirm the fee `Transfer` is recorded exactly once (idempotent on re-run), attributed to the correct output token and value, and surfaced in the swap stream's totals — and confirm a native-ETH-out swap is reflected by a disclosed "under-counts native-ETH-out" note rather than a silently-wrong total.

**Acceptance Scenarios**:

1. **Given** a token-out swap paid the 0.20% fee to the recipient, **When** the swap indexer runs, **Then** a single `swap_fee_events` row is recorded (`network_id, tx_hash, log_index` unique) with the output token and fee value.
2. **Given** the indexer is run twice over the same range, **When** it completes, **Then** no fee event is double-counted (idempotent upsert) and the cursor advances only past finalized blocks.
3. **Given** the swap stream is displayed, **When** it renders, **Then** it discloses that native-ETH-out fees are not captured by the logs-only indexer (an honest under-count note), rather than implying completeness.
4. **Given** the fee recipient is the shared treasury/Safe, **When** an SRK membership payment or a performance-fee event also touches that address, **Then** the swap indexer does **not** ingest it (disambiguation: swap requires `from == router`).
5. **Given** the backfill starts from the vault-deploy block, **When** the first cumulative total is shown, **Then** it reflects fees from inception forward, not an arbitrary recent window.

---

### User Story 3 - The performance-fee stream is wired from the existing aggregator (Priority: P2)

The vault's 10%/high-water-mark performance fee — already aggregated in code by `FeeIndexer.revenue_summary` over the `fee_events` ledger but wired to nothing except unit tests — is surfaced on the dashboard. A new admin endpoint calls the existing aggregator and returns cumulative + per-period buckets; the stream honest-degrades when the vault/ledger is unavailable.

**Why this priority**: The aggregator already exists and is tested — this is low-risk wiring that adds a second real stream. P2 because on testnet the perf-fee figure is ~zero (little realized yield), so it is real but less operationally urgent than the swap stream that carries actual revenue.

**Independent Test**: With the `fee_events` ledger populated (or seeded in a test), call the summary endpoint and confirm the perf stream returns the same cumulative + monthly buckets the aggregator produces directly; with the vault unavailable, confirm the stream returns `configured:false` rather than an error or a zero presented as real.

**Acceptance Scenarios**:

1. **Given** the `fee_events` ledger has performance-fee accruals, **When** the summary endpoint is called, **Then** the perf stream returns cumulative + per-period totals matching `FeeIndexer.revenue_summary`.
2. **Given** the vault/ledger is unavailable, **When** the perf stream is requested, **Then** it returns `configured:false` (honest-degrade), not a fabricated or zero-as-real figure.
3. **Given** the perf stream is live, **When** it renders on the dashboard, **Then** it drops the "Sample data" affordance for that stream.

---

### User Story 4 - The membership stream reads feature 012's payments (Priority: P2)

SRK membership revenue is summed from feature 012's `payments` table, bucketed by period, and shown as the third stream. Because 012 is a separate feature that may not yet be applied, this stream honest-degrades to `configured:false` when the `payments` table is absent — so 013 ships and is useful before 012 lands.

**Why this priority**: Membership is a real revenue stream once 012 exists, and completing the three-stream picture is the feature's stated scope. P2 because it has a hard dependency on 012's migration; until that is applied the stream is honestly empty, so it must not block US1/US2.

**Independent Test**: With 012's `payments` table present and rows recorded, call the summary endpoint and confirm the membership stream sums verified payments by period; with the table absent, confirm the stream returns `configured:false` and the page renders the other streams unaffected.

**Acceptance Scenarios**:

1. **Given** feature 012's `payments` table exists with verified payments, **When** the summary endpoint is called, **Then** the membership stream returns per-period sums of those payments.
2. **Given** the `payments` table does not exist yet, **When** the membership stream is requested, **Then** it returns `configured:false` and the other two streams render normally.
3. **Given** the membership stream sums payments, **When** it does so, **Then** it counts only verified payment rows (never a pending/unverified submission) and never double-counts a swap or perf event (disambiguation: membership = 012's ledger, `from == buyer ∧ token == SRK`, not the swap indexer).

---

### User Story 5 - The multisig treasury balances and power are shown live (Priority: P3) 🛡️

An operator sees, from live on-chain reads, the current balances held by the fee/treasury multisig (native ETH + the relevant ERC-20s) and its actual on-chain power — displayed truthfully as a plain holder with no fund-movement authority over user funds. Balances come from direct `eth_getBalance` / `balanceOf` reads with no indexer and no migration.

**Why this priority**: It closes the Provable-Not-Promised loop for where the money actually lands and lets the operator verify treasury holdings against the indexed revenue. It is a security/transparency story (🛡️) because it surfaces the multisig's *actual* permissions (nil over custody, per N5), not an assertion. P3 because it is a live-read card layered on top of the indexed streams and depends on feature 014 supplying the Safe address.

**Independent Test**: With the multisig address configured (from 014), open the Revenue page and confirm the balances card shows the live ETH + ERC-20 balances of that address (matching a block explorer at the same block) and states the Safe's on-chain power truthfully; with no address configured, confirm the card honest-degrades.

**Acceptance Scenarios**:

1. **Given** the multisig address is configured, **When** the balances card renders, **Then** it shows live native + ERC-20 balances read directly on-chain (no indexer, no stored snapshot), consistent with a block explorer.
2. **Given** the multisig address is not configured, **When** the card renders, **Then** it honest-degrades (states it is unavailable) rather than showing a placeholder balance.
3. **Given** the card states the multisig's power, **When** it renders, **Then** it reflects the Safe's actual on-chain authority (a plain recipient/holder with no user-fund-movement power), not an asserted or aspirational role.

---

### Edge Cases

- **A source is down mid-render**: each stream is resolved independently; one stream failing (RPC outage, missing table) MUST NOT blank the others — it degrades to `configured:false` in isolation.
- **Native-ETH-out swap fee**: produces no log → the logs-only indexer under-counts it; the shortfall is disclosed, never silently absorbed into a "complete" total.
- **Shared-treasury double-count**: premium treasury == swap fee recipient == same Safe → the swap indexer must reject non-router-sourced transfers, membership must come from 012's ledger, and perf from `fee_events`, so a single inbound `Transfer` is never attributed to two streams.
- **Reorg / finality on the swap indexer**: the cursor advances only past a finality margin so a reorged-out fee `Transfer` is not left recorded as revenue; unfinalized blocks are re-scanned.
- **Empty ledger vs unavailable ledger**: a live-but-empty stream (real total of `$0`) is distinct from an un-configured stream (`configured:false`) — the two MUST NOT be conflated (a real zero is honest; a fabricated fill is not).
- **Backfill honesty**: the swap stream's cumulative begins at the vault-deploy (or fee-recipient-inception) block, so the first number reflects revenue from inception, not an arbitrary recent window.
- **Chain scope**: the summary is requested for a specific network (`x-chain-id`); a stream with no ledger on that network reports `configured:false` for that network rather than borrowing another network's figure.
- **Decimals/valuation**: fee values are recorded and summed in each token's base units with its decimals; the dashboard must not imply a USD figure it cannot source (no on-chain USD oracle is assumed).

## Requirements *(mandatory)*

### Functional Requirements

**Provable display (governing)**

- **FR-001**: The Revenue dashboard MUST display **only** figures reconstructable from on-chain ledgers or live on-chain reads; it MUST NOT render any fabricated, projected, illustrative, or placeholder figure.
- **FR-002**: The dashboard MUST resolve each of the three streams (swap, perf, membership) independently and MUST **honest-degrade** any stream whose source is unavailable to an explicit `configured:false` / "not instrumented" state carrying **no** number.
- **FR-003**: The page MUST remove the "Sample data" affordance **per-stream, only when that stream is live**; a stream still degrading MUST retain an honest not-instrumented affordance, and the mock series import MUST be removed from the page.
- **FR-004**: When the summary source is entirely unreachable, the page MUST degrade honestly (state it cannot load) rather than reverting to any sample/placeholder series.
- **FR-005**: A live-but-empty stream (a genuine `$0`) MUST be presented as a real zero, distinct from an un-configured stream (`configured:false`); the two states MUST NOT be conflated.

**Swap routing-fee indexing**

- **FR-006**: The system MUST index the 0.20% swap routing fee by recording the ERC-20 `Transfer(from = SwapRouter02, to = fee recipient)` log on the output token into an idempotent ledger keyed uniquely by `(network_id, tx_hash, log_index)`.
- **FR-007**: The swap-fee indexer MUST backfill from the vault-deploy (or fee-recipient-inception) block so the first cumulative total reflects revenue from inception, and MUST persist its progress in the existing indexer-cursor mechanism keyed by `(network, stream)`.
- **FR-008**: The swap-fee indexer MUST advance its cursor only past a finality margin and MUST re-scan unfinalized blocks, so a reorged-out fee transfer is not retained as revenue.
- **FR-009**: The swap stream MUST **disclose** that the native-ETH-out fee leg (`unwrapWETH9WithFee`, which emits no log) is not captured by the logs-only indexer — an explicit under-count note — rather than presenting the logs-only figure as complete.
- **FR-010**: The swap-fee indexer MUST attribute only transfers whose `from` is the swap router; it MUST NOT ingest a membership (`from == buyer ∧ token == SRK`) or performance-fee transfer even when the fee recipient, premium treasury, and multisig are the same address (no double-count).

**Performance-fee wiring**

- **FR-011**: The performance-fee stream MUST be sourced from the existing `FeeIndexer.revenue_summary` aggregation over the `fee_events` ledger — reused, not re-implemented — returning cumulative + per-period buckets.
- **FR-012**: The performance-fee stream MUST honest-degrade to `configured:false` when the vault/ledger is unavailable, and MUST never present an error or a zero-as-real in that state.

**Membership stream**

- **FR-013**: The membership stream MUST sum feature 012's `payments` table by period, counting only **verified** payments, and MUST honest-degrade to `configured:false` when that table is absent (so 013 ships independently of 012).
- **FR-014**: The membership stream MUST source from 012's payment ledger and MUST NOT be derived from the swap indexer, so a membership transfer is never counted as swap revenue.

**Aggregation endpoint & access**

- **FR-015**: The system MUST expose an admin-only revenue summary endpoint that returns the three streams shaped to drop into the dashboard's existing series (`{ swap, perf, premium }`, each carrying its `configured` state + cumulative + per-period buckets).
- **FR-016**: The summary endpoint MUST be admin-gated such that a non-admin cannot distinguish it from a non-existent route (invisible, 404-posture), keyed on the server-verified owner identity, never a client-asserted one.
- **FR-017**: The dashboard MUST fetch the summary through the existing same-origin backend proxy with no client-supplied identity, and MUST reuse the existing chart primitives unchanged (passing real series + a computed scale).

**Multisig treasury (live reads)**

- **FR-018**: The dashboard MUST show the fee/treasury multisig's current balances (native + relevant ERC-20s) from **live on-chain reads** (`eth_getBalance` / `balanceOf`) with **no** indexer, **no** migration, and **no** stored balance snapshot.
- **FR-019**: The multisig card MUST display the Safe's **actual** on-chain power truthfully — a plain recipient/holder with no user-fund-movement authority (N5) — not an asserted role, and MUST honest-degrade when no address is configured.

**Constitutional**

- **FR-020**: No part of this feature may add, read, or expose any path that moves user funds, and the revenue instrumentation MUST NOT gate, throttle, or affect any deposit, withdraw, redeem, swap, or exit path.
- **FR-021**: The dashboard MUST NOT introduce any return projection, yield promise, or forward-looking revenue estimate; all figures are realized and on-chain-verifiable (Provable, Not Promised).

### Key Entities *(include if feature involves data)*

- **Swap Fee Event** (new — `services/agent/migrations/0018_swap_fee_events.sql`): an append-only, idempotent record of one collected swap routing fee — `network_id`, `tx_hash`, `log_index` (unique together), block number/time, output token address + decimals, and fee value in base units. Attribution key = `from == router`.
- **Indexer Cursor** (existing — migration 0001 `indexer_cursors`): gains a `(network, stream='swap_fee')` row tracking the last finalized block the swap-fee indexer has processed.
- **Fee Event** (existing — migration 0002 `fee_events`): the performance-fee ledger already aggregated by `FeeIndexer.revenue_summary`; read-only source for the perf stream.
- **Payment** (feature 012 — `payments`): verified SRK membership payments; read-only source for the membership stream, summed by period.
- **Revenue Summary** (in-app wire shape — new admin endpoint): the per-stream response `{ swap, perf, premium }`, each carrying `configured`, a cumulative total, per-period buckets, and disclosure flags (e.g. the swap native-ETH under-count).
- **Multisig Balance** (live read — no persistence): the current native + ERC-20 balances of the treasury Safe, read on demand; not stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Revenue page performs **zero** reads from the mock series (`components/admin/data.tsx`); **100%** of displayed stream figures are sourced from an on-chain ledger or a live on-chain read.
- **SC-002**: For a stream whose source is unavailable, the page shows an explicit not-instrumented state and **zero** fabricated numbers, in **100%** of tested outage/absence cases (per-stream, without blanking the others).
- **SC-003**: A collected token-out swap fee appears in the swap stream's cumulative total within **one indexer interval**, recorded **exactly once** (idempotent across re-runs), and attributed to the correct output token and value.
- **SC-004**: **Zero** transfers are double-counted across streams when the fee recipient, premium treasury, and multisig are the same address — verified with a membership `Transfer`, a perf event, and a swap fee to one shared address.
- **SC-005**: The swap stream **always** discloses the native-ETH-out under-count when displayed (a native-ETH-out fee never inflates the total nor is presented as captured).
- **SC-006**: The perf stream's cumulative + per-period figures **exactly match** `FeeIndexer.revenue_summary` over the same `fee_events` data (no divergent re-implementation).
- **SC-007**: The membership stream sums only verified payments and returns `configured:false` (not an error, not a zero-as-real) in **100%** of cases where 012's `payments` table is absent.
- **SC-008**: The multisig balances card matches a block explorer's balances for the same address at the same block, and is produced with **no** new migration and **no** stored balance row.
- **SC-009**: The swap-fee indexer's cursor never advances past the finality margin, so a reorged-out block leaves **zero** retained fee events (verified by re-scanning unfinalized blocks).
- **SC-010**: A non-admin receives a response indistinguishable from a non-existent route (**100%** invisible) for both the summary API and the page's data.

## Assumptions

- **Provable-not-Promised governs.** The operator has locked that only realized, on-chain-reconstructable revenue may be shown; no forecasts or illustrative fills. This is the star principle for the feature.
- **The perf aggregator is reused as-is.** `FeeIndexer.revenue_summary` over `fee_events` (migration 0002) already produces the cumulative + per-period shape; the feature wires it to a new endpoint rather than re-deriving it.
- **The swap fee is real but unindexed today.** The 0.20% fee is collected on-chain into the fee recipient EOA (`0xA71e…5c30` on the live testnets) and recorded nowhere in the backend; the new indexer is the dashboard's first honest number. The native-ETH-out leg emits no log and is an accepted, disclosed under-count for the MVP (a trace-based capture is a later enhancement).
- **Membership depends on feature 012.** The `payments` table is owned by 012; 013 reads it when present and honest-degrades when absent, shipping independently to `develop`.
- **The multisig address is supplied by feature 014.** Balances are live reads only; if 014 has not landed, the multisig card honest-degrades. Moving the fee recipient to the Safe (014) may require the swap indexer's `to` filter to union the old EOA and the new Safe across the cutover block — recorded for the plan, handled here only via a configurable recipient set.
- **Identity & access reuse the existing model.** The summary endpoint is admin-gated (404-posture, server-verified owner) and reached through the existing backend proxy; the dashboard sends no identity of its own.
- **No USD oracle is assumed.** Fee values are summed in each token's base units with its decimals; the dashboard does not fabricate a USD figure it cannot source.
- **Single agent replica / testnet scope** (Base 8453 / Base Sepolia 84532 / Robinhood 46630), consistent with the rest of the alpha.
