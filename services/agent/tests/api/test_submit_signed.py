# ruff: noqa: S101, S105, ANN001, ARG001, ARG002
"""§3.6 POST /submit-signed-tx + GET /submit-signed-tx/{id} tests (feature 019 US4/US5).

The service NEVER signs — it VERIFIES a user-signed payload against on-chain truth before recording
the *event* of having signed (VR-X1/SC-004): a retrievable, byte-matching tx → one execution row; a
tampered tx or missing txHash → VALIDATION_ERROR + NO row; a txHash we cannot retrieve on-chain →
retryable DATA_STALE + NO row (no phantom execution); an RPC outage while verifying →
UPSTREAM_UNAVAILABLE; a replay → a single row (de-dup). Status resolves the receipt (pending →
confirmed/failed).
"""

from __future__ import annotations

from collections.abc import Iterator
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.execution import get_bundle_store, get_exec_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.vault import get_sim_config
from sparkpoint_agent.execution import orchestrate, rpc

TOKEN = "test-web-tier-token"
VAULT = "0x00000000000000000000000000000000000000aa"
USER = "0x1111111111111111111111111111111111111111"
STEP_DATA = "0x6e553f6500000000000000000000000000000000000000000000000000000000000f4240"
TX = "0xabc0000000000000000000000000000000000000000000000000000000000001"
INTENT = UUID("11111111-2222-3333-4444-555555555555")
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": USER,
    "X-Owner": USER,
    "X-Chain-Id": "8453",
}


class FakeBundleRow:
    def __init__(self) -> None:
        self.id = INTENT
        self.chain_id = 8453
        self.kind = "vault_deposit"
        self.steps = [{"to": VAULT, "data": STEP_DATA, "value": "0", "opType": "eoa_call"}]
        self.smart_account_address = USER


class FakeBundleStore:
    def __init__(self, row: FakeBundleRow | None) -> None:
        self._row = row

    async def get(self, bundle_id: UUID) -> FakeBundleRow | None:
        return self._row if (self._row is not None and self._row.id == bundle_id) else None


class FakeExecRow:
    def __init__(self, tx_hash: str | None, status: str) -> None:
        self.tx_hash = tx_hash
        self.status = status


class FakeExecStore:
    def __init__(self) -> None:
        self.rows: dict[UUID, dict[str, object]] = {}
        self.inserts = 0

    async def insert_submitted(
        self,
        *,
        intent_bundle_id: UUID,
        smart_account_address: str,
        action_kind: str,
        signing_mode: str = "per_action_user_signature",
        tx_hash: str | None = None,
        userop_hash: str | None = None,
    ) -> UUID | None:
        if intent_bundle_id in self.rows:
            return None  # de-dup
        self.inserts += 1
        self.rows[intent_bundle_id] = {"tx_hash": tx_hash, "status": "submitted"}
        return uuid4()

    async def update_status(self, *, intent_bundle_id: UUID, status: str, **kw: object) -> None:
        self.rows.setdefault(intent_bundle_id, {})["status"] = status

    async def get_by_intent(self, intent_bundle_id: UUID) -> FakeExecRow | None:
        r = self.rows.get(intent_bundle_id)
        if r is None:
            return None
        return FakeExecRow(tx_hash=r.get("tx_hash"), status=str(r.get("status", "submitted")))


class FakeConfig:
    rpc_url = "http://rpc.test"

    def for_chain(self, chain_id: int) -> FakeConfig:
        return self


@pytest.fixture
def exec_store() -> FakeExecStore:
    return FakeExecStore()


@pytest.fixture
def client(
    monkeypatch: pytest.MonkeyPatch, exec_store: FakeExecStore
) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    app.dependency_overrides[get_bundle_store] = lambda: FakeBundleStore(FakeBundleRow())
    app.dependency_overrides[get_exec_store] = lambda: exec_store
    app.dependency_overrides[get_sim_config] = lambda: FakeConfig()
    yield TestClient(app)
    app.dependency_overrides.clear()


def _submit_body(tx: str | None = TX, op: str = "eoa_call") -> dict[str, object]:
    return {"intentId": str(INTENT), "signed": {"opType": op, "txHash": tx}}


def test_submit_byte_match_records_execution(
    client: TestClient, exec_store: FakeExecStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def matching_tx(rpc_url: str, tx_hash: str) -> dict[str, object]:
        return {"to": VAULT, "input": STEP_DATA}

    monkeypatch.setattr(rpc, "get_transaction", matching_tx)
    r = client.post("/submit-signed-tx", headers=HEADERS, json=_submit_body())
    assert r.status_code == 202
    sub = r.json()["submission"]
    assert sub["status"] == "pending" and sub["txHash"] == TX
    assert exec_store.inserts == 1


def test_submit_tampered_payload_rejected_no_row(
    client: TestClient, exec_store: FakeExecStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def tampered_tx(rpc_url: str, tx_hash: str) -> dict[str, object]:
        return {"to": VAULT, "input": "0xdeadbeef"}  # != the issued step data

    monkeypatch.setattr(rpc, "get_transaction", tampered_tx)
    r = client.post("/submit-signed-tx", headers=HEADERS, json=_submit_body())
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert exec_store.inserts == 0


def test_submit_without_txhash_rejected(client: TestClient, exec_store: FakeExecStore) -> None:
    r = client.post("/submit-signed-tx", headers=HEADERS, json=_submit_body(tx=None))
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert exec_store.inserts == 0


def test_submit_replay_is_deduped(
    client: TestClient, exec_store: FakeExecStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def matching_tx(rpc_url: str, tx_hash: str) -> dict[str, object]:
        return {"to": VAULT, "input": STEP_DATA}  # verified both times → the 2nd de-dups

    monkeypatch.setattr(rpc, "get_transaction", matching_tx)
    r1 = client.post("/submit-signed-tx", headers=HEADERS, json=_submit_body())
    r2 = client.post("/submit-signed-tx", headers=HEADERS, json=_submit_body())
    assert r1.status_code == 202 and r2.status_code == 202
    assert exec_store.inserts == 1  # durable de-dup on intent_bundle_id


def test_submit_unretrievable_tx_rejected_no_row(
    client: TestClient, exec_store: FakeExecStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    # HARDENING: a txHash we cannot retrieve on-chain (bogus, or a log topic, or not propagated) is
    # NEVER recorded — a retryable DATA_STALE, no phantom execution (else US5 would mis-attribute).
    calls = {"n": 0}

    async def no_tx(rpc_url: str, tx_hash: str) -> None:
        calls["n"] += 1
        return None

    monkeypatch.setattr(rpc, "get_transaction", no_tx)
    monkeypatch.setattr(orchestrate, "_TX_LOOKUP_DELAY_S", 0.0)  # no real sleeping in tests
    r = client.post("/submit-signed-tx", headers=HEADERS, json=_submit_body())
    assert r.status_code == 409
    body = r.json()["error"]
    assert body["code"] == "DATA_STALE" and body["retryable"] is True
    assert exec_store.inserts == 0
    assert calls["n"] == orchestrate._TX_LOOKUP_ATTEMPTS  # retried the full budget before giving up


def test_submit_rpc_error_while_verifying_is_upstream_unavailable(
    client: TestClient, exec_store: FakeExecStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    # An RPC outage while verifying is transient (retryable), NOT a silent record.
    async def boom(rpc_url: str, tx_hash: str) -> dict[str, object]:
        raise RuntimeError("rpc down")

    monkeypatch.setattr(rpc, "get_transaction", boom)
    monkeypatch.setattr(orchestrate, "_TX_LOOKUP_DELAY_S", 0.0)
    r = client.post("/submit-signed-tx", headers=HEADERS, json=_submit_body())
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "UPSTREAM_UNAVAILABLE"
    assert exec_store.inserts == 0


def test_submit_unknown_intent_404(client: TestClient) -> None:
    app.dependency_overrides[get_bundle_store] = lambda: FakeBundleStore(None)
    r = client.post(
        "/submit-signed-tx",
        headers=HEADERS,
        json={"intentId": str(uuid4()), "signed": {"opType": "eoa_call", "txHash": TX}},
    )
    assert r.status_code == 404


def test_status_confirmed(
    client: TestClient, exec_store: FakeExecStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    exec_store.rows[INTENT] = {"tx_hash": TX, "status": "submitted"}

    async def receipt(rpc_url: str, tx_hash: str) -> dict[str, object]:
        return {"status": "0x1", "blockNumber": "0x64", "gasUsed": "0x5208"}

    monkeypatch.setattr(rpc, "get_receipt", receipt)
    r = client.get(f"/submit-signed-tx/{INTENT}", headers=HEADERS)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "confirmed"
    assert body["txHash"] == TX and body["blockNumber"] == 100
    assert exec_store.rows[INTENT]["status"] == "confirmed"


def test_status_pending_when_receipt_absent(
    client: TestClient, exec_store: FakeExecStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    exec_store.rows[INTENT] = {"tx_hash": TX, "status": "submitted"}

    async def no_receipt(rpc_url: str, tx_hash: str) -> None:
        return None

    monkeypatch.setattr(rpc, "get_receipt", no_receipt)
    r = client.get(f"/submit-signed-tx/{INTENT}", headers=HEADERS)
    assert r.status_code == 200 and r.json()["status"] == "pending"


def test_status_unknown_intent_404(client: TestClient) -> None:
    r = client.get(f"/submit-signed-tx/{uuid4()}", headers=HEADERS)
    assert r.status_code == 404
