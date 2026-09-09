# Data Model: Admin Revenue Dashboard (real data) (Phase 1)

One new Postgres table (agent-owned) added by `services/agent/migrations/0018_swap_fee_events.sql`, one new row in the existing `indexer_cursors` (0001), two read-only ledgers this feature only *reads* (`fee_events` from 0002 and feature 012's `payments`), plus the in-app shapes the aggregation endpoint and the web page exchange. The multisig balances card persists **nothing** — it is a live on-chain read modeled here for completeness. Field notes call out the invariants tests must enforce. The new ledger copies the live `fee_events` / `vault_flows` conventions verbatim: `network_id TEXT NOT NULL DEFAULT 'base' REFERENCES networks(id)`, a `UNIQUE(network_id, tx_hash, log_index)` idempotency key, `CREATE TABLE IF NOT EXISTS` + `ON CONFLICT DO NOTHING` inserts.

> **Migration `0018_swap_fee_events.sql`.** `0016_vault_factory` (feature 011) is the latest on develop and 012 takes `0017`, so `0018` is the next free number — confirm it is still free when you create the file.

## swap_fee_events (new — `services/agent/migrations/0018_swap_fee_events.sql`)

The append-only, idempotent ledger of collected 0.20% swap routing fees — one row per fee-recipient `Transfer` from the swap router on the output token. This is the swap stream's only source; the fee is collected on-chain today (`sweepTokenWithFee`) but recorded nowhere. Modeled on `fee_events` (`0002_vault.sql`).

| Column | Type | Notes |
|---|---|---|
| `id` | BIGSERIAL PRIMARY KEY | |
| `network_id` | TEXT NOT NULL DEFAULT `'base'` REFERENCES `networks(id)` | Scopes every read to one chain (84532 / 46630 today). |
| `tx_hash` | TEXT NOT NULL | The swap transaction. `0x` + 64 hex, lowercased. |
| `log_index` | INT NOT NULL | The `Transfer` log's index within the receipt. |
| `block_number` | BIGINT NOT NULL | For finality/backfill accounting; cursor advances only past a margin. |
| `block_time` | TIMESTAMPTZ NOT NULL | Truncated into per-period buckets on aggregation. |
| `token_address` | TEXT NOT NULL CHECK (`token_address = lower(token_address)`) | The **output token** the fee was paid in. |
| `token_decimals` | SMALLINT NOT NULL | Decimals of the output token; the fee is summed in base units, valued with this. |
| `fee_value_raw` | NUMERIC(78,0) NOT NULL CHECK (`fee_value_raw >= 0`) | The fee amount in the output token's base units (uint256-safe). |
| `from_address` | TEXT NOT NULL CHECK (`from_address = lower(from_address)`) | The `Transfer`'s `from` — **MUST equal the swap router** (attribution key; see invariants). |
| `to_address` | TEXT NOT NULL CHECK (`to_address = lower(to_address)`) | The configured fee recipient. |
| `indexed_at` | TIMESTAMPTZ NOT NULL DEFAULT now() | When the indexer recorded it. |
| CONSTRAINT | `UNIQUE (network_id, tx_hash, log_index)` | Idempotency key — `ON CONFLICT DO NOTHING`. |

Indexes: `(network_id, block_time DESC)` for per-period aggregation; `(network_id, block_number)` for backfill/finality sweeps. **Invariants**: idempotent insert — re-running the indexer over an overlapping range records **zero** duplicates (SC-003); `from_address == the swap router` is asserted **at ingest**, so a membership (`from == buyer`) or performance-fee transfer to a shared treasury is never written here (FR-010 / SC-004 / D7); `fee_value_raw` and `token_decimals` are stored so the aggregate sums in base units with no fabricated USD conversion (FR-021 / D13); a row is retained only once its block is past the finality margin — a reorged-out block leaves zero rows (FR-008 / SC-009 / D5). Values are never negative.

## indexer_cursors (existing — `services/agent/migrations/0001_init.sql`) — gains a swap-fee row

The shared indexer progress table (already used by the vault flow/fee indexers). The swap-fee indexer persists its progress here rather than in a new cursor mechanism (D5). No schema change — one new logical row.

| Column | Type | Notes (for the new row) |
|---|---|---|
| `network` / `network_id` | TEXT | The chain being indexed (84532 / 46630). |
| `stream` | TEXT | **`'swap_fee'`** — the new stream key, disjoint from the existing vault-flow/fee streams. |
| `last_block` | BIGINT | The last **finalized** block the swap-fee indexer has processed; seeded to the vault-deploy (fee-recipient-inception) block on first run so the backfill is honest (FR-007 / D6). |

**Invariants**: exactly one `(network, stream='swap_fee')` row per network; the cursor advances only past the finality margin and unfinalized blocks are re-scanned (FR-008 / SC-009); the initial value is the inception block, never a recent window, so the first cumulative total reflects revenue from inception (FR-007 / D6). Reusing this table avoids a second cursor mechanism (Principle VII).

## fee_events (existing — `services/agent/migrations/0002_vault.sql`) — read-only source for the perf stream

The performance-fee ledger the vault indexer already fills (`PerformanceFeeAccrued` / `HighWaterMarkUpdated` / `FeeRateUpdated`). This feature **reads** it only, through the existing aggregator — it writes nothing here and re-implements no aggregation. Carries `UNIQUE(network_id, tx_hash, log_index)`, `fee_shares_minted_raw`, `yield_realized_raw`, `block_time` (the columns `FeeIndexer.revenue_summary` folds into `PeriodBucket`s). **Invariant for 013**: the perf stream's cumulative + per-period figures MUST equal `FeeIndexer.revenue_summary` over the same rows — no divergent re-derivation (FR-011 / SC-006 / D8).

## payments (feature 012 — `services/agent/migrations/0017_subscriptions.sql`) — read-only source for the membership stream

Owned by feature 012 (SRK membership purchases), **not** by 013. The membership stream SUMs this ledger by period, counting only **verified** payments. 013 reads it when present and **honest-degrades to `configured:false`** when the table is absent, so 013 ships independently of 012 (FR-013 / D9). Relevant columns 013 consumes: `network_id`, `amount_raw` (SRK base units), `block_time`/`created_at` for bucketing, and the verified/settled marker. The `UNIQUE(network_id, tx_hash)` on `payments` is 012's anti-replay control; 013 relies on it so a single payment is summed once. **Invariant for 013**: membership revenue is derived from **this** ledger only (`from == buyer ∧ token == SRK`), never from the swap indexer — so a membership transfer is never double-counted as swap revenue (FR-014 / SC-004 / D7). 012's migration is `0017_subscriptions.sql`.

> **012 `payments` is a dependency read, not a 013 deliverable.** If 012 has not landed, the membership stream is `configured:false` and the other two streams render unaffected.

## RevenueSummary (in-app wire shape — `services/agent/src/sparkpoint_agent/api/admin_revenue.py`)

The response of `GET /admin/revenue/summary`, shaped to drop into the page's existing `revByStream` series (stream keys `swap` / `perf` / `premium`). Each stream is resolved inside its own `try/except` and carries its own `configured` state, so one dead source never blanks the others (FR-002 / D1). Not persisted.

```python
@dataclass(frozen=True)
class StreamSeries:
    configured: bool                 # False ⇒ source unavailable/not instrumented (NO number rendered)
    cumulative_raw: int              # cumulative revenue in the stream's base units (0 is a REAL zero, distinct from configured=False)
    token_decimals: int | None       # for base-unit → display scaling; None when configured=False
    periods: list[PeriodPoint]       # per-period buckets (month by default), empty when configured=False
    disclosures: list[str]           # honest notes, e.g. the swap native-ETH-out under-count (FR-009)

@dataclass(frozen=True)
class PeriodPoint:
    period_start: str                # ISO date of the bucket (month/day truncation)
    value_raw: int                   # revenue in the bucket, base units

# GET /admin/revenue/summary  ->
# { "swap": StreamSeries, "perf": StreamSeries, "premium": StreamSeries, "networkId": str }
```

**Invariants**: `configured == False` carries **no** number and is distinct from a live-but-empty stream reporting a real `cumulative_raw == 0` (FR-005 / SC-002 / D2); the swap stream always includes the native-ETH-out under-count in `disclosures` when it is configured (FR-009 / SC-005); values are base units — the endpoint never emits a USD figure it cannot source (FR-021 / D13); the response is admin-only (the route is `require_admin`-gated, 404 to non-admins — FR-016 / SC-010).

## SwapFeeSummary aggregation (in-app — `services/agent/src/sparkpoint_agent/db/swap_fees.py`)

The store over `swap_fee_events`, mirroring `PgFeeEventStore` / `FeeIndexer.revenue_summary`: an idempotent insert plus a cumulative + per-period aggregation the endpoint folds into the swap `StreamSeries`. Not a table — the in-app shape.

```python
@dataclass(frozen=True)
class SwapFeeRevenueSummary:
    network_id: str
    cumulative_fee_raw: int                 # SUM(fee_value_raw) for the network, base units
    event_count: int
    first_event_time: datetime | None       # inception marker for the honest cumulative
    last_event_time: datetime | None
    periods: tuple[SwapFeePeriodBucket, ...] # per-period SUM(fee_value_raw)

@dataclass(frozen=True)
class SwapFeePeriodBucket:
    period_start: datetime
    fee_value_raw: int
    event_count: int
```

**Invariants**: aggregation runs in Python over the fetched rows so the numbers are provable from the same rows the dashboard shows (mirrors `revenue_summary`'s stated posture); `cumulative_fee_raw` sums only `from == router` rows (guaranteed by the ingest-time attribution check); a network with no rows yields a real zero, not `configured:false` (the endpoint decides `configured` from source availability, not emptiness — D2).

## Multisig Balance (live read — no persistence — `apps/web/src/components/admin/revenue-multisig.tsx`)

The treasury Safe's current holdings, read live on render via `eth_getBalance` (native) + ERC-20 `balanceOf` — **no indexer, no migration, no snapshot table** (FR-018 / D12). Modeled here only to fix the wire shape; nothing is stored.

```ts
type MultisigBalance = {
  configured: boolean;      // false ⇒ no Safe address (from feature 014) → honest-degrade, no fabricated balance
  address?: `0x${string}`;  // the treasury Safe (supplied by feature 014)
  native?: bigint;          // eth_getBalance, wei
  tokens?: { token: `0x${string}`; decimals: number; balance: bigint }[]; // balanceOf per relevant ERC-20
  power: "recipient-only";  // the Safe's ACTUAL on-chain authority: a plain holder, no user-fund-movement power (N5)
};
```

**Invariants**: read on demand at a single block, consistent with a block explorer (SC-008); no row is ever written; `configured == False` when feature 014 has not supplied the Safe address — the card states it is unavailable rather than showing a placeholder balance (FR-019 / SC-008); the stated `power` reflects the Safe's real (nil over user funds) authority, proving N5 rather than asserting it (FR-019).
