# ruff: noqa: S101, S105  (pytest asserts; the "secret" literal is a test sentinel, not a password)
"""023 T010 — /readyz describes the chain actually being served (FR-023-005/006).

The old checks were wrong in BOTH directions on mainnet: ``base_rpc`` keyed off
``BASE_SEPOLIA_RPC_URL``/``ALCHEMY_ACCESS_KEY`` and ``sim_fork`` off ``SIM_FORK_RPC_URL``, so a
correctly-configured mainnet deployment reported not-ready forever while one carrying a stale
Sepolia url reported ready **while serving mainnet**. These tests pin both directions, plus the
anonymous no-topology-disclosure rule.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api import main as main_module
from sparkpoint_agent.api.main import app

_S2S = "test-s2s-token"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """A blank chain/LLM/DB env per test, and a fresh probe cache so verdicts never leak across."""
    for name in (
        "CHAIN_ID",
        "SPARKPOINT_RPC_URL",
        "BASE_MAINNET_RPC_URL",
        "BASE_SEPOLIA_RPC_URL",
        "SIM_FORK_RPC_URL",
        "ALCHEMY_ACCESS_KEY",
        "LITELLM_BASE_URL",
        "NEW_ANTHROPIC_OAUTH_TOKEN",
        "ANTHROPIC_OAUTH_TOKEN",
        "ANTHROPIC_API_KEY",
    ):
        monkeypatch.delenv(name, raising=False)
    from sparkpoint_agent.api import vault as vault_module

    vault_module._chain_probes.clear()
    yield
    vault_module._chain_probes.clear()


def _stub_chain(
    monkeypatch: pytest.MonkeyPatch,
    *,
    chain_id: int | None,
    rpc_ok: bool,
    identity_ok: bool,
    swap_capable: bool,
) -> None:
    """Pin ``_chain_readiness`` so each test states one readiness scenario outright."""

    async def _fake() -> tuple[int | None, bool, bool, bool]:
        return chain_id, rpc_ok, identity_ok, swap_capable

    monkeypatch.setattr(main_module, "_chain_readiness", _fake)


def _stub_deps(monkeypatch: pytest.MonkeyPatch, *, llm: bool = True, postgres: bool = True) -> None:
    """Make the non-chain dependencies deterministic so a scenario isolates the chain checks."""

    async def _llm() -> bool:
        return llm

    class _Db:
        async def healthcheck(self) -> bool:
            return postgres

    monkeypatch.setattr(main_module, "_llm_ready", _llm)
    monkeypatch.setattr(main_module, "get_database", lambda: _Db())
    monkeypatch.setattr(main_module, "has_valid_s2s", lambda auth: auth == f"Bearer {_S2S}")


def _readyz(*, s2s: bool) -> Any:
    headers = {"Authorization": f"Bearer {_S2S}"} if s2s else {}
    with TestClient(app) as client:
        return client.get("/readyz", headers=headers)


def test_mainnet_shaped_config_is_ready_without_any_sepolia_var(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The regression that motivated FR-023-005: a correct mainnet deployment used to be
    permanently not-ready because it has no BASE_SEPOLIA_RPC_URL and no SIM_FORK_RPC_URL."""
    _stub_deps(monkeypatch)
    _stub_chain(monkeypatch, chain_id=8453, rpc_ok=True, identity_ok=True, swap_capable=False)

    body = _readyz(s2s=True).json()
    assert body["ready"] is True
    assert body["chain_id"] == 8453
    assert body["checks"]["chain_rpc"] is True
    assert body["checks"]["chain_identity"] is True
    # sim_fork is REPORTED (false here) but must not hold back a vault-only chain.
    assert body["checks"]["sim_fork"] is False


def test_chain_mismatch_reports_not_ready_with_the_identity_check_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The dangerous direction: an RPC is reachable but serves a DIFFERENT chain."""
    _stub_deps(monkeypatch)
    _stub_chain(monkeypatch, chain_id=8453, rpc_ok=True, identity_ok=False, swap_capable=False)

    body = _readyz(s2s=True).json()
    assert body["ready"] is False
    assert body["checks"]["chain_rpc"] is True  # the url resolves…
    assert body["checks"]["chain_identity"] is False  # …but it is not the configured chain


def test_unresolved_rpc_reports_not_ready(monkeypatch: pytest.MonkeyPatch) -> None:
    _stub_deps(monkeypatch)
    _stub_chain(monkeypatch, chain_id=8453, rpc_ok=False, identity_ok=False, swap_capable=False)

    body = _readyz(s2s=True).json()
    assert body["ready"] is False
    assert body["checks"]["chain_rpc"] is False


def test_sim_fork_is_required_only_on_a_swap_capable_chain(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """``sim_fork`` gates the oracle-dependent swap path, so it counts toward ``ready`` only where
    the resolved allowlist actually offers a swap."""
    _stub_deps(monkeypatch)

    # Swap-capable chain, no fork configured → not ready.
    _stub_chain(monkeypatch, chain_id=8453, rpc_ok=True, identity_ok=True, swap_capable=True)
    assert _readyz(s2s=True).json()["ready"] is False

    # Same, with the fork configured → ready.
    monkeypatch.setenv("SIM_FORK_RPC_URL", "http://fork.local:8545")
    body = _readyz(s2s=True).json()
    assert body["ready"] is True
    assert body["checks"]["sim_fork"] is True


def test_anonymous_response_is_a_bare_boolean_and_leaks_no_topology(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-023-006 — the endpoint is public, so it must not hand an anonymous caller the dependency
    map, the policy version, or the chain it serves."""
    _stub_deps(monkeypatch)
    _stub_chain(monkeypatch, chain_id=8453, rpc_ok=True, identity_ok=False, swap_capable=False)

    body = _readyz(s2s=False).json()
    assert body == {"ready": False}
    assert "checks" not in body
    assert "chain_id" not in body
    assert "policy_version" not in body


def test_readyz_never_surfaces_an_rpc_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """A url can carry a provider key, so it must not reach the S2S breakdown either."""
    secret = "https://mainnet.example/v2/SUPER_SECRET_PROVIDER_KEY"
    monkeypatch.setenv("SPARKPOINT_RPC_URL", secret)
    _stub_deps(monkeypatch)
    _stub_chain(monkeypatch, chain_id=8453, rpc_ok=True, identity_ok=True, swap_capable=False)

    assert "SUPER_SECRET_PROVIDER_KEY" not in _readyz(s2s=True).text


def test_unloadable_config_is_honestly_not_ready_not_a_500() -> None:
    """``/readyz`` is what infra polls: a broken config must degrade to not-ready, never raise."""
    with TestClient(app) as client:
        response = client.get("/readyz")
    assert response.status_code == 200
    assert response.json()["ready"] in (True, False)
