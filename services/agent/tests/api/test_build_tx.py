# ruff: noqa: S101, S105, ANN001, ARG001
"""§3.5 POST /build-tx contract tests (feature 019 US2) — the single signing chokepoint.

Everything runs against a MOCKED vault reader + config + dry-runner + in-memory bundle store (no live
vault / RPC / Postgres). The crux (spec SC-001/002/003, VR-X2/X3, N1/N2/N3):

- an APPROVED vault deposit → one IntentBundle (recipient forced, signature null, sim present + passed);
- an over-cap deposit → CAP_EXCEEDED envelope + NO bundle;
- a swap / unknown / non-USDC action → an honest refusal + NO bundle (vault-only on testnet);
- a deposit needing approval → APPROVAL_REQUIRED (no false revert, runner not called);
- a predicted deposit revert → SIMULATION_REVERT + NO bundle (sim attached);
- N2: a withdraw builds under a fully hostile ctx (paused + over-cap + simulator down) and is NEVER
  KILL_SWITCH_PAUSED; a deposit while paused IS refused (the asymmetry);
- idempotency: a replayed build returns the ORIGINAL bundle.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.errors import ApiError, ErrorCode, ErrorReason
from sparkpoint_agent.api.execution import get_bundle_store
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.vault import get_dry_runner, get_sim_config, get_vault_reader
from sparkpoint_agent.chain import VaultUnavailable, VaultUnavailableReason
from sparkpoint_agent.sim import GasEstimate, SimulationResult

TOKEN = "test-web-tier-token"
USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"  # arbitrary; reader.asset() returns the same
VAULT = "0x00000000000000000000000000000000000000aa"
USER = "0x1111111111111111111111111111111111111111"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": USER,
    "X-Owner": USER,
    "X-Chain-Id": "8453",
}

_PER_USER_CAP = 5_000_000_000  # policy CAPS.per_user_tvl (5,000 USDC, 6dp)


class FakeReader:
    """Structural VaultReader stand-in for the build-tx path."""

    def __init__(
        self,
        *,
        allowance: int = 10**30,
        deployed: bool = True,
        paused: bool = False,
        total_assets: int = 0,
        user_shares: int = 0,
    ) -> None:
        self._allowance = allowance
        self._deployed = deployed
        self._paused = paused
        self._total_assets = total_assets
        self._user_shares = user_shares

    async def asset(self) -> str:
        if not self._deployed:
            raise VaultUnavailable(VaultUnavailableReason.NOT_DEPLOYED, "vault not deployed")
        return USDC

    async def token_allowance(self, token: str, owner: str, spender: str) -> int:
        return self._allowance

    async def preview_deposit(self, assets: int) -> int:
        return assets

    async def preview_redeem(self, shares: int) -> int:
        return shares

    async def paused(self) -> bool:
        return self._paused

    async def total_assets(self) -> int:
        return self._total_assets

    async def balance_of(self, account: str) -> int:
        return self._user_shares

    async def convert_to_assets(self, shares: int) -> int:
        return shares


class FakeConfig:
    def __init__(self, vault: str | None = VAULT, rpc: str = "http://rpc.test") -> None:
        self._vault = vault
        self.rpc_url = rpc

    def for_chain(self, chain_id: int) -> FakeConfig:
        return self

    def require_vault_address(self) -> str:
        assert self._vault is not None
        return self._vault


class FakeBundleStore:
    """In-memory intent-bundle store: records what was persisted for the assertions."""

    def __init__(self) -> None:
        self.approved: list[object] = []
        self.rejected: list[object] = []
        self.sims: list[object] = []

    async def persist_approved(self, bundle: object, sim: object) -> UUID:
        self.approved.append(bundle)
        self.sims.append(sim)
        return uuid4()

    async def persist_bundle(self, bundle: object) -> UUID:
        status = getattr(bundle, "policy_verdict", None)
        (self.approved if status == "approved" else self.rejected).append(bundle)
        return uuid4()


def _sim(*, will_revert: bool, reason: str | None = None, gas: str = "0x1e848") -> SimulationResult:
    return SimulationResult(
        provider="viem_eth_call",
        willRevert=will_revert,
        revertReason=reason,
        balanceDeltas=[],
        sharesOut=None,
        assetsOut=None,
        outAmount=None,
        minOut=None,
        priceImpactBps=0,
        slippageBps=0,
        feesUsd="0",
        gas=GasEstimate(estimate=gas, gasUsd="0"),
        capHeadroom=None,
        asOfBlock=123,
        asOf=datetime(2026, 7, 23, tzinfo=UTC).isoformat(),
    )


@pytest.fixture
def store() -> FakeBundleStore:
    return FakeBundleStore()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, store: FakeBundleStore) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    app.dependency_overrides[get_bundle_store] = lambda: store
    yield TestClient(app)
    app.dependency_overrides.clear()


def _wire(reader: object, runner: object, *, config: object | None = None) -> None:
    app.dependency_overrides[get_vault_reader] = lambda: reader
    app.dependency_overrides[get_sim_config] = lambda: config or FakeConfig()
    app.dependency_overrides[get_dry_runner] = lambda: runner


def _ok_runner(sim: SimulationResult | None = None):
    async def runner(request, rpc_url):
        return sim if sim is not None else _sim(will_revert=False)

    return runner


def _deposit_body(amount: str = "100000000") -> dict[str, object]:
    return {
        "action": {"type": "vault_deposit", "asset": USDC, "decimals": 6, "amount": amount},
        "execMode": "per_action",
    }


# ── US1 — build an approved bundle ───────────────────────────────────────────────────────────────


def test_build_deposit_approved_returns_signable_bundle(
    client: TestClient, store: FakeBundleStore
) -> None:
    _wire(FakeReader(), _ok_runner())
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body())
    assert r.status_code == 200
    b = r.json()["intentBundle"]
    assert b["kind"] == "vault_deposit"
    assert b["userId"].lower() == USER
    assert b["userOp"] is None  # eoa_call — no ERC-4337 op until US6
    assert b["simulation"] is not None and b["simulation"]["willRevert"] is False  # VR-X2
    assert b["policyVerdict"]["approved"] is True
    assert b["steps"][0]["opType"] == "eoa_call"
    assert b["steps"][0]["to"].lower() == VAULT
    assert "signature" not in b["steps"][0]  # N1/N3 — steps carry unsigned calldata only
    # the recipient encoded in the calldata is the connected user (N1)
    assert USER[2:].lower() in b["steps"][0]["data"].lower()
    # persisted with an approved verdict + a sim (VR-X2)
    assert len(store.approved) == 1 and len(store.sims) == 1


def test_build_deposit_guardrail_checklist_marks_recipient_is_you(client: TestClient) -> None:
    _wire(FakeReader(), _ok_runner())
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body())
    checks = {c["id"]: c for c in r.json()["intentBundle"]["guardrailChecklist"]}
    assert checks["recipient_is_you"]["status"] == "pass"
    assert checks["protocol_allowlisted"]["status"] == "pass"
    assert checks["simulation_passed"]["status"] == "pass"


# ── US1 — fail-closed rejections (reasons + NO bundle, VR-X3) ─────────────────────────────────────


def test_build_over_cap_deposit_rejected_no_bundle(
    client: TestClient, store: FakeBundleStore
) -> None:
    # amount above the per-user cap, allowance sufficient so the cap (not approval) is the failure.
    _wire(FakeReader(allowance=10**30), _ok_runner())
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body(str(_PER_USER_CAP + 1)))
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "CAP_EXCEEDED"
    assert "intentBundle" not in r.json()
    assert store.approved == []  # nothing signable materialized
    assert len(store.rejected) == 1  # a rejected bundle row is persisted for audit (VR-X3)


def test_build_swap_is_refused_honestly(client: TestClient) -> None:
    _wire(FakeReader(), _ok_runner())
    body = {
        "action": {"type": "aerodrome_swap", "asset": USDC, "decimals": 6, "amount": "1000000"},
        "execMode": "per_action",
    }
    r = client.post("/build-tx", headers=HEADERS, json=body)
    assert r.status_code == 400
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"  # vault-only on testnet — honest refusal


def test_build_non_usdc_asset_rejected(client: TestClient) -> None:
    _wire(FakeReader(), _ok_runner())
    body = {
        "action": {
            "type": "vault_deposit",
            "asset": "0x0000000000000000000000000000000000000bad",
            "decimals": 6,
            "amount": "1000000",
        },
        "execMode": "per_action",
    }
    r = client.post("/build-tx", headers=HEADERS, json=body)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "POLICY_REJECTED"


def test_build_deposit_needs_approval_returns_approval_required(
    client: TestClient, store: FakeBundleStore
) -> None:
    called = {"n": 0}

    async def runner(request, rpc_url):
        called["n"] += 1
        return _sim(will_revert=False)

    _wire(FakeReader(allowance=0), runner)  # allowance below the amount
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body())
    assert r.status_code == 400
    codes = [x["code"] for x in r.json()["error"]["reasons"]]
    assert "APPROVAL_REQUIRED" in codes
    assert called["n"] == 0  # never a false revert — the dry-run is deferred
    assert store.approved == []


def test_build_deposit_predicted_revert_rejected_with_simulation(client: TestClient) -> None:
    _wire(FakeReader(), _ok_runner(_sim(will_revert=True, reason="AaveVault: paused")))
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body())
    assert r.status_code == 422
    err = r.json()["error"]
    assert err["code"] == "SIMULATION_REVERT"
    assert err["simulation"] is not None and err["simulation"]["willRevert"] is True


def test_build_idempotent_replay_returns_same_bundle(client: TestClient) -> None:
    _wire(FakeReader(), _ok_runner())
    key = str(uuid4())
    h = {**HEADERS, "Idempotency-Key": key}
    r1 = client.post("/build-tx", headers=h, json=_deposit_body())
    r2 = client.post("/build-tx", headers=h, json=_deposit_body())
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["intentBundle"]["id"] == r2.json()["intentBundle"]["id"]


# ── US5 — non-custody invariants under adversarial conditions ────────────────────────────────────


def test_withdraw_builds_under_fully_hostile_ctx(client: TestClient, store: FakeBundleStore) -> None:
    """N2 (SC-003): a redeem builds even when paused + over-cap + the simulator is DOWN, and is
    NEVER KILL_SWITCH_PAUSED. The assembler never even gathers the pause/cap reads on an exit."""

    async def down_runner(request, rpc_url):
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "sim down",
            reasons=[ErrorReason("SIM_UNAVAILABLE", "down")],
        )

    hostile = FakeReader(paused=True, total_assets=10**18, user_shares=10**18)
    _wire(hostile, down_runner)
    body = {
        "action": {"type": "vault_redeem", "asset": USDC, "decimals": 6, "amount": "500000"},
        "execMode": "per_action",
    }
    r = client.post("/build-tx", headers=HEADERS, json=body)
    assert r.status_code == 200
    b = r.json()["intentBundle"]
    assert b["kind"] == "vault_redeem"
    assert b["simulation"] is None  # sim unavailable NEVER blocks the exit (N2)
    assert b["policyVerdict"]["approved"] is True
    assert len(store.approved) == 1  # approved-exit-no-sim persisted (N2 over VR-X2)


def test_deposit_while_paused_is_rejected(client: TestClient) -> None:
    """N2 asymmetry: deposits ARE pausable (withdraws are not)."""
    _wire(FakeReader(paused=True), _ok_runner())
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body())
    assert r.status_code == 409
    assert r.json()["error"]["code"] == "KILL_SWITCH_PAUSED"


def test_undeployed_vault_fails_closed(client: TestClient) -> None:
    _wire(FakeReader(deployed=False), _ok_runner())
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body())
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "SIMULATION_UNAVAILABLE"


def test_build_requires_auth(client: TestClient) -> None:
    _wire(FakeReader(), _ok_runner())
    r = client.post("/build-tx", json=_deposit_body())
    assert r.status_code in (401, 403)


def test_build_response_never_carries_a_signature(client: TestClient) -> None:
    """N3: no field named 'signature' is ever non-null anywhere in a build response."""
    _wire(FakeReader(), _ok_runner())
    r = client.post("/build-tx", headers=HEADERS, json=_deposit_body())

    def _no_sig(node: object) -> None:
        if isinstance(node, dict):
            for k, v in node.items():
                assert not (k.lower() == "signature" and v is not None)
                _no_sig(v)
        elif isinstance(node, list):
            for v in node:
                _no_sig(v)

    _no_sig(r.json())
