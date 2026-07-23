"""Feature 013 — the swap-routing-fee ledger store + aggregate (DISPLAY/DERIVED-ONLY).

Mirrors ``data/fee_indexer.py``'s ``PgFeeEventStore`` / ``revenue_summary`` for the NEW
``swap_fee_events`` ledger (migration 0018): an idempotent insert plus a cumulative + per-period
aggregation the admin revenue endpoint folds into the swap ``StreamSeries``. Aggregation runs in
Python over the fetched rows so the numbers are provable from the same rows the dashboard shows.

Non-custody (N2): nothing here is ever read on the withdraw/redeem/exit path — a stalled ledger only
makes the admin revenue figure momentarily incomplete.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class SwapFeeEvent:
    """One collected swap routing fee — a ``Transfer`` FROM the router TO a fee recipient.

    ``from_address`` MUST equal the swap router (the attribution key asserted at ingest, so a
    membership ``from == buyer`` or a perf transfer to a shared treasury is never written here).
    Amounts are raw base units of the OUTPUT token (uint256-safe int).
    """

    network_id: str
    tx_hash: str  # lowercased 0x + 64 hex
    log_index: int
    block_number: int
    block_time: datetime
    token_address: str  # lowercased output token
    token_decimals: int
    fee_value_raw: int  # output-token base units
    from_address: str  # lowercased == the swap router
    to_address: str  # lowercased == the configured fee recipient


#: A fetched row is structurally identical to the insert unit (the ledger stores exactly these
#: fields); kept as an alias so the data-model's ``SwapFeeEventRow`` name resolves.
SwapFeeEventRow = SwapFeeEvent


@dataclass(frozen=True, slots=True)
class SwapFeePeriodBucket:
    """A per-period SUM(fee_value_raw) bucket for the dashboard time series."""

    period_start: datetime
    fee_value_raw: int
    event_count: int


@dataclass(frozen=True, slots=True)
class SwapFeeRevenueSummary:
    """Aggregate swap-routing-fee revenue for the admin dashboard (all raw base units).

    ``token_decimals`` is the decimals of the MOST RECENT fee row (for display scaling);
    ``distinct_token_decimals`` > 1 means fees were collected in output tokens of differing
    precision, so the caller should disclose that the base-unit sum mixes denominations.
    """

    network_id: str
    cumulative_fee_raw: int  # SUM(fee_value_raw) for the network, base units
    event_count: int
    token_decimals: int | None  # decimals of the latest fee row; None when empty
    distinct_token_decimals: int  # count of distinct token_decimals across the rows
    first_event_time: datetime | None
    last_event_time: datetime | None
    periods: tuple[SwapFeePeriodBucket, ...]


class SwapFeeEventStore(Protocol):
    """Persistence port for the swap-fee ledger (mockable; the deterministic path never sees it)."""

    async def record(self, ev: SwapFeeEvent) -> bool:
        """Insert idempotently; return True iff a new row was written (False on conflict)."""
        ...

    async def get_cursor(self, network_id: str) -> int: ...
    async def set_cursor(self, network_id: str, block: int) -> None: ...
    async def fetch(
        self, network_id: str, *, since: datetime | None = None, until: datetime | None = None
    ) -> list[SwapFeeEvent]: ...


#: The indexer_cursors.stream name for the swap-fee replay (reuses the 0001 table).
SWAP_FEE_STREAM = "swap_fee"


def _truncate(when: datetime, period: str) -> datetime:
    if period == "year":
        return when.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "month":
        return when.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    if period == "day":
        return when.replace(hour=0, minute=0, second=0, microsecond=0)
    raise ValueError(f"unsupported period {period!r} (expected day|month|year)")


def summarize_swap_fees(
    network_id: str, rows: Sequence[SwapFeeEvent], *, period: str = "month"
) -> SwapFeeRevenueSummary:
    """Pure cumulative + per-period aggregation over already-fetched rows (mirrors
    ``FeeIndexer.revenue_summary``'s posture — provable from the same rows the dashboard shows)."""
    cumulative = sum(r.fee_value_raw for r in rows)
    times = [r.block_time for r in rows]
    buckets: dict[datetime, int] = defaultdict(int)
    counts: dict[datetime, int] = defaultdict(int)
    for r in rows:
        key = _truncate(r.block_time, period)
        buckets[key] += r.fee_value_raw
        counts[key] += 1
    periods = tuple(
        SwapFeePeriodBucket(period_start=key, fee_value_raw=buckets[key], event_count=counts[key])
        for key in sorted(buckets)
    )
    # token_decimals from the most-recent row; disclose if the rows mix denominations.
    latest = max(rows, key=lambda r: (r.block_number, r.log_index)) if rows else None
    distinct_decimals = len({r.token_decimals for r in rows})
    return SwapFeeRevenueSummary(
        network_id=network_id,
        cumulative_fee_raw=cumulative,
        event_count=len(rows),
        token_decimals=latest.token_decimals if latest else None,
        distinct_token_decimals=distinct_decimals,
        first_event_time=min(times) if times else None,
        last_event_time=max(times) if times else None,
        periods=periods,
    )


class _Executor(Protocol):
    """The subset of ``db.pool.Database`` the store needs (keeps this module import-light)."""

    async def execute(self, query: str, *args: Any) -> str: ...
    async def fetch(self, query: str, *args: Any) -> list[Any]: ...
    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any: ...


class PgSwapFeeEventStore:
    """asyncpg-backed :class:`SwapFeeEventStore` over ``swap_fee_events`` (migration 0018).

    Parameterized SQL only. Idempotent insert via ``ON CONFLICT (network_id, tx_hash, log_index)
    DO NOTHING``; the cursor reuses ``indexer_cursors`` (stream ``'swap_fee'``).
    """

    def __init__(self, db: _Executor) -> None:
        self._db = db

    async def record(self, ev: SwapFeeEvent) -> bool:
        status = await self._db.execute(
            """
            INSERT INTO swap_fee_events (
                network_id, tx_hash, log_index, block_number, block_time,
                token_address, token_decimals, fee_value_raw, from_address, to_address
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING
            """,
            ev.network_id,
            ev.tx_hash.lower(),
            ev.log_index,
            ev.block_number,
            ev.block_time,
            ev.token_address.lower(),
            ev.token_decimals,
            ev.fee_value_raw,
            ev.from_address.lower(),
            ev.to_address.lower(),
        )
        return status.strip().endswith(" 1")

    async def get_cursor(self, network_id: str) -> int:
        value = await self._db.fetchval(
            "SELECT last_processed_block FROM indexer_cursors "
            "WHERE network_id = $1 AND stream = $2",
            network_id,
            SWAP_FEE_STREAM,
        )
        return int(value) if value is not None else 0

    async def set_cursor(self, network_id: str, block: int) -> None:
        await self._db.execute(
            """
            INSERT INTO indexer_cursors (network_id, stream, last_processed_block, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (network_id, stream)
            DO UPDATE SET last_processed_block = GREATEST(
                indexer_cursors.last_processed_block, EXCLUDED.last_processed_block
            ), updated_at = now()
            """,
            network_id,
            SWAP_FEE_STREAM,
            block,
        )

    async def fetch(
        self, network_id: str, *, since: datetime | None = None, until: datetime | None = None
    ) -> list[SwapFeeEvent]:
        rows = await self._db.fetch(
            """
            SELECT network_id, tx_hash, log_index, block_number, block_time,
                   token_address, token_decimals, fee_value_raw, from_address, to_address
            FROM swap_fee_events
            WHERE network_id = $1
              AND ($2::timestamptz IS NULL OR block_time >= $2)
              AND ($3::timestamptz IS NULL OR block_time <  $3)
            ORDER BY block_number, log_index
            """,
            network_id,
            since,
            until,
        )
        return [
            SwapFeeEvent(
                network_id=str(r["network_id"]),
                tx_hash=str(r["tx_hash"]),
                log_index=int(r["log_index"]),
                block_number=int(r["block_number"]),
                block_time=r["block_time"],
                token_address=str(r["token_address"]),
                token_decimals=int(r["token_decimals"]),
                fee_value_raw=int(r["fee_value_raw"]),
                from_address=str(r["from_address"]),
                to_address=str(r["to_address"]),
            )
            for r in rows
        ]

    async def revenue_summary(
        self,
        network_id: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        period: str = "month",
    ) -> SwapFeeRevenueSummary:
        rows = await self.fetch(network_id, since=since, until=until)
        return summarize_swap_fees(network_id, rows, period=period)
