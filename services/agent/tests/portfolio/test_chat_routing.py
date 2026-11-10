# ruff: noqa: S101
"""072 — chat routing, precedence and the portfolio_overview wire shape."""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.coordinator.chat_blocks import EarnPositionsBlock, PortfolioOverviewBlock
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    PortfolioView,
)
from sparkpoint_agent.earn.config import default_config as earn_config
from sparkpoint_agent.earn.service import EarnOutcome
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import CapHeadroom
from sparkpoint_agent.portfolio.chat import build_outcome, detect_portfolio_focus
from sparkpoint_agent.portfolio.models import PortfolioOverview

from .helpers import row, section

OWNER = "0x2222222222222222222222222222222222222222"
BIG = 10**15


class _StructuredLlm:
    def __init__(self, intent: Intent | None) -> None:
        self.intent = intent
        self.calls = 0

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.calls += 1
        return StructuredResult(ok=True, value=self.intent)


class _CompleteLlm:
    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text="ok", stop_reason="end_turn")


class _PortfolioProvider:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView()


class _Mandate:
    async def active(self, chain: ChainContext) -> None:
        return None


class _PortfolioService:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def read(self, wallet: str, *, focus: str = "all") -> PortfolioOverview:
        self.calls.append((wallet, focus))
        return PortfolioOverview(
            wallet=wallet,
            focus=focus,  # type: ignore[arg-type]
            as_of="2026-11-01T00:00:00+00:00",
            sections=(
                section("balances", rows=(row(),), source="rpc"),
                section("morpho", source="morpho_api"),
                section("kamino", status="not_linked", reason="link a Solana address"),
                section("rhea", source="rhea_rpc"),
                section("swaps", source="db"),
            ),
        )


class _EarnService:
    feature_enabled = True
    config = earn_config()

    async def rhea_positions(self, *, wallet: str) -> EarnOutcome:
        return EarnOutcome(
            text="You don't have a Rhea account yet.",
            block=EarnPositionsBlock(
                state="empty",
                app_url="https://app.rhea.finance/lending",
                explainer="No Rhea account yet.",
            ),
        )


def _dag(
    *,
    intent: Intent | None = None,
    portfolio: _PortfolioService | None = None,
    earn: Any = None,
    planner_llm: _StructuredLlm | None = None,
) -> CoordinatorDag:
    llm = planner_llm or _StructuredLlm(intent)
    return CoordinatorDag(
        planner=Planner(llm=llm),  # type: ignore[arg-type]
        recommender=Recommender(llm=_StructuredLlm(None)),  # type: ignore[arg-type]
        literacy=Literacy(llm=_CompleteLlm()),  # type: ignore[arg-type]
        portfolio_provider=_PortfolioProvider(),  # type: ignore[arg-type]
        mandate_provider=_Mandate(),  # type: ignore[arg-type]
        portfolio=portfolio,  # type: ignore[arg-type]
        earn=earn,
        id_factory=lambda: "rec_1",
    )


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=OWNER,
        owner=OWNER,
        resolved_targets={"sparkpoint_vault": "0x" + "1" * 40},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
    )


async def _wires(dag: CoordinatorDag, message: str) -> list[dict[str, Any]]:
    return [block.to_wire() async for block in dag.run_chat(message, _chain())]


@pytest.mark.parametrize(
    ("message", "focus"),
    [
        ("show my portfolio", "all"),
        ("show me my portfolio", "all"),
        ("what is my multi-chain portfolio?", "all"),
        ("what's my multichain portfolio?", "all"),
        ("show me my multi chain portfolio", "all"),
        ("what is my portfolio across all chains?", "all"),
        ("what do I have across chains", "all"),
        ("my balances", "all"),
        ("show me my balances", "all"),
        ("show my positions everywhere", "all"),
        ("my swap history", "swaps"),
        ("show me my cross-chain swaps", "swaps"),
        ("how much am I earning", "earn"),
        ("what am I earning?", "earn"),
    ],
)
def test_detects_the_portfolio_prompts(message: str, focus: str) -> None:
    assert detect_portfolio_focus(message) == focus


@pytest.mark.parametrize(
    "message",
    [
        "what is my portfolio worth right now?",
        "what's in my wallet?",
        "show me my portfolio performance",
        "Show my portfolio and then swap ETH",
        "How should I rebalance my portfolio?",
        "my Rhea positions",
        "show my Rhea positions",
        "my NEAR yield",
        "swap 100 USDC to SOL",
        "deposit 100 USDC into Morpho",
        "how much USDC do I have",
        "what's my balance",
        "portfolio advice please",
    ],
)
def test_never_hijacks_other_routes(message: str) -> None:
    assert detect_portfolio_focus(message) is None


@pytest.mark.asyncio
async def test_show_my_portfolio_emits_the_overview_without_the_planner() -> None:
    service = _PortfolioService()
    llm = _StructuredLlm(Intent(kind=IntentKind.PORTFOLIO))
    dag = _dag(portfolio=service, planner_llm=llm)
    wires = await _wires(dag, "show my portfolio")
    kinds = [wire["type"] for wire in wires]
    assert "portfolio_overview" in kinds
    assert "portfolio_snapshot" not in kinds
    block = next(wire for wire in wires if wire["type"] == "portfolio_overview")
    assert block["focus"] == "all"
    assert len(block["sections"]) == 5
    assert "text" not in block
    assert service.calls == [(OWNER, "all")]
    # The real planner was available but never consulted: this route is deterministic.
    assert llm.calls == 0


@pytest.mark.asyncio
async def test_multichain_portfolio_question_uses_the_aggregation() -> None:
    service = _PortfolioService()
    wires = await _wires(_dag(portfolio=service), "what is my multi-chain portfolio?")
    block = next(wire for wire in wires if wire["type"] == "portfolio_overview")
    assert block["focus"] == "all"
    assert len(block["sections"]) == 5
    assert service.calls == [(OWNER, "all")]


async def test_swap_history_uses_the_swaps_focus() -> None:
    service = _PortfolioService()
    wires = await _wires(_dag(portfolio=service), "my swap history")
    block = next(wire for wire in wires if wire["type"] == "portfolio_overview")
    assert block["focus"] == "swaps"
    text = next(wire for wire in wires if wire["type"] == "text")
    assert "cross-chain swaps" in text["markdown"].lower()
    assert service.calls == [(OWNER, "swaps")]


@pytest.mark.asyncio
async def test_vault_specific_portfolio_question_keeps_the_snapshot_route() -> None:
    service = _PortfolioService()
    dag = _dag(intent=Intent(kind=IntentKind.PORTFOLIO), portfolio=service)
    wires = await _wires(dag, "what is my portfolio worth right now?")
    kinds = [wire["type"] for wire in wires]
    assert "portfolio_snapshot" in kinds
    assert "portfolio_overview" not in kinds
    assert service.calls == []


@pytest.mark.asyncio
async def test_rhea_positions_keep_the_earn_route() -> None:
    service = _PortfolioService()
    dag = _dag(portfolio=service, earn=_EarnService())
    wires = await _wires(dag, "my Rhea positions")
    kinds = [wire["type"] for wire in wires]
    assert "earn_positions" in kinds
    assert "portfolio_overview" not in kinds
    assert service.calls == []


def test_block_wire_is_camel_case_and_never_signable() -> None:
    overview = PortfolioOverview(
        wallet=OWNER,
        focus="all",
        as_of="2026-11-01T00:00:00+00:00",
        sections=(section("balances", rows=(row(),), source="rpc"),),
    )
    block = build_outcome(overview, "all").block
    wire = block.to_wire()
    assert wire["type"] == "portfolio_overview"
    assert wire["asOf"] == "2026-11-01T00:00:00+00:00"
    assert isinstance(block, PortfolioOverviewBlock)
    assert "policy" not in wire
    assert "proposedAction" not in wire
    assert "text" not in wire
    assert wire["sections"][0]["rows"][0]["priceSource"] == "stablecoin_par"
