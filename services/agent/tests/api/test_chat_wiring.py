# ruff: noqa: S101, SLF001  (pytest asserts; exercising the module-private wiring on purpose)
"""§R5 A1 — the REAL chat providers + the cause-split BUILD_ACTION refusal (hermetic, no network).

Proves the /chat DAG now reads a real vault position + idle USDC (not the old $0.00 stub), resolves
the deployed vault target so a whitelisted deposit can build, and splits the no-candidate refusal by
cause ("not supported on this network" vs "couldn't build") instead of one byte-identical string.
"""

from __future__ import annotations

import re
from types import SimpleNamespace
from typing import Any, cast

import pytest

from sparkpoint_agent.api.chat import (
    _MemorySink,
    _NoopMemorySink,
    _VaultChatChainProvider,
    _VaultChatPortfolioProvider,
    get_chat_vault_reader,
    get_coordinator_dag,
    get_memory_sink,
)
from sparkpoint_agent.api.main import app
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
        fee_bps: int = 1000, unavailable: bool = False, native: int = 0,
        native_unavailable: bool = False, token_balances: dict[str, int] | None = None,
    ) -> None:
        self._shares = shares
        self._pps = pps
        self._idle = idle
        self._total = total_assets
        self._fee = fee_bps
        self._unavailable = unavailable
        # 029 — the wallet side. ``token_balances`` keys are lower-case token addresses; anything
        # not listed answers with ``idle`` (the pre-029 behaviour for the vault's USDC asset).
        self._native = native
        self._native_unavailable = native_unavailable
        self._token_balances = {k.lower(): v for k, v in (token_balances or {}).items()}

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
        if token.lower() in self._token_balances:
            return self._token_balances[token.lower()]
        return self._idle

    async def native_balance(self, owner: str) -> int:
        self._guard()
        if self._native_unavailable:
            raise VaultUnavailable(VaultUnavailableReason.RPC_UNREACHABLE, "test: native read down")
        return self._native

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
    dag = get_coordinator_dag(_FakeReader(), _config(), _NoMandate(), None)  # type: ignore[arg-type]
    assert dag.sparky is not None, "the /chat DAG must wire the general/identity responder"
    assert dag.sparky.persona_provider is get_persona
    # …and it shares the SAME persona surface as the literacy agent (one voice, one source).
    assert dag.literacy.persona_provider is get_persona


# ── 027 · Wave 4 — the memory sink is wired in PRODUCTION ──────────────────────


def test_chat_wires_the_real_pg_backed_memory_sink(monkeypatch: pytest.MonkeyPatch) -> None:
    """``get_memory_sink`` must return the REAL, store-backed sink.

    A regression to a no-op here is invisible at runtime — chat keeps working perfectly and
    simply never remembers anything, which is exactly the bug feature 027 exists to fix. The
    database handle is stubbed so this stays hermetic (no pool, no DATABASE_URL).
    """
    monkeypatch.setattr("sparkpoint_agent.api.chat.get_database", lambda: object())
    sink = get_memory_sink()
    assert isinstance(sink, _MemorySink)
    assert not isinstance(sink, _NoopMemorySink), "the production sink must not be the test no-op"


def test_the_memory_endpoints_are_registered_and_session_scoped() -> None:
    # /memory/self + /memory/clear must exist (the Settings card is useless without them), and
    # NOTHING under /admin may read another user's memory — there is deliberately no admin path.
    paths = set(app.openapi()["paths"])
    assert "/memory/self" in paths
    assert "/memory/clear" in paths
    assert not any(p.startswith("/admin") and "memory" in p for p in paths)


# ── 029/FR-004 · the WALLET side of the portfolio read ──────────────────────────


@pytest.mark.asyncio
async def test_wallet_read_surfaces_native_and_srk_balances(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The Aug-3 tester's actual wallet: 0.0084 ETH + 6,000 SRK + 50 idle USDC. Before 029 the
    # answer to "what's in my wallet?" mentioned none of the first two.
    srk = "0x2dF900000000000000000000000000000000dD52"
    monkeypatch.setenv("SRK_ADDRESS_84532", srk)
    reader = _FakeReader(
        shares=250_000_000,
        idle=50_000_000,
        native=8_400_000_000_000_000,
        token_balances={srk: 6_000 * 10**18},
    )
    view = await _VaultChatPortfolioProvider(reader, _config()).read(await _chain(reader))

    assert view.native_wei == 8_400_000_000_000_000
    assert view.native_symbol == "ETH"
    assert [(t.symbol, t.raw, t.decimals) for t in view.tokens] == [("SRK", 6_000 * 10**18, 18)]
    # Neither is USD-valued: net worth stays vault + idle USDC only (no ETH/SRK price feed).
    assert view.net_worth_usd == "300.00"


@pytest.mark.asyncio
async def test_no_srk_env_means_no_token_line_not_an_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SRK_ADDRESS_84532", raising=False)
    reader = _FakeReader(shares=250_000_000, idle=50_000_000, native=1)
    view = await _VaultChatPortfolioProvider(reader, _config()).read(await _chain(reader))
    assert view.tokens == ()
    assert view.positions, "the vault position is unaffected by a chain without SRK"


@pytest.mark.asyncio
async def test_a_native_read_outage_costs_one_line_not_the_whole_answer(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("SRK_ADDRESS_84532", raising=False)
    reader = _FakeReader(shares=250_000_000, idle=50_000_000, native_unavailable=True)
    view = await _VaultChatPortfolioProvider(reader, _config()).read(await _chain(reader))
    assert view.native_wei is None
    assert view.stale is False, "a native outage must NOT mark the vault position stale"
    assert view.net_worth_usd == "300.00"
    assert len(view.positions) == 2


@pytest.mark.asyncio
async def test_a_zero_srk_balance_is_omitted_rather_than_reported_as_zero(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    srk = "0x2dF900000000000000000000000000000000dD52"
    monkeypatch.setenv("SRK_ADDRESS_84532", srk)
    reader = _FakeReader(idle=0, token_balances={srk: 0})
    view = await _VaultChatPortfolioProvider(reader, _config()).read(await _chain(reader))
    assert view.tokens == ()


@pytest.mark.asyncio
async def test_chat_chain_context_carries_the_live_rate(monkeypatch: pytest.MonkeyPatch) -> None:
    """029/FR-006 — chat must be able to quote the APY, not only decline to.

    The chat context provider built its ChainContext WITHOUT `gross_bps`, so `market.gross_apy_bps`
    was always None and "what's the current APY?" could only answer "I can't read it right now" —
    while /recommendations, built from the same helpers, was quoting a real figure at the same
    moment. Verified live on alpha before this fix.
    """
    from sparkpoint_agent.api import chat as chat_mod

    async def _fake_rate(_config: AgentConfig) -> int:
        return 44

    monkeypatch.setattr(chat_mod, "_read_aave_gross_bps", _fake_rate)
    reader = _FakeReader(shares=0, idle=0, fee_bps=1000)
    provider = chat_mod._VaultChatChainProvider(reader, _config())
    chain = await provider.context(_account(), surface="chat")

    assert chain.market.gross_apy_bps == 44
    # Net = gross × (1 − fee). 44 bps at a 10% performance fee ⇒ 40 bps, rounded, exact ints.
    assert chain.market.projected_apy_bps == 40
    assert chain.market.performance_fee_bps == 1000


@pytest.mark.asyncio
async def test_an_unreadable_rate_leaves_the_context_honest(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sparkpoint_agent.api import chat as chat_mod

    async def _no_rate(_config: AgentConfig) -> None:
        return None

    monkeypatch.setattr(chat_mod, "_read_aave_gross_bps", _no_rate)
    provider = chat_mod._VaultChatChainProvider(_FakeReader(), _config())
    chain = await provider.context(_account(), surface="chat")
    assert chain.market.gross_apy_bps is None
    assert chain.market.projected_apy_bps is None, "never derive a projection from nothing"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("chain_id", "rpc_env"),
    [(8453, "BASE_MAINNET_RPC_URL"), (4663, "ROBINHOOD_MAINNET_RPC_URL")],
)
async def test_chat_reader_degrades_a_missing_rpc_instead_of_503(
    monkeypatch: pytest.MonkeyPatch, chain_id: int, rpc_env: str
) -> None:
    """1110 — a chain with no read RPC must not cost the whole chat turn its answer.

    Construction used to raise RPC_UNREACHABLE before FastAPI entered the route (a 503 on every
    turn). The chat reader now returns a fail-closed reader; each read degrades to
    VaultUnavailable, which the portfolio/gate providers already handle per section. 8453 has no
    public default (023 fail-closed), so Base relies on this degradation when its RPC is unset.
    """
    monkeypatch.setenv("CHAIN_ID", str(chain_id))
    monkeypatch.delenv(rpc_env, raising=False)
    monkeypatch.delenv("SPARKPOINT_RPC_URL", raising=False)
    request = SimpleNamespace(state=SimpleNamespace(account=_account(chain_id=chain_id)))
    reader = await get_chat_vault_reader(cast(Any, request), None)
    with pytest.raises(VaultUnavailable) as excinfo:
        await reader.token_balance_of(USDC, OWNER)
    assert excinfo.value.reason is VaultUnavailableReason.RPC_UNREACHABLE
