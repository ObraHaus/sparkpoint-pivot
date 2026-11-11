# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""1111 — a NEAR NEP-413 session must degrade honestly, never 500/503.

A NEAR account id ("sparkpoint2026.near") is a valid app identity but has no EVM address.
The EVM chain reads used to receive it verbatim: ``_normalize_address`` raised ``ValueError``,
which is not ``VaultUnavailable``, so chat + notifications returned 500 INTERNAL and portfolio
could 503 on an unnecessary chain-identity probe. These tests pin the honest outcome for each
surface: 200 with NEAR-appropriate content, no EVM read attempted, auth unchanged.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Iterator
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.agents.planner import Intent, IntentKind
from sparkpoint_agent.api.chat import (
    _NoopConversationSink,
    _NoopMemorySink,
    _VaultChatChainProvider,
    _VaultChatPortfolioProvider,
    get_chain_provider,
    get_conversation_sink,
    get_coordinator_dag,
    get_memory_sink,
)
from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.notifications import (
    get_agent_config as get_notifications_config,
)
from sparkpoint_agent.api.notifications import (
    get_execution_store,
    get_notif_event_store,
    get_notif_read_store,
    get_session_key_store,
)
from sparkpoint_agent.api.notifications import (
    get_vault_flow_reader as get_notifications_flow_reader,
)
from sparkpoint_agent.api.portfolio import (
    get_rec_store,
    get_wrapper_store,
)
from sparkpoint_agent.api.portfolio import (
    get_vault_flow_reader as get_portfolio_flow_reader,
)
from sparkpoint_agent.api.recommendations import _read_gate_inputs, get_agent_config
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.vault import (
    build_vault_reader,
    get_vault_reader,
    require_verified_chain,
)
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.coordinator.dag import ChainContext, CoordinatorDag, TextBlock
from sparkpoint_agent.policy import CAPS, GOVERNANCE
from sparkpoint_agent.portfolio.models import PortfolioOverview, PortfolioRow, PortfolioSection

TOKEN = "test-web-tier-token"
VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
NEAR = "sparkpoint2026.near"
NEAR_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": NEAR,
    "X-Owner": NEAR,
    "X-Chain-Id": "84532",
    "X-Auth-Chain": "near",
}


class _ExplodingReader:
    """Fails loudly if a NEAR session ever reaches an EVM chain read."""

    async def balance_of(self, owner: str) -> int:
        raise AssertionError(f"EVM balanceOf must not be called for a NEAR session: {owner!r}")


def _near_account() -> AccountContext:
    return AccountContext(account=NEAR, owner=NEAR, chain_id=84532, auth_chain="near")


def _config() -> AgentConfig:
    return AgentConfig(chain_id=84532, rpc_url=None, vault_address=VAULT, database_url=None)


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app, raise_server_exceptions=False)
    app.dependency_overrides.clear()


# ── chat: the chain context + portfolio read never touch EVM state for NEAR ──────


@pytest.mark.asyncio
async def test_chat_chain_context_for_near_skips_evm_reads() -> None:
    provider = _VaultChatChainProvider(_ExplodingReader(), _config())
    chain = await provider.context(_near_account(), surface="chat")

    assert chain.auth_chain == "near"
    assert chain.resolved_targets == {}  # no EVM vault target a NEAR wallet cannot sign for
    assert chain.data_stale is True  # gate fails closed on inflows
    assert chain.caps.per_user == CAPS.per_user_tvl.amount
    assert chain.market.gross_apy_bps is None


@pytest.mark.asyncio
async def test_chat_portfolio_for_near_is_an_honest_stale_empty() -> None:
    provider = _VaultChatPortfolioProvider(_ExplodingReader(), _config())
    view = await provider.read(
        ChainContext(chain_id=84532, user_account=NEAR, owner=NEAR, auth_chain="near")
    )
    assert view.positions == ()
    assert view.net_worth_usd == "0.00"
    assert view.stale is True


@pytest.mark.asyncio
async def test_read_gate_inputs_for_near_fails_closed_without_a_chain_read() -> None:
    caps, fee_bps, stale = await _read_gate_inputs(_ExplodingReader(), _near_account())  # type: ignore[arg-type]
    assert caps.per_user == CAPS.per_user_tvl.amount
    assert fee_bps == GOVERNANCE.performance_fee.default_bps
    assert stale is True


def test_chat_endpoint_returns_200_for_a_near_session(client: TestClient) -> None:
    class _Dag:
        async def run_chat(self, *_args: Any, **_kwargs: Any) -> AsyncIterator[Any]:
            yield TextBlock("Hello from Sparky.")

    app.dependency_overrides[get_chain_provider] = lambda: _VaultChatChainProvider(
        _ExplodingReader(), _config()
    )
    app.dependency_overrides[get_coordinator_dag] = lambda: _Dag()
    app.dependency_overrides[get_conversation_sink] = lambda: _NoopConversationSink()
    app.dependency_overrides[get_memory_sink] = lambda: _NoopMemorySink()

    resp = client.post(
        "/chat", json={"message": "what earn options do I have?"}, headers=NEAR_HEADERS
    )

    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert "Hello from Sparky." in resp.text
    assert '"code": "INTERNAL"' not in resp.text


# ── notifications: honest empty feed, no EVM read ────────────────────────────────


def test_notifications_endpoint_returns_an_empty_feed_for_a_near_session(
    client: TestClient,
) -> None:
    app.dependency_overrides[get_vault_reader] = lambda: _ExplodingReader()
    app.dependency_overrides[get_notifications_flow_reader] = lambda: object()
    app.dependency_overrides[get_execution_store] = lambda: object()
    app.dependency_overrides[get_notif_read_store] = lambda: object()
    app.dependency_overrides[get_session_key_store] = lambda: object()
    app.dependency_overrides[get_notif_event_store] = lambda: object()
    app.dependency_overrides[get_notifications_config] = lambda: _config()

    resp = client.get("/notifications", headers=NEAR_HEADERS)

    assert resp.status_code == 200
    body = resp.json()
    assert body["notifications"] == []
    assert body["unreadCount"] == 0
    assert body["asOfBlock"] == 0


# ── portfolio: no chain-identity probe / EVM read for NEAR ───────────────────────


def test_portfolio_endpoint_returns_near_empty_without_probing_evm(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # A configured-but-unreachable Sepolia RPC would make the 023 chain-identity probe 503. A
    # NEAR session has no EVM chain to verify, so it must never reach that probe.
    monkeypatch.setenv("BASE_SEPOLIA_RPC_URL", "http://127.0.0.1:1")
    app.dependency_overrides[get_vault_reader] = lambda: _ExplodingReader()
    app.dependency_overrides[get_portfolio_flow_reader] = lambda: object()
    app.dependency_overrides[get_rec_store] = lambda: object()
    app.dependency_overrides[get_wrapper_store] = lambda: None
    app.dependency_overrides[get_agent_config] = lambda: _config()

    resp = client.get("/portfolio", headers=NEAR_HEADERS)

    assert resp.status_code == 200
    body = resp.json()
    assert body["positions"] == []
    assert body["netWorthUsd"] == "0.00"
    assert body["dataSources"] == [{"source": "near", "status": "ok", "lastBlock": None}]


@pytest.mark.asyncio
async def test_near_reader_is_vaultless_and_chain_verification_is_skipped() -> None:
    request = SimpleNamespace(state=SimpleNamespace(account=_near_account()))

    reader = await build_vault_reader(request)  # type: ignore[arg-type]
    await require_verified_chain(request)  # type: ignore[arg-type]

    assert reader.vault_address is None


# ── the NEAR PORTFOLIO intent still shows the 072 multi-chain (NEAR/Rhea) rows ────


class _NearPortfolioService:
    """A stand-in for the 072 service: a NEAR/Rhea row, no EVM read."""

    async def read(self, wallet: str, *, focus: str = "all") -> PortfolioOverview:
        return PortfolioOverview(
            wallet=wallet,
            focus=focus,  # type: ignore[arg-type]
            as_of="2026-11-10T22:00:00+00:00",
            sections=(
                PortfolioSection(
                    key="rhea",
                    label="Rhea",
                    status="ok",
                    rows=(
                        PortfolioRow(
                            chain="near",
                            chain_label="NEAR",
                            protocol="rhea",
                            kind="lending_position",
                            symbol="USDC",
                            amount="0.4",
                            value_usd="0.40",
                            extra={"vaultName": "Rhea Lending USDC"},
                        ),
                    ),
                    source="rhea_rpc",
                ),
            ),
        )


class _PortfolioPlanner:
    async def classify(self, *_: Any, **__: Any) -> Intent:
        return Intent(kind=IntentKind.PORTFOLIO)


class _Unreachable:
    async def propose(self, *_: Any, **__: Any) -> Any:
        raise AssertionError("a NEAR portfolio turn must not reach the recommender")

    async def tip(self, *_: Any, **__: Any) -> Any:
        raise AssertionError("a NEAR portfolio turn must not reach literacy")

    async def read(self, chain: ChainContext) -> Any:
        raise AssertionError("the EVM vault portfolio provider must not be read for NEAR")

    async def active(self, chain: ChainContext) -> Any:
        return None


def _near_chain() -> ChainContext:
    return ChainContext(chain_id=84532, user_account=NEAR, owner=NEAR, auth_chain="near")


@pytest.mark.asyncio
async def test_near_portfolio_intent_routes_to_the_multichain_service() -> None:
    unreachable = _Unreachable()
    dag = CoordinatorDag(
        planner=_PortfolioPlanner(),
        recommender=unreachable,
        literacy=unreachable,
        portfolio_provider=unreachable,
        mandate_provider=unreachable,
        portfolio=_NearPortfolioService(),  # type: ignore[arg-type]
    )

    blocks = [block async for block in dag.run_chat("what is my portfolio", _near_chain())]
    wires = [block.to_wire() for block in blocks]

    assert "portfolio_overview" in {wire["type"] for wire in wires}
    section = next(w for w in wires if w["type"] == "portfolio_overview")
    assert section["sections"][0]["key"] == "rhea"
    assert section["sections"][0]["rows"][0]["chain"] == "near"
    assert "EVM wallets" not in "\n".join(w.get("markdown", "") for w in wires)


@pytest.mark.asyncio
async def test_near_multichain_phrase_routes_to_the_multichain_service() -> None:
    unreachable = _Unreachable()
    dag = CoordinatorDag(
        planner=_PortfolioPlanner(),
        recommender=unreachable,
        literacy=unreachable,
        portfolio_provider=unreachable,
        mandate_provider=unreachable,
        portfolio=_NearPortfolioService(),  # type: ignore[arg-type]
    )

    blocks = [
        block
        async for block in dag.run_chat("what is my multi-chain portfolio?", _near_chain())
    ]
    wires = [block.to_wire() for block in blocks]
    assert "portfolio_overview" in {wire["type"] for wire in wires}
