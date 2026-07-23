# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""Feature 013 — the real admin revenue endpoint (api/admin_revenue.py).

Assert the honest-per-stream contract:
  - a NON-admin gets 404 (indistinguishable from a missing route — SC-010);
  - the shape is {swap, perf, premium, networkId}, each with its own `configured`;
  - one dead source degrades ONLY its own stream (SC-002 / D1);
  - a live-but-EMPTY swap stream is a REAL 0 with configured:true (distinct from configured:false);
  - values are base-unit STRINGS — no USD fabricated (D13);
  - the perf stream EXACTLY equals FeeIndexer.revenue_summary over the same rows (parity — SC-006);
  - membership sums verified payment rows; configured:false when the table is absent.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from datetime import UTC, datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.admin_revenue import get_perf_vault_address, get_revenue_database
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.data.fee_indexer import FeeIndexer, PgFeeEventStore

TOKEN = "test-web-tier-token"
ADMIN = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
STRANGER = "0x3333333333333333333333333333333333333333"
VAULT = "0x15d269b1d4fb3581e5a47482a70215e63ed547f2"
RECIP = "0xcb135893c84876aab9e10792b56e5bea91dc578f"
USDC = "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f"
WHEN = datetime(2026, 7, 1, tzinfo=UTC)


def _headers(owner: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": owner,
        "X-Owner": owner,
        "X-Chain-Id": "84532",
    }


def _swap_row(
    *, value: int, block: int = 90, log_index: int = 0, decimals: int = 6
) -> dict[str, Any]:
    return {
        "network_id": "base",
        "tx_hash": "0x" + f"{block:064x}",
        "log_index": log_index,
        "block_number": block,
        "block_time": WHEN,
        "token_address": USDC,
        "token_decimals": decimals,
        "fee_value_raw": value,
        "from_address": "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4",
        "to_address": RECIP,
    }


def _perf_row(
    *, fee_shares: int, yield_realized: int, block: int, log_index: int = 0
) -> dict[str, Any]:
    return {
        "network_id": "base",
        "vault_address": VAULT,
        "fee_recipient": RECIP,
        "trigger_kind": "harvest",
        "block_number": block,
        "block_time": WHEN,
        "as_of_block": block,
        "tx_hash": bytes(32),
        "log_index": log_index,
        "fee_rate_bps_at_event": 1000,
        "yield_realized_raw": yield_realized,
        "fee_shares_minted_raw": fee_shares,
        "hwm_before_ray": 10**18,
        "hwm_after_ray": 10**18,
    }


def _premium_row(*, total: int, n: int = 1) -> dict[str, Any]:
    return {"period_start": WHEN, "total": str(total), "n": n}


class _FakeAdmin:
    def __init__(self, admins: set[str]) -> None:
        self.admins = admins

    async def is_admin(self, address: str) -> bool:
        return address.lower() in self.admins


class _FakeDb:
    """Routes .fetch by the SQL's target table so each stream is driven independently."""

    def __init__(
        self,
        *,
        swap: list[dict[str, Any]] | None = None,
        perf: list[dict[str, Any]] | None = None,
        premium: list[dict[str, Any]] | None = None,
        fail: set[str] | None = None,
    ) -> None:
        self.swap = swap or []
        self.perf = perf or []
        self.premium = premium or []
        self.fail = fail or set()

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        if "FROM swap_fee_events" in query:
            if "swap" in self.fail:
                raise RuntimeError("swap ledger down")
            return self.swap
        if "FROM fee_events" in query:
            if "perf" in self.fail:
                raise RuntimeError("fee ledger down")
            return self.perf
        if "FROM payments" in query:
            if "premium" in self.fail:
                raise RuntimeError('relation "payments" does not exist')
            return self.premium
        return []


@pytest.fixture
def make_client(monkeypatch: pytest.MonkeyPatch) -> Iterator[Any]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)

    def _build(db: _FakeDb, *, vault: str | None = VAULT) -> TestClient:
        app.dependency_overrides[get_allowlist_store] = lambda: _FakeAdmin({ADMIN.lower()})
        app.dependency_overrides[get_revenue_database] = lambda: db
        app.dependency_overrides[get_perf_vault_address] = lambda: vault
        return TestClient(app)

    try:
        yield _build
    finally:
        for dep in (get_allowlist_store, get_revenue_database, get_perf_vault_address):
            app.dependency_overrides.pop(dep, None)


def test_non_admin_gets_404(make_client: Any) -> None:
    client = make_client(_FakeDb())
    assert client.get("/admin/revenue/summary", headers=_headers(STRANGER)).status_code == 404


def test_shape_and_base_unit_strings(make_client: Any) -> None:
    client = make_client(
        _FakeDb(
            swap=[_swap_row(value=40_000), _swap_row(value=60_000, block=91)],
            perf=[_perf_row(fee_shares=1_234, yield_realized=12_340, block=80)],
            premium=[_premium_row(total=500 * 10**18)],
        )
    )
    body = client.get("/admin/revenue/summary", headers=_headers(ADMIN)).json()
    assert set(body) == {"swap", "perf", "premium", "networkId"}
    assert body["networkId"] == "base"
    for key in ("swap", "perf", "premium"):
        s = body[key]
        assert set(s) == {"configured", "cumulativeRaw", "tokenDecimals", "periods", "disclosures"}
        assert isinstance(s["cumulativeRaw"], str)  # base-unit string, never a fabricated USD float
    assert body["swap"]["cumulativeRaw"] == "100000"  # 40k + 60k base units
    assert body["swap"]["tokenDecimals"] == 6
    assert body["premium"]["cumulativeRaw"] == str(500 * 10**18)
    assert body["premium"]["tokenDecimals"] == 18


def test_one_dead_source_degrades_only_itself(make_client: Any) -> None:
    client = make_client(
        _FakeDb(
            swap=[_swap_row(value=40_000)],
            perf=[_perf_row(fee_shares=10, yield_realized=100, block=80)],
            premium=[_premium_row(total=7)],
            fail={"swap"},
        )
    )
    body = client.get("/admin/revenue/summary", headers=_headers(ADMIN)).json()
    assert body["swap"]["configured"] is False
    assert body["perf"]["configured"] is True  # unaffected
    assert body["premium"]["configured"] is True  # unaffected


def test_live_but_empty_swap_is_a_real_zero(make_client: Any) -> None:
    client = make_client(_FakeDb(swap=[]))
    swap = client.get("/admin/revenue/summary", headers=_headers(ADMIN)).json()["swap"]
    assert swap["configured"] is True  # a REAL zero, not configured:false
    assert swap["cumulativeRaw"] == "0"
    assert swap["periods"] == []


def test_swap_discloses_native_eth_undercount_when_configured(make_client: Any) -> None:
    client = make_client(_FakeDb(swap=[_swap_row(value=1)]))
    swap = client.get("/admin/revenue/summary", headers=_headers(ADMIN)).json()["swap"]
    assert any(
        "Native-ETH" in d for d in swap["disclosures"]
    )  # SC-005 — logs-only never shown as complete


def test_perf_stream_matches_fee_indexer_exactly(make_client: Any) -> None:
    perf_rows = [
        _perf_row(fee_shares=1_000, yield_realized=10_000, block=80, log_index=0),
        _perf_row(fee_shares=2_500, yield_realized=25_000, block=81, log_index=0),
    ]
    db = _FakeDb(perf=perf_rows)
    client = make_client(db)
    perf = client.get("/admin/revenue/summary", headers=_headers(ADMIN)).json()["perf"]

    async def _expected() -> Any:
        return await FeeIndexer(PgFeeEventStore(db)).revenue_summary("base", VAULT, period="month")

    summary = asyncio.run(_expected())
    assert perf["configured"] is True
    assert perf["cumulativeRaw"] == str(
        summary.cumulative_fee_shares_minted_raw
    )  # no divergent re-derivation
    assert [int(p["valueRaw"]) for p in perf["periods"]] == [
        b.fee_shares_minted_raw for b in summary.periods
    ]


def test_perf_unconfigured_when_no_vault(make_client: Any) -> None:
    client = make_client(
        _FakeDb(perf=[_perf_row(fee_shares=1, yield_realized=1, block=1)]), vault=None
    )
    perf = client.get("/admin/revenue/summary", headers=_headers(ADMIN)).json()["perf"]
    assert perf["configured"] is False  # honest-degrade, never a zero-as-real


def test_membership_absent_table_degrades_only_premium(make_client: Any) -> None:
    client = make_client(_FakeDb(swap=[_swap_row(value=5)], premium=[], fail={"premium"}))
    body = client.get("/admin/revenue/summary", headers=_headers(ADMIN)).json()
    assert body["premium"]["configured"] is False  # 012 not landed → configured:false (D9)
    assert body["swap"]["configured"] is True  # unaffected
