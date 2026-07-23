# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§018/US2 pre-sign dry-run endpoints — POST /vault/simulate/{deposit,withdraw} (api/vault.py).

Everything runs against a MOCKED vault reader + config + dry-runner (no live vault / RPC): the
endpoint resolves the ERC-4626 preview + allowance from the fake reader, encodes the REAL mutating
calldata, and hands it to the injected dry-runner. The crux:

- DEPOSIT with allowance < amount → ``approvalRequired`` (dry-run DEFERRED — never a false revert).
- DEPOSIT with allowance ≥ amount → the real dry-run runs; a predicted revert surfaces
  ``simulation.willRevert`` + the decoded reason; a pass surfaces the real gas.
- WITHDRAW never checks allowance and is advisory (the web gate never blocks the exit — N2).
- An undeployed vault fails CLOSED (SIMULATION_UNAVAILABLE) WITHOUT calling the dry-runner.
- A sim-RPC outage fails CLOSED (UPSTREAM_UNAVAILABLE) via ``_default_dry_runner`` — never a pass.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.vault import (
    _default_dry_runner,
    get_dry_runner,
    get_sim_config,
    get_vault_reader,
)
from sparkpoint_agent.chain import VaultUnavailable, VaultUnavailableReason
from sparkpoint_agent.sim import GasEstimate, SimulationResult, SimulatorUnavailableError

TOKEN = "test-web-tier-token"
USDC = "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f"
VAULT = "0x8bab6d1b75f19e9ed9fce8b9bd338844ff79ae27"
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": "0x1111111111111111111111111111111111111111",
    "X-Owner": "0x1111111111111111111111111111111111111111",
    "X-Chain-Id": "8453",
}


class FakeReader:
    """Structural VaultReader stand-in for the simulate path."""

    def __init__(self, *, allowance: int = 10**30, deployed: bool = True) -> None:
        self._allowance = allowance
        self._deployed = deployed

    async def asset(self) -> str:
        if not self._deployed:
            raise VaultUnavailable(VaultUnavailableReason.NOT_DEPLOYED, "vault not deployed")
        return USDC

    async def preview_deposit(self, assets: int) -> int:
        return assets  # 1:1 at par for the test

    async def preview_mint(self, shares: int) -> int:
        return shares

    async def preview_redeem(self, shares: int) -> int:
        return shares

    async def preview_withdraw(self, assets: int) -> int:
        return assets

    async def token_allowance(self, token: str, owner: str, spender: str) -> int:
        return self._allowance


class FakeConfig:
    """Minimal AgentConfig stand-in: a deployed vault + an RPC url, chain-scope is identity."""

    def __init__(self, vault: str | None = VAULT, rpc: str = "http://rpc.test") -> None:
        self._vault = vault
        self.rpc_url = rpc

    def for_chain(self, chain_id: int) -> FakeConfig:
        return self

    def require_vault_address(self) -> str:
        assert self._vault is not None
        return self._vault


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
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _wire(reader: object, *, config: object | None = None, runner=None) -> None:
    app.dependency_overrides[get_vault_reader] = lambda: reader
    app.dependency_overrides[get_sim_config] = lambda: config or FakeConfig()
    if runner is not None:
        app.dependency_overrides[get_dry_runner] = lambda: runner


def test_deposit_below_allowance_is_approval_required_and_defers_dry_run(
    client: TestClient,
) -> None:
    called = {"n": 0}

    async def runner(request, rpc_url):  # noqa: ANN001, ARG001
        called["n"] += 1
        return _sim(will_revert=False)

    _wire(FakeReader(allowance=0), runner=runner)
    r = client.post(
        "/vault/simulate/deposit", headers=HEADERS, json={"by": "assets", "amount": "1000000"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["approvalRequired"] is True
    assert body["simulation"] is None  # dry-run DEFERRED — never a false "would revert"
    assert body["sharesOut"] == "1000000"
    assert called["n"] == 0  # the runner was NOT invoked pre-approval


def test_deposit_passes_surfaces_real_gas(client: TestClient) -> None:
    async def runner(request, rpc_url):  # noqa: ANN001, ARG001
        return _sim(will_revert=False, gas="0x5208")

    _wire(FakeReader(allowance=10**30), runner=runner)
    r = client.post(
        "/vault/simulate/deposit", headers=HEADERS, json={"by": "assets", "amount": "1000000"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["approvalRequired"] is False
    assert body["simulation"]["willRevert"] is False
    assert body["simulation"]["gas"]["estimate"] == "0x5208"
    assert body["sharesOut"] == "1000000"


def test_deposit_revert_surfaces_decoded_reason(client: TestClient) -> None:
    async def runner(request, rpc_url):  # noqa: ANN001, ARG001
        return _sim(will_revert=True, reason="ERC20: transfer amount exceeds balance")

    _wire(FakeReader(allowance=10**30), runner=runner)
    r = client.post(
        "/vault/simulate/deposit", headers=HEADERS, json={"by": "assets", "amount": "1000000"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["simulation"]["willRevert"] is True
    assert body["simulation"]["revertReason"] == "ERC20: transfer amount exceeds balance"


def test_withdraw_is_advisory_and_needs_no_allowance(client: TestClient) -> None:
    async def runner(request, rpc_url):  # noqa: ANN001, ARG001
        return _sim(will_revert=False)

    # allowance=0 must NOT matter for withdraw (burns own shares) — no approvalRequired path exists.
    _wire(FakeReader(allowance=0), runner=runner)
    r = client.post(
        "/vault/simulate/withdraw", headers=HEADERS, json={"by": "shares", "amount": "500000"}
    )
    assert r.status_code == 200
    body = r.json()
    assert body["kind"] == "withdraw"
    assert body["approvalRequired"] is False
    assert body["assetsOut"] == "500000"
    assert body["simulation"]["willRevert"] is False


def test_undeployed_vault_fails_closed_without_calling_runner(client: TestClient) -> None:
    called = {"n": 0}

    async def runner(request, rpc_url):  # noqa: ANN001, ARG001
        called["n"] += 1
        return _sim(will_revert=False)

    _wire(FakeReader(deployed=False), runner=runner)
    r = client.post(
        "/vault/simulate/deposit", headers=HEADERS, json={"by": "assets", "amount": "1000000"}
    )
    assert r.status_code == 503
    assert r.json()["error"]["code"] == "SIMULATION_UNAVAILABLE"
    assert called["n"] == 0  # fail-closed BEFORE any dry-run — never a fabricated pass


def test_simulate_requires_auth(client: TestClient) -> None:
    _wire(FakeReader())
    r = client.post("/vault/simulate/deposit", json={"by": "assets", "amount": "1000000"})
    assert r.status_code in (401, 403)


@pytest.mark.anyio
async def test_default_dry_runner_translates_rpc_outage_to_upstream_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The fail-closed contract lives in _default_dry_runner: a SimulatorUnavailableError from the
    checker becomes an UPSTREAM_UNAVAILABLE ApiError (503) — never a fabricated pass."""
    from sparkpoint_agent.api import vault as vault_mod
    from sparkpoint_agent.api.errors import ApiError, ErrorCode
    from sparkpoint_agent.sim import SimulationRequest

    class BoomChecker:
        def __init__(self, rpc_url: str) -> None:
            pass

        async def __aenter__(self) -> BoomChecker:
            return self

        async def __aexit__(self, *exc: object) -> None:
            return None

        async def check(self, request: object) -> SimulationResult:
            raise SimulatorUnavailableError("eth_call: transport failure")

    monkeypatch.setattr(vault_mod, "ViemEthCallChecker", BoomChecker)
    req = SimulationRequest(chain_id=8453, sender=HEADERS["X-Account"], to=VAULT, data="0x")
    with pytest.raises(ApiError) as exc:
        await _default_dry_runner(req, "http://rpc.test")
    assert exc.value.code is ErrorCode.UPSTREAM_UNAVAILABLE
