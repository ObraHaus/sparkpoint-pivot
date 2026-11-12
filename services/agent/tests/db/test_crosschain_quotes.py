# ruff: noqa: S101
"""068 — live cross-chain quote persistence (migration 0044).

The regression this guards: 1Click returns ``deadline`` as an ISO-8601 STRING, while the column is
``TIMESTAMPTZ`` and asyncpg's timestamp codec only accepts ``datetime``. Passing the string made
every live confirm fail *after* 1Click had already issued a deposit address, so the API returned
"could not be recorded" and the user could never deposit. The fake DB below records the bound
arguments, so a string deadline is caught without a live Postgres.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest

from sparkpoint_agent.db.crosschain_quotes import CrossChainQuoteStore, _deadline_value

OWNER = "0xBddA0000000000000000000000000000000094f13"
DEPOSIT = "0x1111111111111111111111111111111111111111"


class _FakeDb:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return {"id": "quote-1", "created_at": datetime(2026, 10, 31, 12, 0, tzinfo=UTC)}


def test_iso_deadline_string_becomes_a_datetime_for_asyncpg() -> None:
    parsed = _deadline_value("2026-10-31T12:30:00.000Z")
    assert isinstance(parsed, datetime)
    assert parsed == datetime(2026, 10, 31, 12, 30, tzinfo=UTC)

    aware = datetime(2026, 10, 31, 12, 30, tzinfo=UTC)
    assert _deadline_value(aware) is aware
    assert _deadline_value(None) is None
    assert _deadline_value("") is None
    assert _deadline_value("not-a-date") is None


@pytest.mark.asyncio
async def test_record_binds_a_datetime_and_keeps_a_nullable_status() -> None:
    db = _FakeDb()
    store = CrossChainQuoteStore(db)  # type: ignore[arg-type]

    out = await store.record(
        owner_eoa=OWNER,
        origin_key="base:USDC",
        destination_key="near:wNEAR",
        amount_in="0.15",
        deposit_address=DEPOSIT,
        deadline="2026-10-31T12:30:00.000Z",
        quote_response={"signature": "ed25519:test", "quote": {"depositAddress": DEPOSIT}},
        last_status=None,
    )

    assert out["id"] == "quote-1"
    (sql, args) = db.calls[0]
    assert "INSERT INTO crosschain_quotes" in sql
    owner, origin, destination, amount, deposit, deadline, quote_response, last_status = args
    assert owner == OWNER.lower()
    assert (origin, destination, amount, deposit) == (
        "base:USDC",
        "near:wNEAR",
        "0.15",
        DEPOSIT,
    )
    assert isinstance(deadline, datetime)
    assert deadline == datetime(2026, 10, 31, 12, 30, tzinfo=UTC)
    assert isinstance(quote_response, str)
    assert "ed25519:test" in quote_response
    assert last_status is None
