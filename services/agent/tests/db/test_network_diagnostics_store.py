# ruff: noqa: S101  (pytest asserts)
"""PgNetworkDiagnosticStore (migration 0020) — driven against a FAKE asyncpg executor (no live DB).

Asserts: record() returns an incrementing id and round-trips every column; list() honours the
LIMIT + address + mismatch-only filters; jsonb `raw` decodes from a str; `injected_names` maps to a
tuple; and a null address / null chain ids survive.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from typing import Any

from sparkpoint_agent.db.network_diagnostics import (
    DiagnosticCapture,
    PgNetworkDiagnosticStore,
)

_COLUMNS = (
    "reason", "address", "wagmi_chain_id", "wallet_chain_id", "chain_mismatch",
    "wagmi_status", "connector_id", "connector_name", "is_metamask",
    "injected_count", "injected_names", "user_agent", "build_id", "raw",
)
_BASE = datetime(2026, 1, 1, tzinfo=UTC)


class _FakeExec:
    """Honours the INSERT ... RETURNING id + the filtered SELECT the store issues."""

    def __init__(self) -> None:
        self.rows: list[dict[str, Any]] = []
        self._id = 0

    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any:
        if "INSERT INTO network_diagnostics" in query:
            self._id += 1
            when = _BASE + timedelta(seconds=self._id)
            row: dict[str, Any] = {"id": self._id, "created_at": when}
            row.update(dict(zip(_COLUMNS, args, strict=True)))
            self.rows.append(row)
            return self._id
        raise AssertionError(f"unexpected fetchval: {query!r}")

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        assert "FROM network_diagnostics" in query
        limit, address, mismatch_only = args
        out = sorted(self.rows, key=lambda r: r["created_at"], reverse=True)
        if address is not None:
            out = [r for r in out if r["address"] == address]
        if mismatch_only:
            out = [r for r in out if r["chain_mismatch"] is True]
        return out[:limit]


def _cap(**over: Any) -> DiagnosticCapture:
    base: dict[str, Any] = dict(
        reason="off-network", address="0xAbC0000000000000000000000000000000000001",
        wagmi_chain_id=None, wallet_chain_id=84532, chain_mismatch=True,
        wagmi_status="connected", connector_id="io.metamask", connector_name="MetaMask",
        is_metamask=True, injected_count=2, injected_names=("MetaMask", "Coinbase Wallet"),
        user_agent="ua", build_id="abc123", raw={"reason": "off-network", "walletChainId": 84532},
    )
    base.update(over)
    return DiagnosticCapture(**base)


async def test_record_returns_incrementing_ids_and_roundtrips() -> None:
    store = PgNetworkDiagnosticStore(_FakeExec())  # type: ignore[arg-type]
    assert await store.record(_cap()) == 1
    assert await store.record(_cap(reason="signin-attempt")) == 2

    rows = await store.list(limit=10)
    assert [r.id for r in rows] == [2, 1]  # newest first
    newest = rows[0]
    assert newest.reason == "signin-attempt"
    assert newest.address == "0xabc0000000000000000000000000000000000001"  # lowercased
    assert newest.injected_names == ("MetaMask", "Coinbase Wallet")  # text[] → tuple
    assert newest.raw == {"reason": "off-network", "walletChainId": 84532}  # jsonb str decoded
    assert newest.wagmi_chain_id is None and newest.wallet_chain_id == 84532


async def test_list_filters_by_address_and_mismatch() -> None:
    a1 = "0x1111111111111111111111111111111111111111"
    a2 = "0x2222222222222222222222222222222222222222"
    store = PgNetworkDiagnosticStore(_FakeExec())  # type: ignore[arg-type]
    await store.record(_cap(address=a1, chain_mismatch=True))
    await store.record(_cap(address=a2, chain_mismatch=False))

    only_one = await store.list(address=a1)
    assert len(only_one) == 1 and only_one[0].address.endswith("1111")  # type: ignore[union-attr]

    mism = await store.list(mismatch_only=True)
    assert len(mism) == 1 and mism[0].chain_mismatch is True


async def test_null_address_and_chain_ids_survive() -> None:
    store = PgNetworkDiagnosticStore(_FakeExec())  # type: ignore[arg-type]
    await store.record(
        _cap(address=None, wagmi_chain_id=None, wallet_chain_id=None, chain_mismatch=None,
             injected_names=(), raw=json.loads("{}"))
    )
    (row,) = await store.list()
    assert row.address is None and row.chain_mismatch is None
    assert row.injected_names == () and row.raw == {}
