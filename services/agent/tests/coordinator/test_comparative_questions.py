# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism in pytest)
"""063 — comparative / "X vs Y" / "safer than" questions are grounded knowledge answers.

Before 063 the empty-wallet yield composer owned "Compare that with just keeping it in Aave";
with no position it prepended "there's nothing for a mandate to apply to", so a genuine
Morpho-vs-Aave risk question got canned yield copy (and the runner-up was an unhelpful tip).
These tests pin the route: no planner, no action, no yield/mandate copy, and a Sparky prose turn
that receives the retrieved protocol facts (plus the recent conversation for a deictic follow-up).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Sequence
from typing import Any

import pytest

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.coordinator.chat_blocks import ProseDelta, TextBlock, TipBlock
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.coordinator.guidance import (
    is_comparative_question,
    is_yield_guidance_question,
)
from sparkpoint_agent.knowledge import Passage
from sparkpoint_agent.llm import LlmResult, StreamChunk, StructuredResult
from sparkpoint_agent.policy import CapHeadroom
from sparkpoint_agent.wire import Citation

USER = "0x2222222222222222222222222222222222222222"
OWNER = "0x3333333333333333333333333333333333333333"
VAULT = "0x1111111111111111111111111111111111111111"
BIG = 10**15

ANSWER = (
    "Both carry Aave's lending-market risk. Aave is one large pool, while a Morpho-based "
    "curated vault adds curator and isolated-market risk, so neither is automatically safer."
)


class _RecordingLlm:
    """Records every prose system/user prompt; routes the planner to a fixed intent."""

    def __init__(self, intent: Intent | None = None) -> None:
        self._intent = intent or Intent(kind=IntentKind.LEARN, topic="morpho_vs_aave")
        self.structured_calls = 0
        self.systems: list[str] = []
        self.user_contents: list[str] = []

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.structured_calls += 1
        return StructuredResult(ok=True, value=self._intent)

    async def complete(self, **kwargs: Any) -> LlmResult:
        self._remember(kwargs)
        return LlmResult(text=ANSWER, stop_reason="end_turn")

    async def stream_complete(self, **kwargs: Any) -> AsyncIterator[StreamChunk]:
        self._remember(kwargs)
        words = ANSWER.split(" ")
        yield StreamChunk(delta=" ".join(words[:4]) + " ")
        yield StreamChunk(delta=" ".join(words[4:]))
        yield StreamChunk(result=LlmResult(text=ANSWER, stop_reason="end_turn"))

    def _remember(self, kwargs: dict[str, Any]) -> None:
        self.systems.append(str(kwargs.get("system") or ""))
        messages = kwargs.get("messages") or []
        if messages:
            self.user_contents.append(str(messages[-1].get("content") or ""))


class _Grounder:
    """Returns one protocol-fact passage and remembers the retrieval query."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        self.queries.append(query)
        return (
            Passage(
                content=(
                    "GROUNDING-SENTINEL: Aave is one shared lending market; a Morpho-based "
                    "curated vault adds curator and isolated-market risk."
                ),
                citation=Citation(
                    provider="docs",
                    endpoint="morpho-vs-aave",
                    field="risk",
                    value="curated",
                    as_of="2026-10-27",
                    stale=False,
                ),
            ),
        )


class _Portfolio:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView(net_worth_usd="0.00", idle_usdc=0)


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return None


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=OWNER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        market=MarketData(gross_apy_bps=421, projected_apy_bps=379, performance_fee_bps=1000),
    )


def _dag(llm: Any, knowledge: Any) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=llm),
        recommender=Recommender(llm=llm),
        literacy=Literacy(llm=llm),
        sparky=Sparky(llm=llm),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(),
        knowledge=knowledge,
        streaming=True,
        single_call=True,
    )


async def _collect(
    dag: CoordinatorDag,
    message: str,
    *,
    history: Sequence[tuple[str, str]] | None = None,
) -> list[Any]:
    return [block async for block in dag.run_chat(message, _chain(), history=history)]


@pytest.mark.parametrize(
    "message",
    [
        "Is Morpho safer than Aave?",
        "Morpho vs Aave — which is safer?",
        "Which is safer, Morpho or Aave?",
        "Compare keeping USDC in Aave with the Sparky vault.",
        "How does Morpho compare with Aave for risk?",
        "Compare that with just keeping it in Aave.",
    ],
)
async def test_comparative_questions_route_to_grounded_sparky(message: str) -> None:
    llm = _RecordingLlm()
    grounder = _Grounder()
    blocks = await _collect(_dag(llm, grounder), message)

    assert llm.structured_calls == 0, "a comparison is not a planner/action turn"
    assert grounder.queries, "grounding is retrieved for the comparison"
    assert any("GROUNDING-SENTINEL" in prompt for prompt in llm.user_contents)
    assert "COMPARE" in llm.systems[-1]
    assert any(isinstance(block, ProseDelta) for block in blocks)
    text = next(block for block in blocks if isinstance(block, TextBlock))
    assert text.markdown == ANSWER
    assert not any(isinstance(block, TipBlock) for block in blocks)
    wire_types = {
        block.to_wire()["type"] for block in blocks if not isinstance(block, ProseDelta)
    }
    assert not (wire_types & {"action", "recommendation", "tip", "error"})
    visible = text.markdown.lower()
    assert "nothing for a mandate" not in visible
    assert "you don't have a position yet" not in visible


async def test_comparative_followup_gets_the_recent_conversation_and_grounds_on_it() -> None:
    llm = _RecordingLlm()
    grounder = _Grounder()
    history = [
        ("user", "How does the Aave USDC yield work?"),
        ("assistant", "Aave is a shared lending pool; suppliers earn the variable supply rate."),
    ]
    blocks = await _collect(
        _dag(llm, grounder),
        "Compare that with just keeping it in Aave.",
        history=history,
    )
    prompt = llm.user_contents[-1]
    assert "RECENT_CONVERSATION" in prompt
    assert "Aave USDC yield" in prompt, "the follow-up can resolve what 'that' refers to"
    assert "Aave USDC yield" in grounder.queries[-1], "retrieval is deictic-aware"
    assert any(isinstance(block, TextBlock) for block in blocks)


async def test_comparative_that_is_also_a_command_still_reaches_the_planner() -> None:
    """The action half must never be dropped: an explicit command keeps the normal path."""
    llm = _RecordingLlm(Intent(kind=IntentKind.OTHER))
    await _collect(
        _dag(llm, _Grounder()),
        "Compare Aave and Morpho, then deposit 500 USDC into the safer one.",
    )
    assert llm.structured_calls == 1


@pytest.mark.parametrize(
    "message",
    [
        "what is Aave?",
        "how does Morpho work?",
        "withdraw 100 USDC from my vault",
        "swap 1 ETH to USDG",
        "what's the best way to earn with my USDC?",
    ],
)
def test_ordinary_questions_are_not_comparative(message: str) -> None:
    assert is_comparative_question(message) is False


@pytest.mark.parametrize(
    "message",
    [
        "Is Morpho safer than Aave?",
        "Morpho vs Aave",
        "compare that with Aave",
        "Aave versus Morpho",
        "which is riskier, Aave or Morpho?",
        "is Aave more risky than Morpho?",
    ],
)
def test_comparison_shapes_are_recognised(message: str) -> None:
    assert is_comparative_question(message) is True


def test_comparisons_are_not_yield_guidance_even_with_aave_and_history() -> None:
    """The composer owns estimates, not risk comparisons; its canned empty-wallet lead-in is not
    an answer. This is the predicate-level guard behind the DAG route."""
    for message in (
        "Compare that with just keeping it in Aave.",
        "Is Morpho safer than Aave?",
        "which is safer, Aave or Morpho?",
    ):
        assert is_comparative_question(message) is True
        assert is_yield_guidance_question(message) is False
