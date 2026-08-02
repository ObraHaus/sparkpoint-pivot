# ruff: noqa: S101, SLF001  (pytest asserts; exercising the module-private wiring on purpose)
"""§R5 A1 — the REAL chat providers + the cause-split BUILD_ACTION refusal (hermetic, no network).

Proves the /chat DAG now reads a real vault position + idle USDC (not the old $0.00 stub), resolves
the deployed vault target so a whitelisted deposit can build, and splits the no-candidate refusal by
cause ("not supported on this network" vs "couldn't build") instead of one byte-identical string.
"""

from __future__ import annotations

import re

import pytest

from sparkpoint_agent.api.chat import (
    _VaultChatChainProvider,
    _VaultChatPortfolioProvider,
    get_coordinator_dag,
)
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.chain import VaultUnavailable, VaultUnavailableReason
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.coordinator.dag import _build_action_refusal
from sparkpoint_agent.llm import API_KEY_ENV
from sparkpoint_agent.persona import get_persona
from sparkpoint_agent.policy import ActionType

OWNER = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"
VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
USDC = "0xba50Cd2A20f6DA35D788639E581bca8d0B5d4D5f"


class _FakeReader:
    """A structural VaultReader stand-in for both chat providers (no network)."""

    def __init__(
        self, *, shares: int = 0, pps: int = 10**18, idle: int = 0, total_assets: int = 0,
        fee_bps: int = 1000, unavailable: bool = False,
    ) -> None:
        self._shares = shares
        self._pps = pps
        self._idle = idle
        self._total = total_assets
        self._fee = fee_bps
        self._unavailable = unavailable

    def _guard(self) -> None:
        if self._unavailable:
            raise VaultUnavailable(VaultUnavailableReason.NOT_DEPLOYED, "test: unavailable")

    async def balance_of(self, owner: str) -> int:
        self._guard()
        return self._shares

    async def convert_to_assets(self, shares: int) -> int:
        self._guard()
        return shares * self._pps // 10**18

    async def asset(self) -> str:
        self._guard()
        return USDC

    async def token_balance_of(self, token: str, owner: str) -> int:
        self._guard()
        return self._idle

    async def total_assets(self) -> int:
        self._guard()
        return self._total

    async def performance_fee_bps(self) -> int:
        self._guard()
        return self._fee


def _account(chain_id: int = 84532) -> AccountContext:
    return AccountContext(account=OWNER, owner=OWNER, chain_id=chain_id)


def _config() -> AgentConfig:
    return AgentConfig(chain_id=84532, rpc_url=None, vault_address=VAULT, database_url=None)


@pytest.mark.asyncio
async def test_chat_portfolio_reads_real_position_and_idle() -> None:
    # 250 USDC in the vault (pps 1e18 ⇒ underlying == shares in 6dp scale) + 50 idle in the wallet.
    reader = _FakeReader(shares=250_000_000, idle=50_000_000)
    provider = _VaultChatPortfolioProvider(reader, _config())
    view = await provider.read(await _chain(reader))
    assert view.stale is False
    assert view.idle_usdc == 50_000_000
    assert len(view.positions) == 2  # vault position + idle wallet USDC (its own row)
    assert view.positions[0].venue == "SparkPoint Vault"
    assert view.positions[0].value_usd == "250.00"
    assert view.positions[1].venue == "Wallet (idle)"
    assert view.positions[1].asset == "USDC"
    assert view.positions[1].value_usd == "50.00"
    assert view.net_worth_usd == "300.00"  # 250 vault + 50 idle


@pytest.mark.asyncio
async def test_chat_portfolio_idle_only_shows_as_position() -> None:
    # No vault shares yet, only idle USDC → the card still shows the idle row (never empty).
    reader = _FakeReader(shares=0, idle=25_000_000)
    provider = _VaultChatPortfolioProvider(reader, _config())
    view = await provider.read(await _chain(reader))
    assert len(view.positions) == 1
    assert view.positions[0].venue == "Wallet (idle)"
    assert view.positions[0].value_usd == "25.00"
    assert view.idle_usdc == 25_000_000


_USD_STRING_RE = re.compile(r"^-?\d+(\.\d+)?$")  # mirrors the shared wire UsdStringSchema regex


@pytest.mark.asyncio
async def test_chat_portfolio_valueusd_has_no_thousands_comma() -> None:
    # A position >= $1,000 must serialize valueUsd WITHOUT a grouping comma, else the strict shared
    # UsdStringSchema rejects it and the web fail-closes the portfolio_snapshot to an inert card.
    reader = _FakeReader(shares=12_500_000_000, idle=3_000_000_000)  # $12,500 vault + $3,000 idle
    provider = _VaultChatPortfolioProvider(reader, _config())
    view = await provider.read(await _chain(reader))
    assert view.positions[0].value_usd == "12500.00"
    assert view.positions[1].value_usd == "3000.00"
    for pos in view.positions:
        assert "," not in pos.value_usd
        assert _USD_STRING_RE.match(pos.value_usd), pos.value_usd


@pytest.mark.asyncio
async def test_chat_portfolio_fails_closed_on_outage() -> None:
    provider = _VaultChatPortfolioProvider(_FakeReader(unavailable=True), _config())
    view = await provider.read(await _chain(_FakeReader()))
    assert view.stale is True
    assert view.positions == ()
    assert view.idle_usdc is None  # never a fabricated balance


@pytest.mark.asyncio
async def test_chat_chain_provider_resolves_vault_target() -> None:
    # The chain provider must inject the deployed vault so a deposit can build (the stub didn't).
    chain = await _chain(_FakeReader())
    assert chain.resolved_targets.get("sparkpoint_vault") == VAULT
    assert chain.chain_id == 84532


async def _chain(reader: _FakeReader):
    return await _VaultChatChainProvider(reader, _config()).context(_account(), surface="chat")


def test_refusal_swap_on_base_points_to_swap_page() -> None:
    # AERODROME_SWAP is fork-only, but the manual Uniswap /swap page is live on Base Sepolia →
    # point the user to the Swap page rather than a flat "not supported".
    msg = _build_action_refusal(84532, ActionType.AERODROME_SWAP)
    assert "Swap page" in msg
    assert "Uniswap" in msg
    assert "aren't supported" not in msg.lower()


def test_refusal_swap_on_robinhood_points_to_swap_page() -> None:
    # The manual Uniswap-fork (Synthra V3) Swap page is now live on Robinhood testnet (46630) too,
    # so
    # a swap there points to the Swap page like Base (007: swaps on every supported network).
    msg = _build_action_refusal(46630, ActionType.AERODROME_SWAP)
    assert "Swap page" in msg
    assert "aren't supported" not in msg.lower()


def test_refusal_split_deposit_is_build_message() -> None:
    # VAULT_DEPOSIT is on the 84532 allowlist → a no-candidate case is "couldn't build".
    msg = _build_action_refusal(84532, ActionType.VAULT_DEPOSIT)
    assert "couldn't build" in msg.lower()
    assert "supported on" not in msg.lower()


# ── 025 · Task 1 — the general/identity responder is wired in PRODUCTION ────────


class _NoMandate:
    async def active(self, chain: object) -> None:
        return None


def test_chat_dag_wires_the_persona_bearing_general_responder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The /chat DAG MUST carry a Sparky whose persona provider is the real ``get_persona``.

    ``CoordinatorDag.sparky`` defaults to ``None`` (so ``/recommendations`` need not build a prose
    agent it never reaches), and a ``None`` responder silently reinstates the static help line —
    exactly the "who are you?" bug 025 fixes. This pins the production wiring so that regression
    cannot happen quietly.
    """
    monkeypatch.setenv(API_KEY_ENV, "sk-ant-test-not-a-real-key")
    dag = get_coordinator_dag(_FakeReader(), _config(), _NoMandate())  # type: ignore[arg-type]
    assert dag.sparky is not None, "the /chat DAG must wire the general/identity responder"
    assert dag.sparky.persona_provider is get_persona
    # …and it shares the SAME persona surface as the literacy agent (one voice, one source).
    assert dag.literacy.persona_provider is get_persona
