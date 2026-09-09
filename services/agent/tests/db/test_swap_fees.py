# ruff: noqa: S101  (pytest asserts)
"""Feature 013 — the swap-fee ledger store + aggregate (db/swap_fees.py).

Assert the invariants tests must keep honest:
  - idempotent ``record`` on (network_id, tx_hash, log_index) — a second insert is a no-op;
  - ``revenue_summary`` sums ONLY stored rows in BASE UNITS (no USD fabricated);
  - a network with NO rows yields a REAL cumulative 0 (distinct from configured:false);
  - per-period buckets truncate block_time the same way FeeIndexer does (month).
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from sparkpoint_agent.db.swap_fees import (
    PgSwapFeeEventStore,
    SwapFeeEvent,
    summarize_swap_fees,
)

ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4"
RECIP = "0xcb135893c84876aab9e10792b56e5bea91dc578f"
USDC = "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f"


def _ev(
    *, tx: str, log_index: int = 0, block: int = 100, value: int, when: datetime, decimals: int = 6
) -> SwapFeeEvent:
    return SwapFeeEvent(
        network_id="base",
        tx_hash=tx,
        log_index=log_index,
        block_number=block,
        block_time=when,
        token_address=USDC,
        token_decimals=decimals,
        fee_value_raw=value,
        from_address=ROUTER,
        to_address=RECIP,
    )


class _FakeExec:
    """In-memory executor that honours the (network_id, tx_hash, log_index) idempotency key."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, str, int], dict[str, Any]] = {}
        self.cursor: int | None = None

    async def execute(self, query: str, *args: Any) -> str:
        if "INSERT INTO swap_fee_events" in query:
            key = (args[0], args[1], args[2])
            if key in self.rows:
                return "INSERT 0 0"
            self.rows[key] = {
                "network_id": args[0],
                "tx_hash": args[1],
                "log_index": args[2],
                "block_number": args[3],
                "block_time": args[4],
                "token_address": args[5],
                "token_decimals": args[6],
                "fee_value_raw": args[7],
                "from_address": args[8],
                "to_address": args[9],
            }
            return "INSERT 0 1"
        if "INSERT INTO indexer_cursors" in query:
            self.cursor = args[2]
            return "INSERT 0 1"
        return "INSERT 0 1"

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        net = args[0]
        return [r for r in self.rows.values() if r["network_id"] == net]

    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any:
        return self.cursor


@pytest.mark.asyncio
async def test_record_is_idempotent_on_idem_key() -> None:
    store = PgSwapFeeEventStore(_FakeExec())
    ev = _ev(tx="0x" + "a" * 64, value=50_000, when=datetime(2026, 7, 20, tzinfo=UTC))
    assert await store.record(ev) is True
    assert await store.record(ev) is False  # same (network, tx, log_index) → no duplicate
    rows = await store.fetch("base")
    assert len(rows) == 1 and rows[0].fee_value_raw == 50_000


@pytest.mark.asyncio
async def test_revenue_summary_sums_base_units_and_buckets_by_month() -> None:
    store = PgSwapFeeEventStore(_FakeExec())
    await store.record(
        _ev(tx="0x" + "1" * 64, log_index=0, value=40_000, when=datetime(2026, 6, 10, tzinfo=UTC))
    )
    await store.record(
        _ev(tx="0x" + "2" * 64, log_index=1, value=60_000, when=datetime(2026, 6, 25, tzinfo=UTC))
    )
    await store.record(
        _ev(tx="0x" + "3" * 64, log_index=2, value=100_000, when=datetime(2026, 7, 2, tzinfo=UTC))
    )
    s = await store.revenue_summary("base", period="month")
    assert s.cumulative_fee_raw == 200_000  # base units, no USD conversion
    assert s.event_count == 3
    assert s.token_decimals == 6
    assert len(s.periods) == 2  # June + July
    june, july = s.periods
    assert june.period_start == datetime(2026, 6, 1, tzinfo=UTC) and june.fee_value_raw == 100_000
    assert july.period_start == datetime(2026, 7, 1, tzinfo=UTC) and july.fee_value_raw == 100_000


@pytest.mark.asyncio
async def test_empty_network_is_a_real_zero_not_absent() -> None:
    store = PgSwapFeeEventStore(_FakeExec())
    s = await store.revenue_summary("base")
    assert (
        s.cumulative_fee_raw == 0
    )  # a REAL zero — the endpoint decides configured from availability
    assert s.event_count == 0
    assert s.token_decimals is None
    assert s.periods == ()


def test_summarize_flags_mixed_token_decimals() -> None:
    when = datetime(2026, 7, 1, tzinfo=UTC)
    rows = [
        _ev(tx="0x" + "a" * 64, log_index=0, value=1, when=when, decimals=6),
        _ev(tx="0x" + "b" * 64, log_index=1, value=2, when=when, decimals=18),
    ]
    s = summarize_swap_fees("base", rows)
    assert s.distinct_token_decimals == 2  # caller discloses the mixed-denomination sum
