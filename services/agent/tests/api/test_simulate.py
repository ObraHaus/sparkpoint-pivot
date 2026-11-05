# ruff: noqa: S101, S105, ANN001, ARG001
"""§3.5 POST /simulate tests (feature 019 US3) — refresh a stored bundle before signing (VR-S2)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.execution import get_bundle_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.vault import get_dry_runner, get_sim_config
from sparkpoint_agent.sim import GasEstimate, SimulationResult

TOKEN = "test-web-tier-token"
VAULT = "0x00000000000000000000000000000000000000aa"
USER = "0x1111111111111111111111111111111111111111"
INTENT = UUID("11111111-2222-3333-4444-555555555555")
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": USER,
    "X-Owner": USER,
    "X-Chain-Id": "8453",
}


class FakeBundleRow:
    id = INTENT
    chain_id = 8453
    kind = "vault_deposit"
    steps = [{"to": VAULT, "data": "0x6e553f65", "value": "0", "opType": "eoa_call"}]
    smart_account_address = USER
    # 023: the real 0021 columns `_load_bundle` now reads. `/simulate` does NOT enforce expiry (its
    # whole job is refreshing a near-expiry bundle), so a fresh value here is scaffolding only.
    expires_at = datetime.now(UTC) + timedelta(seconds=180)
    is_session_key_path = False


class FakeBundleStore:
    def __init__(self, present: bool) -> None:
        self._present = present

    async def get(self, bundle_id: UUID) -> FakeBundleRow | None:
        return FakeBundleRow() if (self._present and bundle_id == INTENT) else None


class FakeConfig:
    rpc_url = "http://rpc.test"

    def for_chain(self, chain_id: int) -> FakeConfig:
        return self


def _sim() -> SimulationResult:
    return SimulationResult(
        provider="viem_eth_call",
        willRevert=False,
        revertReason=None,
        balanceDeltas=[],
        sharesOut=None,
        assetsOut=None,
        outAmount=None,
        minOut=None,
        priceImpactBps=0,
        slippageBps=0,
        feesUsd="0",
        gas=GasEstimate(estimate="0x5208", gasUsd="0"),
        capHeadroom=None,
        asOfBlock=456,
        asOf=datetime(2026, 7, 23, tzinfo=UTC).isoformat(),
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)

    async def runner(request, rpc_url):
        return _sim()

    app.dependency_overrides[get_sim_config] = lambda: FakeConfig()
    app.dependency_overrides[get_dry_runner] = lambda: runner
    yield TestClient(app)
    app.dependency_overrides.clear()


def test_near_session_is_refused_on_the_execution_spine(client: TestClient) -> None:
    """076 — /build-tx etc. are EVM-only; a NEAR session gets an honest 400, never a 500."""
    near = {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": "sparkpoint2026.near",
        "X-Owner": "sparkpoint2026.near",
        "X-Chain-Id": "8453",
        "X-Auth-Chain": "near",
    }
    r = client.post("/simulate", headers=near, json={"intentId": str(INTENT)})
    assert r.status_code == 400
    assert "EVM wallet" in r.json()["error"]["message"]


def test_simulate_refresh_returns_fresh_sim(client: TestClient) -> None:
    app.dependency_overrides[get_bundle_store] = lambda: FakeBundleStore(present=True)
    r = client.post("/simulate", headers=HEADERS, json={"intentId": str(INTENT)})
    assert r.status_code == 200
    assert r.json()["simulation"]["asOfBlock"] == 456


def test_simulate_unknown_intent_404(client: TestClient) -> None:
    app.dependency_overrides[get_bundle_store] = lambda: FakeBundleStore(present=False)
    r = client.post("/simulate", headers=HEADERS, json={"intentId": str(uuid4())})
    assert r.status_code == 404


def test_simulate_requires_intent_id(client: TestClient) -> None:
    app.dependency_overrides[get_bundle_store] = lambda: FakeBundleStore(present=True)
    r = client.post("/simulate", headers=HEADERS, json={})
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"
