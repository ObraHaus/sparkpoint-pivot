"""Deterministic fixtures for the Sparky evals.

The eval DAG is the REAL ``CoordinatorDag`` — the same routing, policy gate and block
assembly the product runs. Only the two edges that would otherwise make the suite slow or
nondeterministic are replaced:

* the LLM transport (a canned double offline; the real gateway client in live mode);
* the chain/DB reads (a small, fixed portfolio + curated record + changelog).

Nothing here can sign, send or widen policy: the DAG still calls ``policy.evaluate`` for
every candidate, exactly as it does in production.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import httpx

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.coordinator.chat_blocks import PositionLite
from sparkpoint_agent.coordinator.curated import CuratedContext, CuratedPick
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.crosschain.config import load_config
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.crosschain.service import CrossChainService
from sparkpoint_agent.earn.config import default_config as earn_config
from sparkpoint_agent.earn.registry import EarnRegistry, EarnSnapshot, VaultAsset, VaultEntry
from sparkpoint_agent.earn.service import EarnService
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.persona import get_persona
from sparkpoint_agent.policy import ActionType, Asset, CapHeadroom, RiskProfile

from .model import Case, Scripted

VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15

PICK = CuratedPick(
    address="0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    label="Gauntlet USDC Prime",
    net_apy_bps=441,
    tvl_usd=420_747_952.0,
    curator="Gauntlet",
    curator_verified=True,
    reason="Highest screen score.",
    as_of="2026-09-18T00:05:00+00:00",
    wrapped=False,
)
CURATED = CuratedContext(vault_count=1, pick=PICK, vaults=(PICK,))
MARKET = MarketData(gross_apy_bps=421, projected_apy_bps=379, performance_fee_bps=1000)

CHANGELOG: tuple[Mapping[str, Any], ...] = (
    {
        "title": "Sparky answers the awkward questions instead of hitting a dead end",
        "publishedAt": "2026-10-27T11:00:00Z",
        "tag": "Improved",
    },
    {
        "title": "A degraded answer no longer costs a question",
        "publishedAt": "2026-10-26T09:00:00Z",
        "tag": "Fixed",
    },
)

_GENERAL_PROSE = (
    "I'm Sparky, SparkPoint's non-custodial assistant. I can explain DeFi, read your "
    "portfolio, and prepare moves for you to sign, but I never move your funds."
)
_KNOWLEDGE_PROSE = (
    "Here's a plain-language explanation of the concept. It is informational only, returns "
    "can vary, and nothing here is financial advice."
)


@dataclass(frozen=True)
class WalletFixture:
    portfolio: PortfolioView
    mandate: MandateView | None


def wallet_fixture(name: str) -> WalletFixture:
    """The three wallet states the audit and the suite exercise."""
    if name == "with_position":
        return WalletFixture(
            portfolio=PortfolioView(
                positions=(
                    PositionLite(
                        venue="SparkPoint Vault",
                        asset="USDC",
                        value_usd="250.00",
                    ),
                    PositionLite(
                        venue="Wallet (idle)",
                        asset="USDC",
                        value_usd="5000.00",
                    ),
                ),
                net_worth_usd="5250.00",
                idle_usdc=5_000_000_000,
            ),
            mandate=None,
        )
    if name == "with_mandate":
        return WalletFixture(
            portfolio=PortfolioView(
                net_worth_usd="5000.00",
                idle_usdc=5_000_000_000,
            ),
            mandate=MandateView(version=1, risk_profile=RiskProfile.CONSERVATIVE),
        )
    return WalletFixture(
        portfolio=PortfolioView(net_worth_usd="0.00", idle_usdc=0),
        mandate=None,
    )


def chain_context(chain_id: int = 8453) -> ChainContext:
    targets = {"sparkpoint_vault": VAULT} if chain_id == 8453 else {}
    return ChainContext(
        chain_id=chain_id,
        user_account=USER,
        owner=USER,
        resolved_targets=targets,
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        market=MARKET,
    )


class _Portfolio:
    def __init__(self, view: PortfolioView) -> None:
        self._view = view

    async def read(self, chain: ChainContext) -> PortfolioView:
        return self._view


class _Mandate:
    def __init__(self, view: MandateView | None) -> None:
        self._view = view

    async def active(self, chain: ChainContext) -> MandateView | None:
        return self._view


class _Curated:
    async def __call__(self, chain_id: int) -> CuratedContext:
        return CURATED


async def _changelog() -> Sequence[Mapping[str, Any]]:
    return CHANGELOG


class _FakeLlm:
    """Canned LLM double for the offline run — no network, no randomness."""

    def __init__(self, scripted: Scripted) -> None:
        self._scripted = scripted
        self.systems: list[str] = []

    async def structured(self, *, system: str = "", messages: Any = None, **_: Any) -> Any:
        if "intent classifier" in system:
            return StructuredResult(ok=True, value=_intent(self._scripted.intent))
        if "strategy recommender" in system:
            # ``None`` makes the recommender use its deterministic template ranking.
            return StructuredResult(ok=True, value=None)
        return StructuredResult(ok=True, value=_intent(self._scripted.intent))

    async def complete(self, *, system: str = "", messages: Any = None, **_: Any) -> LlmResult:
        self.systems.append(system)
        if self._scripted.prose:
            text = self._scripted.prose
        elif "financial-literacy tutor" in system:
            text = _KNOWLEDGE_PROSE
        else:
            text = _GENERAL_PROSE
        return LlmResult(text=text, stop_reason="end_turn")


def _intent(raw: Mapping[str, Any] | None) -> Intent:
    if not raw:
        return Intent(kind=IntentKind.OTHER)
    try:
        kind = IntentKind(str(raw.get("kind", "other")))
    except ValueError:
        kind = IntentKind.OTHER
    action_raw = raw.get("actionType")
    asset_raw = raw.get("asset")
    amount_raw = raw.get("amount")
    return Intent(
        kind=kind,
        action_type=ActionType(str(action_raw)) if action_raw else None,
        asset=Asset(str(asset_raw)) if asset_raw else None,
        amount=int(amount_raw) if amount_raw is not None else None,
        topic=str(raw["topic"]) if raw.get("topic") else None,
    )


def _id_factory() -> Any:
    counter = {"value": 0}

    def next_id() -> str:
        counter["value"] += 1
        return f"rec_eval_{counter['value']}"

    return next_id


_CROSSCHAIN_OUTPUTS: Mapping[str, tuple[str, str, str, str, int]] = {
    # destination-asset marker -> (amountOut, formatted, USD, minOut, eta seconds)
    "btc": ("6439596", "0.06439596", "4986.69", "6375200", 480),
    "sol": ("425000000", "0.425", "50.00", "420000000", 120),
    "base-": ("24900000", "24.9", "24.90", "24775500", 300),
    "hood-": ("24900000", "24.9", "24.90", "24775500", 300),
    "eth-": ("24900000", "24.9", "24.90", "24775500", 300),
}


def _crosschain_quote(marker: str, amount: str) -> dict[str, Any]:
    amount_out, formatted, usd, min_out, eta = _CROSSCHAIN_OUTPUTS.get(
        marker, ("1000000", "1.0", "1.00", "990000", 300)
    )
    return {
        "quote": {
            "amountIn": amount,
            "amountInFormatted": amount,
            "amountInUsd": "100.00",
            "amountOut": amount_out,
            "amountOutFormatted": formatted,
            "amountOutUsd": usd,
            "minAmountOut": min_out,
            "timeEstimate": eta,
        },
        "quoteRequest": {"deadline": "2026-10-31T12:30:00.000Z"},
        "signature": "ed25519:eval-fixture",
    }


def _crosschain_handler(mode: str) -> Any:
    """A canned 1Click transport: dry quotes only, or a deterministic connect error."""

    def handler(request: httpx.Request) -> httpx.Response:
        if mode == "transport_error":
            raise httpx.ConnectError("offline", request=request)
        body = json.loads(request.content)
        destination = str(body.get("destinationAsset", ""))
        marker = next((key for key in _CROSSCHAIN_OUTPUTS if key in destination), "")
        return httpx.Response(201, json=_crosschain_quote(marker, str(body.get("amount", "0"))))

    return handler


def _crosschain_service(mode: str) -> CrossChainService:
    """Build the real service around the fake transport (``disabled`` keeps the pre-068 path)."""
    # Pin the flag explicitly: the eval must not inherit CROSSCHAIN_ENABLED from the shell.
    config = replace(load_config(env={}), feature_enabled=mode != "disabled")
    client = OneClickClient(
        transport=httpx.MockTransport(_crosschain_handler(mode)),
        clock=lambda: 1000.0,
    )
    return CrossChainService(config, client)


RHEA_TOKEN_ID = (  # noqa: S105 - a public NEAR token id, not a secret
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"  # noqa: S105
)
RHEA_ASSET_ID = f"nep141:{RHEA_TOKEN_ID}"

_EARN_VAULTS = (
    VaultEntry(
        chain="base",
        chain_id=8453,
        address="0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
        version="v1",
        name="Gauntlet USDC Prime",
        symbol="GTUSDC",
        asset=VaultAsset(
            address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol="USDC", decimals=6
        ),
        listed=True,
        tvl_usd=Decimal("420747952"),
        net_apy=Decimal("0.0441"),
        fetched_at="2026-11-01T00:00:00+00:00",
    ),
    VaultEntry(
        chain="base",
        chain_id=8453,
        address="0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
        version="v1",
        name="Moonwell Flagship USDC",
        symbol="MWUSDC",
        asset=VaultAsset(
            address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol="USDC", decimals=6
        ),
        listed=True,
        tvl_usd=Decimal("150000000"),
        net_apy=Decimal("0.0612"),
        fetched_at="2026-11-01T00:00:00+00:00",
    ),
    VaultEntry(
        chain="sol",
        chain_id=0,
        address="DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
        version="kvault",
        name="SOL Balanced",
        symbol="kV",
        asset=VaultAsset(
            address="So11111111111111111111111111111111111111112", symbol="SOL", decimals=9
        ),
        listed=True,
        tvl_usd=Decimal("2443425.6"),
        net_apy=Decimal("0.0445"),
        fetched_at="2026-11-01T00:00:00+00:00",
        protocol="kamino",
    ),
    VaultEntry(
        chain="near",
        chain_id=0,
        address=RHEA_TOKEN_ID,
        version="lending",
        name="Rhea Lending USDC",
        symbol="USDC",
        asset=VaultAsset(address=RHEA_TOKEN_ID, symbol="USDC", decimals=6),
        listed=True,
        tvl_usd=Decimal("12733803.14"),
        net_apy=Decimal("0.1405"),
        fetched_at="2026-11-01T00:00:00+00:00",
        protocol="rhea",
    ),
)


class _EvalRheaViews:
    """A fixed Rhea view double: no wallet has an MCA in the eval fixture."""

    async def mca_for_wallet(self, wallet: str) -> str | None:
        return None

    async def create_mca_fee(self) -> dict[str, str]:
        return {RHEA_TOKEN_ID: "300000"}

    async def asset(self, token_id: str) -> Mapping[str, Any]:
        return {
            "supplied": {"balance": "12733763455236751230092183"},
            "config": {"extra_decimals": 12},
            "supply_apr": "0.140459036159116681312316847",
        }

    async def positions(self, account_id: str) -> Mapping[str, Any] | None:
        return None


def _earn_service(mode: str) -> EarnService:
    """A real 069 service over a FIXED snapshot; no Morpho/1Click network call is made."""
    config = earn_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn-eval.json")
    registry.install(
        EarnSnapshot(
            fetched_at=datetime.now(UTC),
            source="morpho_api",
            vaults=_EARN_VAULTS,
        )
    )

    kv_receipt = config.receipt_for_symbol("kV-gtSOLb")

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body.get("destinationAsset") == RHEA_ASSET_ID:
            return httpx.Response(
                201,
                json={
                    "quote": {
                        "amountIn": "100000000",
                        "amountInFormatted": "100",
                        "amountInUsd": "100.0",
                        "amountOut": "99980800",
                        "amountOutFormatted": "99.9808",
                        "amountOutUsd": "99.9808",
                        "minAmountOut": "98980992",
                        "timeEstimate": 35,
                    },
                    "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
                    "signature": "ed25519:test",
                },
            )
        if kv_receipt is not None and body.get("destinationAsset") == kv_receipt.asset_id:
            return httpx.Response(
                201,
                json={
                    "quote": {
                        "amountIn": "100000000",
                        "amountInFormatted": "100",
                        "amountInUsd": "100.0",
                        "amountOut": "983500000",
                        "amountOutFormatted": "0.9835",
                        "amountOutUsd": "99.2",
                        "minAmountOut": "970000000",
                        "timeEstimate": 47,
                    },
                    "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
                    "signature": "ed25519:test",
                },
            )
        return httpx.Response(400, json={"message": "No liquidity available"})

    return EarnService(
        config,
        registry,
        oneclick=OneClickClient(transport=httpx.MockTransport(handler), clock=lambda: 1000.0),
        rhea_views=_EvalRheaViews(),  # type: ignore[arg-type]
    )


def build_dag(
    *,
    case: Case,
    client: Any,
    live: bool,
    streaming: bool = False,
    single_call: bool = False,
) -> CoordinatorDag:
    """Build the real DAG around the canned/real LLM and fixed read fixtures.

    ``streaming`` / ``single_call`` mirror the 059 deployment flags; both default to OFF so the
    offline golden run is the exact pre-059 path unless a caller explicitly exercises a combo.

    A case with a ``crosschain`` key gets a real :class:`CrossChainService` wired to a canned
    1Click transport (no network). Cases without the key keep ``crosschain=None`` — byte-for-byte
    the pre-068 DAG, so existing golden routes cannot move.
    """
    fixture = wallet_fixture(case.wallet)
    persona = get_persona if live else (lambda: "")
    crosschain = _crosschain_service(case.crosschain) if case.crosschain else None
    earn = _earn_service(case.earn) if case.earn else None
    return CoordinatorDag(
        planner=Planner(llm=client),
        recommender=Recommender(llm=client),
        literacy=Literacy(llm=client, persona_provider=persona),
        sparky=Sparky(llm=client, persona_provider=persona),
        portfolio_provider=_Portfolio(fixture.portfolio),
        mandate_provider=_Mandate(fixture.mandate),
        curated=_Curated(),
        changelog=_changelog,
        knowledge=None,
        streaming=streaming,
        single_call=single_call,
        id_factory=_id_factory(),
        crosschain=crosschain,
        earn=earn,
    )


class RecordingClient:
    """Wraps the real gateway client to remember infra failures per case.

    The agents deliberately swallow upstream errors (a general question must not 500 a
    chat turn), so without this the runner cannot tell a flaky gateway from a wrong answer.
    """

    def __init__(self, inner: Any) -> None:
        self._inner = inner
        self.errors: list[BaseException] = []

    async def complete(self, **kwargs: Any) -> Any:
        try:
            return await self._inner.complete(**kwargs)
        except BaseException as exc:  # noqa: BLE001 - recorded, then re-raised for the agent
            self.errors.append(exc)
            raise

    async def structured(self, **kwargs: Any) -> Any:
        try:
            return await self._inner.structured(**kwargs)
        except BaseException as exc:  # noqa: BLE001 - recorded, then re-raised for the agent
            self.errors.append(exc)
            raise


__all__ = [
    "CHANGELOG",
    "CURATED",
    "MARKET",
    "RecordingClient",
    "USER",
    "VAULT",
    "WalletFixture",
    "build_dag",
    "chain_context",
    "wallet_fixture",
]
