# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§3.3 portfolio endpoints (api/portfolio.py).

Everything runs against a MOCKED vault reader (no live vault / RPC / DB). The crux of §3.3
is the stale-markable posture: a chain outage DEGRADES to ``200 + stale:true`` (custody
balances reconcile via the frontend's direct RPC, SC-011) instead of the hard 503 the §3.7
quote surface returns — see ``test_portfolio_degrades_to_stale_not_error``. Derived figures
that need the (unbuilt) cost-basis/event index are ``null``/``[]``, never fabricated.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.portfolio import get_vault_flow_reader
from sparkpoint_agent.api.recommendations import get_agent_config
from sparkpoint_agent.api.vault import get_vault_reader
from sparkpoint_agent.chain import VaultReader
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.db.vault_flows import CostBasis

VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"


class _FakeFlowReader:
    """In-memory cost-basis reader for the PnL path (no DB)."""

    def __init__(self, basis: CostBasis | None = None) -> None:
        self._basis = basis or CostBasis(0, 0, 0)

    async def cost_basis(self, network_id: str, vault: str, owner: str) -> CostBasis:
        return self._basis

_WAD = 10**18

TOKEN = "test-web-tier-token"
USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": "0x1111111111111111111111111111111111111111",
    "X-Owner": "0x2222222222222222222222222222222222222222",
    "X-Chain-Id": "8453",
}


class FakePortfolioReader:
    """A structural stand-in for :class:`VaultReader` returning preset on-chain values.

    ``convertToAssets`` mirrors the chain read exactly (never re-derived in Python); with the
    default ``pps == 1e18`` the underlying equals the share balance, so a test can preset a
    distinct ``balance`` and assert the endpoint echoes it verbatim.
    """

    def __init__(
        self,
        *,
        balance: int = 0,
        pps: int = _WAD,
        asset_address: str = USDC,
        block: int = 1_234_567,
        idle: int = 0,
    ) -> None:
        self._balance = balance
        self._pps = pps
        self._asset = asset_address
        self._block = block
        self._idle = idle

    async def balance_of(self, owner: str) -> int:
        return self._balance

    async def convert_to_assets(self, shares: int) -> int:
        return shares * self._pps // _WAD

    async def asset(self) -> str:
        return self._asset

    async def token_balance_of(self, token: str, owner: str) -> int:
        return self._idle

    async def block_number(self) -> int:
        return self._block


class ExplodingTransport:
    """Fails the test if any RPC is issued — proves an undeployed vault degrades WITHOUT
    touching the network (the reader raises NOT_DEPLOYED before any eth_call)."""

    async def call(self, method: str, params: Sequence[Any]) -> str:
        raise AssertionError(f"no RPC should be issued for an undeployed vault; got {method!r}")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _use(reader: object, *, basis: CostBasis | None = None) -> None:
    app.dependency_overrides[get_vault_reader] = lambda: reader
    # B2: the portfolio endpoint now derives PnL from indexed flows + reads the vault address from
    # config — provide in-memory fakes (no DB) so the cost-basis path is exercised without Postgres.
    app.dependency_overrides[get_vault_flow_reader] = lambda: _FakeFlowReader(basis)
    app.dependency_overrides[get_agent_config] = lambda: AgentConfig(
        chain_id=84532, rpc_url=None, vault_address=VAULT, database_url=None
    )


# ── GET /portfolio ────────────────────────────────────────────────────────────────


def test_portfolio_returns_enriched_position(client: TestClient) -> None:
    # 100.25 USDC held (6dp) → valueUsd "100.25"; convertToAssets echoed verbatim.
    _use(FakePortfolioReader(balance=100_250_000, block=42))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is False
    assert body["asOfBlock"] == 42
    assert body["netWorthUsd"] == "100.25"
    assert len(body["positions"]) == 1
    pos = body["positions"][0]
    assert pos["venue"] == "vault"
    assert pos["asset"] == USDC
    assert pos["shares"] == "100250000"
    assert pos["underlying"] == "100250000"
    assert pos["valueUsd"] == "100.25"
    assert pos["priceSource"] == "onchain"
    assert pos["riskTier"] == "conservative"
    # Cost basis / PnL need the derived index (fee indexer) → null, never fabricated.
    assert pos["costBasisUsd"] is None
    assert pos["unrealizedPnlUsd"] is None
    # Single holding ⇒ 100% concentration; allocation is one full slice per bucket.
    assert body["risk"]["concentrationBps"] == 10_000
    assert body["risk"]["score"] is None
    assert body["allocation"]["byAsset"][0]["bps"] == 10_000
    assert body["allocation"]["byStrategy"][0]["key"] == "vault"
    assert body["pnl"]["series"] == []
    sources = body["dataSources"]
    assert sources[0]["status"] == "ok"
    assert sources[0]["lastBlock"] == 42


def test_portfolio_pnl_from_indexed_cost_basis(client: TestClient) -> None:
    # Position worth 300 USDC, cost basis = 250 deposited − 0 withdrawn → unrealized PnL = +50.
    _use(FakePortfolioReader(balance=300_000_000, block=42), basis=CostBasis(250_000_000, 0, 3))
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    pos = body["positions"][0]
    assert pos["costBasisUsd"] == "250.00"
    assert pos["unrealizedPnlUsd"] == "50.00"
    assert body["pnl"]["unrealizedUsd"] == "50.00"


def test_portfolio_pnl_null_when_no_flows_indexed(client: TestClient) -> None:
    # No indexed flows (event_count 0) → cost basis + PnL are null (honest), never fabricated.
    _use(FakePortfolioReader(balance=300_000_000), basis=CostBasis(0, 0, 0))
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    assert body["positions"][0]["costBasisUsd"] is None
    assert body["positions"][0]["unrealizedPnlUsd"] is None
    assert body["pnl"]["unrealizedUsd"] is None


def test_portfolio_surfaces_idle_cash_and_includes_it_in_net_worth(client: TestClient) -> None:
    # 100.25 USDC in the vault + 50.00 idle in the wallet → idleUsdc "50.00", netWorth "150.25".
    _use(FakePortfolioReader(balance=100_250_000, idle=50_000_000, block=42))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["idleUsdc"] == "50.00"
    assert body["netWorthUsd"] == "150.25"  # vault value + idle cash
    assert body["positions"][0]["valueUsd"] == "100.25"  # the position itself is vault-only


def test_portfolio_empty_when_no_shares_still_reports_idle(client: TestClient) -> None:
    # No vault shares but idle cash present → no position, but idle surfaces (available to deposit).
    _use(FakePortfolioReader(balance=0, idle=25_000_000))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["positions"] == []
    assert body["idleUsdc"] == "25.00"
    assert body["netWorthUsd"] == "25.00"


def test_portfolio_empty_when_no_shares(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=0))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is False
    assert body["positions"] == []
    assert body["idleUsdc"] == "0.00"
    assert body["netWorthUsd"] == "0.00"
    assert body["allocation"]["byAsset"] == []
    assert body["risk"]["concentrationBps"] == 0


def test_portfolio_degrades_to_stale_not_error(client: TestClient) -> None:
    """THE §3.3 crux: an undeployed/unreachable vault DEGRADES to 200 + stale:true (never a
    hard 503) so the frontend reconciles custody balances via direct RPC (SC-011)."""
    _use(VaultReader(vault_address=None, transport=ExplodingTransport()))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200  # NOT 503 — unlike the §3.7 quote surface
    body = resp.json()
    assert body["stale"] is True
    assert body["positions"] == []
    assert body["dataSources"][0]["status"] == "stale"
    assert body["dataSources"][0]["lastBlock"] is None


def test_portfolio_include_filter_omits_unrequested_sections(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=100_250_000))
    resp = client.get("/portfolio?include=positions", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["positions"]) == 1
    # Unrequested derived sections are omitted (null), positions still present.
    assert body["allocation"] is None
    assert body["pnl"] is None
    assert body["risk"] is None


def test_portfolio_requires_auth(client: TestClient) -> None:
    _use(FakePortfolioReader())
    resp = client.get("/portfolio")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


# ── GET /portfolio/positions/{positionId} ───────────────────────────────────────────


def test_position_detail_found(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=100_250_000, block=99))
    resp = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["position"]["positionId"] == "vault"
    assert body["position"]["valueUsd"] == "100.25"
    assert body["asOfBlock"] == 99
    # History + per-position series need the (unbuilt) event index → empty, never fabricated.
    assert body["onchainEvents"] == []
    assert body["pnlSeries"] == []


def test_position_detail_surfaces_indexed_pnl(client: TestClient) -> None:
    # Detail view must match the list view: 300 held − 250 basis → cost "250.00", PnL "50.00".
    _use(FakePortfolioReader(balance=300_000_000, block=99), basis=CostBasis(250_000_000, 0, 3))
    body = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS).json()
    assert body["position"]["costBasisUsd"] == "250.00"
    assert body["position"]["unrealizedPnlUsd"] == "50.00"


def test_position_detail_unknown_id_is_not_found(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=100_250_000))
    resp = client.get("/portfolio/positions/does-not-exist", headers=GOOD_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_position_detail_zero_shares_is_not_found(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=0))
    resp = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_position_detail_degrades_to_stale_shell(client: TestClient) -> None:
    # A degraded read cannot confirm the position; return a stale shell (200), not an error.
    _use(VaultReader(vault_address=None, transport=ExplodingTransport()))
    resp = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is True
    assert body["position"]["positionId"] == "vault"
    assert body["position"]["valueUsd"] == "0.00"
