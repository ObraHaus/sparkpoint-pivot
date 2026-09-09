# ruff: noqa: S101, S105
"""§020/US5 per-advice attribution — GET /outcomes rec rows + GET /outcomes/{recId} detail.

All DB-free: a fake vault reader + fake flow reader + fake RecommendationStore. The crux (Principle
III / SC-010): an acted-on rec's outcome is the deposit it caused, marked to market via FIFO lots,
linked by ``intent_log`` — reconstructable from chain, honest-degrading (DATA_STALE) when the
history can't be reconciled, never fabricated. Withdrawals stay ungated (N2 — this surface reads).
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.portfolio import get_rec_store, get_vault_flow_reader
from sparkpoint_agent.api.recommendations import get_agent_config
from sparkpoint_agent.api.vault import get_vault_reader
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.db.recommendations import ActedRec, RecRow
from sparkpoint_agent.db.vault_flows import FlowRow

TOKEN = "test-web-tier-token"
USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
USER = "0x1111111111111111111111111111111111111111"
OTHER = "0x9999999999999999999999999999999999999999"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": USER,
    "X-Owner": USER,
    "X-Chain-Id": "8453",
}
_WAD = 10**18
_RID = UUID("11111111-1111-1111-1111-111111111111")
_NOW = datetime(2026, 7, 24, tzinfo=UTC)


def _dep(tx: str, assets: int, shares: int, block: int, log: int = 0) -> FlowRow:
    return FlowRow(
        kind="deposit", assets=assets, shares=shares, block_number=block, log_index=log, tx_hash=tx
    )


def _wd(assets: int, shares: int, block: int, log: int = 0) -> FlowRow:
    return FlowRow(
        kind="withdraw",
        assets=assets,
        shares=shares,
        block_number=block,
        log_index=log,
        tx_hash="0xw",
    )


class _Reader:
    """Structural VaultReader — convertToAssets mirrors the chain (shares * pps / 1e18)."""

    def __init__(self, *, balance: int, pps: int = _WAD, block: int = 100) -> None:
        self._balance = balance
        self._pps = pps
        self._block = block

    async def balance_of(self, owner: str) -> int:
        return self._balance

    async def convert_to_assets(self, shares: int) -> int:
        return shares * self._pps // _WAD

    async def asset(self) -> str:
        return USDC

    async def token_balance_of(self, token: str, owner: str) -> int:
        return 0

    async def native_balance(self, owner: str) -> int:
        return 0

    async def block_number(self) -> int:
        return self._block


class _FlowReader:
    def __init__(self, flows: list[FlowRow]) -> None:
        self._flows = flows

    async def list_flows(
        self, network_id: str, vault: str, owner: str, limit: int = 50
    ) -> list[FlowRow]:
        return self._flows[:limit]


class _RecStore:
    def __init__(
        self,
        *,
        acted: list[ActedRec] | None = None,
        recs: dict[UUID, RecRow] | None = None,
        deposit_tx: dict[UUID, str] | None = None,
    ) -> None:
        self._acted = acted or []
        self._recs = recs or {}
        self._deposit_tx = deposit_tx or {}

    async def list_acted(self, wallet: str, *, limit: int = 100) -> list[ActedRec]:
        return self._acted

    async def get(self, rec_id: UUID) -> RecRow | None:
        return self._recs.get(rec_id)

    async def deposit_tx_for(self, rec_id: UUID) -> str | None:
        return self._deposit_tx.get(rec_id)


def _rec_row(wallet: str = USER, status: str = "acted") -> RecRow:
    return RecRow(
        id=_RID,
        wallet=wallet,
        dedupe_key="k",
        strategy_kind="vault_deposit",
        title="Deposit into the Aave vault",
        rationale="Earn yield on idle USDC.",
        proposed_action={"type": "vault_deposit", "amount": "100"},
        rank=1,
        mandate_version="m1",
        policy_version="v1",
        status=status,
        created_at=_NOW,
        updated_at=_NOW,
    )


def _acted(deposit_tx: str) -> ActedRec:
    return ActedRec(
        rec_id=_RID,
        title="Deposit into the Aave vault",
        strategy_kind="vault_deposit",
        proposed_action={"type": "vault_deposit", "amount": "100"},
        rationale="Earn yield on idle USDC.",
        deposit_tx=deposit_tx,
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _wire(reader: object, flows: list[FlowRow], rec_store: object) -> None:
    app.dependency_overrides[get_vault_reader] = lambda: reader
    app.dependency_overrides[get_vault_flow_reader] = lambda: _FlowReader(flows)
    app.dependency_overrides[get_rec_store] = lambda: rec_store
    app.dependency_overrides[get_agent_config] = lambda: AgentConfig(
        chain_id=84532, rpc_url=None, vault_address=VAULT, database_url=None
    )


# ── GET /outcomes — the acted-on recommendation rows ─────────────────────────────────


def test_outcomes_lists_acted_recommendation_as_open_gain_row(client: TestClient) -> None:
    # One deposit (100 USDC) acted on a rec; position now worth 120 → an OPEN row, +20 unrealized.
    flows = [_dep("0xdeposit1", 100_000_000, 100_000_000, 10)]
    reader = _Reader(balance=100_000_000, pps=12 * _WAD // 10)  # pps 1.2 → 120 underlying
    _wire(reader, flows, _RecStore(acted=[_acted("0xdeposit1")]))
    body = client.get("/outcomes", headers=HEADERS).json()
    assert body["reconciles"] is True
    rows = body["recommendations"]
    assert len(rows) == 1
    row = rows[0]
    assert row["recId"] == str(_RID)
    assert row["actedTxHash"] == "0xdeposit1"
    assert row["attributionMethod"] == "intent_log"
    assert row["entryUsd"] == "100.00"
    assert row["label"] == "open"
    assert row["shared"] is False
    assert row["reconstructable"] is True


def test_outcomes_flags_shared_when_position_is_blended(client: TestClient) -> None:
    # Two deposits → a blended position; each acted rec's row is honestly labeled shared.
    flows = [
        _dep("0xdeposit1", 100_000_000, 100_000_000, 10),
        _dep("0xdeposit2", 100_000_000, 100_000_000, 12),
    ]
    reader = _Reader(balance=200_000_000, pps=_WAD)
    store = _RecStore(acted=[_acted("0xdeposit1")])
    _wire(reader, flows, store)
    rows = client.get("/outcomes", headers=HEADERS).json()["recommendations"]
    assert len(rows) == 1
    assert rows[0]["shared"] is True


def test_outcomes_skips_recs_whose_deposit_is_not_indexed(client: TestClient) -> None:
    # The rec's linked deposit isn't in the flow index yet → no fabricated row (honest omission).
    flows = [_dep("0xdeposit1", 100_000_000, 100_000_000, 10)]
    reader = _Reader(balance=100_000_000, pps=_WAD)
    _wire(reader, flows, _RecStore(acted=[_acted("0xNOTINDEXED")]))
    assert client.get("/outcomes", headers=HEADERS).json()["recommendations"] == []


# ── GET /outcomes/{recId} — one recommendation's detail ──────────────────────────────


def test_outcome_detail_returns_win_with_realized_apy(client: TestClient) -> None:
    # Deposit 100, fully withdraw for 120 → a realized WIN with a positive annualized APY.
    flows = [_dep("0xdeposit1", 100_000_000, 100_000_000, 10), _wd(120_000_000, 100_000_000, 25)]
    reader = _Reader(balance=0, pps=_WAD)
    store = _RecStore(recs={_RID: _rec_row()}, deposit_tx={_RID: "0xdeposit1"})
    _wire(reader, flows, store)
    resp = client.get(f"/outcomes/{_RID}", headers=HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["recId"] == str(_RID)
    assert body["status"] == "executed"
    assert body["actedTxHash"] == "0xdeposit1"
    assert body["entryUsd"] == "100.00"
    assert body["label"] == "win"
    assert body["attributionMethod"] == "intent_log"
    assert body["rationale"] == "Earn yield on idle USDC."
    assert body["realizedApyBps"] is not None and body["realizedApyBps"] > 0


def test_outcome_detail_open_lot_has_null_apy(client: TestClient) -> None:
    flows = [_dep("0xdeposit1", 100_000_000, 100_000_000, 10)]
    reader = _Reader(balance=100_000_000, pps=_WAD)
    store = _RecStore(recs={_RID: _rec_row()}, deposit_tx={_RID: "0xdeposit1"})
    _wire(reader, flows, store)
    body = client.get(f"/outcomes/{_RID}", headers=HEADERS).json()
    assert body["label"] == "open"
    assert body["realizedApyBps"] is None  # null while open (contract §020)


def test_outcome_detail_unknown_recid_is_not_found(client: TestClient) -> None:
    _wire(_Reader(balance=0), [], _RecStore())
    assert client.get("/outcomes/not-a-uuid", headers=HEADERS).status_code == 404


def test_outcome_detail_other_wallets_rec_is_not_found(client: TestClient) -> None:
    store = _RecStore(recs={_RID: _rec_row(wallet=OTHER)}, deposit_tx={_RID: "0xdeposit1"})
    _wire(_Reader(balance=0), [], store)
    assert client.get(f"/outcomes/{_RID}", headers=HEADERS).status_code == 404


def test_outcome_detail_unacted_rec_is_not_found(client: TestClient) -> None:
    # The rec exists but was never acted on (no linked execution) → NOT_FOUND, not a zeroed row.
    store = _RecStore(recs={_RID: _rec_row()}, deposit_tx={})
    _wire(_Reader(balance=0), [], store)
    assert client.get(f"/outcomes/{_RID}", headers=HEADERS).status_code == 404


def test_outcome_detail_unreconciled_history_is_data_stale(client: TestClient) -> None:
    # Reconstructed shares != on-chain balance → honest DATA_STALE, never a guessed figure.
    flows = [_dep("0xdeposit1", 100_000_000, 100_000_000, 10)]
    reader = _Reader(balance=999_000_000, pps=_WAD)  # balance mismatch → does not reconcile
    store = _RecStore(recs={_RID: _rec_row()}, deposit_tx={_RID: "0xdeposit1"})
    _wire(reader, flows, store)
    assert client.get(f"/outcomes/{_RID}", headers=HEADERS).status_code == 409


def test_outcome_detail_deposit_not_indexed_is_data_stale(client: TestClient) -> None:
    # History reconciles but the rec's deposit tx isn't among the lots yet → DATA_STALE (retry).
    flows = [_dep("0xother", 100_000_000, 100_000_000, 10)]
    reader = _Reader(balance=100_000_000, pps=_WAD)
    store = _RecStore(recs={_RID: _rec_row()}, deposit_tx={_RID: "0xmissing"})
    _wire(reader, flows, store)
    assert client.get(f"/outcomes/{_RID}", headers=HEADERS).status_code == 409
