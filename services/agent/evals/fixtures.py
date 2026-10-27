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

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

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


def build_dag(
    *,
    case: Case,
    client: Any,
    live: bool,
) -> CoordinatorDag:
    """Build the real DAG around the canned/real LLM and fixed read fixtures."""
    fixture = wallet_fixture(case.wallet)
    persona = get_persona if live else (lambda: "")
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
        id_factory=_id_factory(),
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
