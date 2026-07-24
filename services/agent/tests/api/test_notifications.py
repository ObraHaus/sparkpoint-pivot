# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§3.11 in-app notifications endpoints (api/notifications.py, feature 021).

The vault reader, the flow reader, the executions store and the read cursor are all MOCKED — no live
chain / RPC / DB. These prove the crux: every notification is DERIVED from a real source row (a vault
flow, an execution, a replayed outcome) — never fabricated — and the feed degrades fail-open (a stale
vault read or a store outage yields a partial/empty feed, never a 500). Unread is computed against the
per-user read cursor; POST /notifications/read advances it.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.notifications import (
    get_agent_config,
    get_execution_store,
    get_notif_event_store,
    get_notif_read_store,
    get_vault_flow_reader,
)
from sparkpoint_agent.api.vault import get_vault_reader
from sparkpoint_agent.chain import VaultUnavailable
from sparkpoint_agent.chain.vault_reader import VaultUnavailableReason
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.db.executions import ExecutionRow
from sparkpoint_agent.db.notification_events import NotificationEventRow
from sparkpoint_agent.db.notification_reads import ReadCursor
from sparkpoint_agent.db.vault_flows import FlowRow

_1M = 1_000_000  # 1 USDC / 1 share in 6-dp base units

TOKEN = "test-web-tier-token"
VAULT = "0x3333333333333333333333333333333333333333"
USER = "0x1111111111111111111111111111111111111111"
GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": USER,
    "X-Owner": USER,
    "X-Chain-Id": "8453",
}


# ── fakes ────────────────────────────────────────────────────────────────────────


class FakeReader:
    """Serves the vault position reads (share balance + head block). `unavailable` → stale degrade."""

    def __init__(self, *, shares: int = 0, block: int = 1000, unavailable: bool = False) -> None:
        self._shares = shares
        self._block = block
        self._unavailable = unavailable

    async def balance_of(self, owner: str) -> int:
        if self._unavailable:
            raise VaultUnavailable(VaultUnavailableReason.RPC_UNREACHABLE, "vault down")
        return self._shares

    async def block_number(self) -> int:
        if self._unavailable:
            raise VaultUnavailable(VaultUnavailableReason.RPC_UNREACHABLE, "vault down")
        return self._block


class FakeFlowReader:
    def __init__(self, flows: list[FlowRow]) -> None:
        self._flows = flows

    async def list_flows(self, network: str, vault: str, owner: str, limit: int) -> list[FlowRow]:
        return list(self._flows)


class FakeExecStore:
    def __init__(self, rows: list[ExecutionRow]) -> None:
        self._rows = rows

    async def list_by_account(self, addr: str, *, limit: int = 50) -> list[ExecutionRow]:
        return list(self._rows)


class FakeEventStore:
    """Serves the phase-2 edge-triggered events (caps/rate/new-rec) the poller would have emitted."""

    def __init__(self, rows: list[NotificationEventRow] | None = None) -> None:
        self._rows = rows or []

    async def list_for(self, wallet: str, *, limit: int = 50) -> list[NotificationEventRow]:
        return list(self._rows)


class RaisingEventStore(FakeEventStore):
    async def list_for(self, wallet: str, *, limit: int = 50) -> list[NotificationEventRow]:
        raise RuntimeError("events store down")


class FakeReadStore:
    def __init__(self, cursor: ReadCursor | None = None) -> None:
        self.cursor = cursor
        self.marked: list[tuple[datetime, int]] = []

    async def get(self, wallet: str) -> ReadCursor | None:
        return self.cursor

    async def mark_read(self, wallet: str, at: datetime, block: int) -> None:
        prev = self.cursor.last_read_block if self.cursor else 0
        self.cursor = ReadCursor(last_read_at=at, last_read_block=max(prev, block))
        self.marked.append((at, block))


class RaisingReadStore(FakeReadStore):
    async def get(self, wallet: str) -> ReadCursor | None:
        raise RuntimeError("read cursor down")

    async def mark_read(self, wallet: str, at: datetime, block: int) -> None:
        raise RuntimeError("read cursor down")


def _exec(status: str, *, action: str = "deposit", reason: str | None = None) -> ExecutionRow:
    now = datetime(2026, 7, 24, 12, 0, tzinfo=UTC)
    return ExecutionRow(
        id=uuid4(), intent_bundle_id=uuid4(), smart_account_address=USER, action_kind=action,
        signing_mode="per_action_user_signature", status=status, userop_hash=None,
        tx_hash="0xdead", block_number=999, gas_used=None, realized_amounts=None,
        reverted_reason=reason, attribution_method=None, created_at=now, updated_at=now,
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _wire(
    *,
    reader: FakeReader | None = None,
    flows: list[FlowRow] | None = None,
    execs: list[ExecutionRow] | None = None,
    read_store: FakeReadStore | None = None,
    event_store: FakeEventStore | None = None,
    events: list[NotificationEventRow] | None = None,
    vault_address: str | None = VAULT,
) -> FakeReadStore:
    store = read_store if read_store is not None else FakeReadStore()
    app.dependency_overrides[get_vault_reader] = lambda: reader or FakeReader()
    app.dependency_overrides[get_vault_flow_reader] = lambda: FakeFlowReader(flows or [])
    app.dependency_overrides[get_execution_store] = lambda: FakeExecStore(execs or [])
    app.dependency_overrides[get_notif_read_store] = lambda: store
    app.dependency_overrides[get_notif_event_store] = lambda: event_store or FakeEventStore(events)
    app.dependency_overrides[get_agent_config] = lambda: AgentConfig(
        chain_id=8453, rpc_url=None, vault_address=vault_address, database_url=None
    )
    return store


# ── GET /notifications ────────────────────────────────────────────────────────────


def test_deposit_and_withdrawal_flows_become_real_notifications(client: TestClient) -> None:
    # A deposit (100 USDC) then a full withdraw (105 USDC) → the shares net to 0 (reconciles).
    flows = [
        FlowRow(kind="deposit", assets=100 * _1M, shares=100 * _1M, block_number=900, log_index=0, tx_hash="0xaaa"),
        FlowRow(kind="withdraw", assets=105 * _1M, shares=100 * _1M, block_number=950, log_index=0, tx_hash="0xbbb"),
    ]
    _wire(reader=FakeReader(shares=0, block=1000), flows=flows)
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    types = [n["type"] for n in body["notifications"]]
    assert "deposit_confirmed" in types
    assert "withdrawal_confirmed" in types
    # The reconciled withdrawal also yields a realized-outcome notification (a WIN: +5 USDC).
    outcome = next(n for n in body["notifications"] if n["type"] == "outcome_closed")
    assert outcome["category"] == "outcomeUpdates"
    assert "+5.00" in outcome["body"]
    assert outcome["txHash"] == "0xbbb"
    dep = next(n for n in body["notifications"] if n["type"] == "deposit_confirmed")
    assert dep["category"] == "txResults"
    assert dep["txHash"] == "0xaaa"
    assert "100.00 USDC" in dep["body"]


def test_reverted_execution_becomes_an_alert(client: TestClient) -> None:
    _wire(execs=[_exec("reverted", action="deposit", reason="ERC20: transfer amount exceeds balance")])
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    rev = next(n for n in body["notifications"] if n["type"] == "tx_reverted")
    assert rev["category"] == "txResults"
    assert rev["title"] == "Deposit reverted"
    assert "exceeds balance" in rev["body"]
    assert rev["icon"] == "alert"


def test_confirmed_executions_are_not_double_counted(client: TestClient) -> None:
    # Only reverted/dropped executions surface (confirmed deposits come from the flow index instead).
    _wire(execs=[_exec("confirmed"), _exec("indexed"), _exec("submitted")])
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    assert body["notifications"] == []


def test_outcomes_only_when_history_reconciles(client: TestClient) -> None:
    # A lone withdraw with no funding deposit → the share history can't reconcile → NO outcome row
    # (honest: never a partial-history guess). The withdrawal-confirmed tx row still shows.
    flows = [FlowRow(kind="withdraw", assets=50 * _1M, shares=50 * _1M, block_number=950, log_index=0, tx_hash="0xccc")]
    _wire(reader=FakeReader(shares=999, block=1000), flows=flows)  # shares != reconstructed → no reconcile
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    types = [n["type"] for n in body["notifications"]]
    assert "withdrawal_confirmed" in types
    assert "outcome_closed" not in types


def test_unread_computed_against_the_read_cursor(client: TestClient) -> None:
    flows = [FlowRow(kind="deposit", assets=10 * _1M, shares=10 * _1M, block_number=990, log_index=0, tx_hash="0xd")]
    # No cursor → everything is unread.
    _wire(reader=FakeReader(shares=10 * _1M, block=1000), flows=flows)
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    assert body["unreadCount"] == len(body["notifications"]) == 1
    assert body["notifications"][0]["unread"] is True
    # A cursor whose block height is at/above the deposit's block → the deposit is already read.
    past = datetime.now(UTC) - timedelta(hours=1)
    cursor = ReadCursor(last_read_at=past, last_read_block=990)
    _wire(reader=FakeReader(shares=10 * _1M, block=1000), flows=flows, read_store=FakeReadStore(cursor=cursor))
    body2 = client.get("/notifications", headers=GOOD_HEADERS).json()
    assert body2["unreadCount"] == 0
    assert body2["notifications"][0]["unread"] is False


def test_head_block_item_stays_read_after_mark_read(client: TestClient) -> None:
    """The stability fix: a notification mined in the CURRENT head block, once marked read, does NOT
    re-flag as unread on an immediate re-read (unread is keyed by block height, not a volatile clock)."""
    flows = [FlowRow(kind="deposit", assets=_1M, shares=_1M, block_number=1000, log_index=0, tx_hash="0xh")]
    store = _wire(reader=FakeReader(shares=_1M, block=1000), flows=flows)  # deposit block == head
    b1 = client.get("/notifications", headers=GOOD_HEADERS).json()
    assert b1["notifications"][0]["unread"] is True  # unseen
    assert client.post("/notifications/read", headers=GOOD_HEADERS).json()["ok"] is True
    assert store.cursor is not None and store.cursor.last_read_block == 1000  # head block recorded
    b2 = client.get("/notifications", headers=GOOD_HEADERS).json()
    assert b2["notifications"][0]["unread"] is False  # stays read — block 1000 <= last_read_block 1000
    assert b2["unreadCount"] == 0


def test_stale_vault_read_still_serves_execution_alerts_fail_open(client: TestClient) -> None:
    # The vault read degrades (no flows/outcomes), but the executions-based alert still shows — the
    # feed never 500s and stale is surfaced honestly.
    _wire(reader=FakeReader(unavailable=True), flows=[FlowRow(kind="deposit", assets=_1M, shares=_1M, block_number=1, log_index=0, tx_hash="0xe")], execs=[_exec("reverted")])
    resp = client.get("/notifications", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is True
    types = [n["type"] for n in body["notifications"]]
    assert types == ["tx_reverted"]  # no flow/outcome rows when the vault read is stale


def test_read_cursor_outage_fails_open_to_all_unread(client: TestClient) -> None:
    flows = [FlowRow(kind="deposit", assets=_1M, shares=_1M, block_number=990, log_index=0, tx_hash="0xf")]
    _wire(reader=FakeReader(shares=_1M, block=1000), flows=flows, read_store=RaisingReadStore())
    resp = client.get("/notifications", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["notifications"][0]["unread"] is True  # cursor outage ⇒ treat as unread, never 500


def test_notifications_require_auth(client: TestClient) -> None:
    _wire()
    resp = client.get("/notifications")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


# ── phase-2 edge-triggered events (caps / rate / new-rec) ───────────────────────────


def _event(
    *,
    event_type: str = "vault_near_capacity",
    category: str = "capsNearLimit",
    title: str = "Vault nearing capacity",
    body: str = "The vault is 92% full — new deposits may be capped soon.",
    icon: str = "alert",
    href: str | None = "/vault",
    wallet: str | None = None,
    created_at: datetime | None = None,
) -> NotificationEventRow:
    return NotificationEventRow(
        id=str(uuid4()), wallet=wallet, category=category, type=event_type, title=title,
        body=body, icon=icon, href=href,
        created_at=created_at or datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
    )


def test_edge_triggered_event_appears_in_feed(client: TestClient) -> None:
    # A poller-emitted event surfaces in the merged feed, carrying its real fields, id prefixed evt:.
    _wire(events=[_event()])
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    ev = next(n for n in body["notifications"] if n["type"] == "vault_near_capacity")
    assert ev["category"] == "capsNearLimit"
    assert ev["id"].startswith("evt:")
    assert ev["href"] == "/vault"
    assert ev["txHash"] is None
    assert ev["unread"] is True  # no cursor ⇒ unread


def test_events_store_outage_fails_open(client: TestClient) -> None:
    # An events-store outage degrades to the rest of the feed — never a 500.
    _wire(execs=[_exec("reverted")], event_store=RaisingEventStore())
    resp = client.get("/notifications", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    types = [n["type"] for n in resp.json()["notifications"]]
    assert types == ["tx_reverted"]  # the reverted alert still shows; the events just drop


def test_event_unread_keyed_by_read_cursor(client: TestClient) -> None:
    # Events carry no block, so unread keys off created_at vs the cursor's last_read_at.
    old = datetime(2026, 7, 24, 10, 0, tzinfo=UTC)
    new = datetime(2026, 7, 24, 14, 0, tzinfo=UTC)
    cursor = ReadCursor(last_read_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC), last_read_block=0)
    _wire(
        events=[
            _event(created_at=new),
            _event(event_type="rate_moved", category="rateChanges", created_at=old, href="/strategies"),
        ],
        read_store=FakeReadStore(cursor=cursor),
    )
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    by_type = {n["type"]: n for n in body["notifications"]}
    assert by_type["vault_near_capacity"]["unread"] is True  # after the cursor
    assert by_type["rate_moved"]["unread"] is False  # before the cursor
    assert body["unreadCount"] == 1


def test_events_survive_truncation_amid_a_flood_of_flows(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A heavy user with many newer vault flows must not bury an older unread poller event out of the
    # capped window (which would also under-count the badge). Events are reserved before truncation.
    monkeypatch.setattr("sparkpoint_agent.api.notifications._FEED_LIMIT", 3)
    flows = [
        FlowRow(kind="deposit", assets=_1M, shares=_1M, block_number=900 + i, log_index=0, tx_hash=f"0xf{i}")
        for i in range(5)
    ]
    old_event = _event(created_at=datetime(2020, 1, 1, tzinfo=UTC))  # far older than every flow
    _wire(reader=FakeReader(shares=5 * _1M, block=1000), flows=flows, events=[old_event])
    body = client.get("/notifications", headers=GOOD_HEADERS).json()
    types = [n["type"] for n in body["notifications"]]
    assert "vault_near_capacity" in types  # the old event survived despite 5 newer flows
    assert len(body["notifications"]) == 3  # still capped at _FEED_LIMIT


# ── POST /notifications/read ────────────────────────────────────────────────────────


def test_mark_read_advances_the_cursor(client: TestClient) -> None:
    store = _wire(reader=FakeReader(block=1234))
    resp = client.post("/notifications/read", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["readAt"] is not None
    assert len(store.marked) == 1  # the cursor was advanced
    assert store.marked[0][1] == 1234  # ...to the current head block


def test_mark_read_fails_open_on_store_outage(client: TestClient) -> None:
    _wire(read_store=RaisingReadStore())
    resp = client.post("/notifications/read", headers=GOOD_HEADERS)
    assert resp.status_code == 200  # advisory: never a hard error
    assert resp.json()["ok"] is False
