# ruff: noqa: S101
"""072 — cross-chain swap history from the owner's own quote rows (no DB)."""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.crosschain.config import load_config
from sparkpoint_agent.portfolio.models import PortfolioOverview
from sparkpoint_agent.portfolio.swaps import (
    SwapHistorySource,
    linked_solana_addresses,
)
from sparkpoint_agent.portfolio.text import render_text

OWNER = "0x2222222222222222222222222222222222222222"
SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"


def _row(
    index: int = 1, *, destination: str = "sol:USDC", status: str = "PENDING"
) -> dict[str, Any]:
    return {
        "originKey": "base:USDC",
        "destinationKey": destination,
        "amountIn": "100",
        "depositAddress": f"0x{'ab' * 20}",
        "quoteResponse": {
            "quote": {"amountOutFormatted": "0.98"},
            "quoteRequest": {"recipient": SOL},
        },
        "lastStatus": status,
        "createdAt": f"2026-11-01T0{index}:00:00+00:00",
    }


class _Store:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self.rows = rows
        self.calls: list[tuple[str, int]] = []

    async def list_for_owner(self, owner_eoa: str, *, limit: int = 20) -> list[dict[str, Any]]:
        self.calls.append((owner_eoa, limit))
        return self.rows[:limit]


class _Status:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def status(self, *, deposit_address: str) -> dict[str, Any]:
        self.calls.append(deposit_address)
        return {"status": "SUCCESS"}


def _source(store: Any, **kwargs: Any) -> SwapHistorySource:
    return SwapHistorySource(store, load_config(env={}), **kwargs)


@pytest.mark.asyncio
async def test_history_maps_route_amounts_and_status() -> None:
    section = await _source(_Store([_row()])).collect(OWNER)
    assert section.status == "ok"
    assert section.source == "db"
    row = section.rows[0]
    assert row.chain == "base"
    assert row.amount == "100"
    assert row.extra["originLabel"] == "Base USDC"
    assert row.extra["destinationLabel"] == "Solana USDC"
    assert row.extra["route"] == "Base USDC -> Solana USDC"
    assert row.extra["amountOut"] == "0.98"
    assert row.extra["depositAddress"] == "0x" + "ab" * 20
    assert row.extra["lastStatus"] == "PENDING"


@pytest.mark.asyncio
async def test_empty_history_renders_the_empty_state_copy() -> None:
    section = await _source(_Store([])).collect(OWNER)
    assert section.status == "ok"
    assert section.rows == ()
    overview = PortfolioOverview(
        wallet=OWNER, focus="swaps", as_of="2026-11-01T00:00:00+00:00", sections=(section,)
    )
    text = render_text(overview, "swaps").lower()
    assert "don't have any cross-chain swaps yet" in text
    assert "nothing was signed or sent" in text


@pytest.mark.asyncio
async def test_no_database_is_an_honest_unavailable_section() -> None:
    section = await _source(None).collect(OWNER)
    assert section.status == "unavailable"
    assert "database is not configured" in (section.reason or "")


@pytest.mark.asyncio
async def test_status_refresh_is_bounded_to_three_non_terminal_rows() -> None:
    rows = [_row(index, status="PENDING") for index in range(1, 6)]
    client = _Status()
    section = await _source(
        _Store(rows), oneclick=client, refresh_status=True, max_refresh=3
    ).collect(OWNER)
    assert len(client.calls) == 3
    assert [row.extra["lastStatus"] for row in section.rows[:3]] == ["SUCCESS"] * 3
    assert [row.extra["lastStatus"] for row in section.rows[3:]] == ["PENDING", "PENDING"]


@pytest.mark.asyncio
async def test_terminal_rows_are_not_refreshed() -> None:
    client = _Status()
    section = await _source(
        _Store([_row(status="SUCCESS")]), oneclick=client, refresh_status=True
    ).collect(OWNER)
    assert client.calls == []
    assert section.rows[0].extra["lastStatus"] == "SUCCESS"


def test_linked_solana_addresses_only_uses_owner_rows_and_dedupes() -> None:
    rows = [
        _row(1),
        {**_row(2), "quoteResponse": {"quoteRequest": {"recipient": SOL}}},
        _row(3, destination="base:USDC"),
        {**_row(4), "quoteResponse": {"quoteRequest": {"recipient": "0x" + "12" * 20}}},
    ]
    assert linked_solana_addresses(rows) == (SOL,)
    assert linked_solana_addresses([]) == ()
