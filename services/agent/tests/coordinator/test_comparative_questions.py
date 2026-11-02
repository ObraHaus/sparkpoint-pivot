# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism in pytest)
"""063 — comparative / "X vs Y" / "safer than" questions are grounded knowledge answers.

Before 063 the empty-wallet yield composer owned "Compare that with just keeping it in Aave";
with no position it prepended "there's nothing for a mandate to apply to", so a genuine
Morpho-vs-Aave risk question got canned yield copy (and the runner-up was an unhelpful tip).
These tests pin the route: no planner, no action, no yield/mandate copy, and a Sparky prose turn
that receives the retrieved protocol facts (plus the recent conversation for a deictic follow-up).
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator, Sequence
from typing import Any

import pytest

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.coordinator import comparative
from sparkpoint_agent.coordinator.chat_blocks import (
    CitationBlock,
    ProseDelta,
    TextBlock,
    TipBlock,
)
from sparkpoint_agent.coordinator.dag import (
    _COMPARATIVE_MAX_PASSAGES,
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
    _comparative_citable_passages,
    _comparative_failure_reason,
    _is_comparative_servable,
    _is_whole_answer_refusal,
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


def _dag(llm: Any, knowledge: Any, *, streaming: bool = True) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=llm),
        recommender=Recommender(llm=llm),
        literacy=Literacy(llm=llm),
        sparky=Sparky(llm=llm),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(),
        knowledge=knowledge,
        streaming=streaming,
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
        "Compare keeping USDC in Aave with Morpho.",
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
    assert "BOTTOM LINE" in llm.systems[-1], "the only model text is the closing trade-off"
    assert not any(isinstance(block, ProseDelta) for block in blocks), (
        "comparative turns are one final text block, in both streaming modes"
    )
    text = next(block for block in blocks if isinstance(block, TextBlock))
    assert "**What it is**" in text.markdown
    assert "**Bottom line**" in text.markdown
    assert "**Aave**" in text.markdown
    assert "**Morpho**" in text.markdown or "**Aave**" in text.markdown
    assert not any(isinstance(block, TipBlock) for block in blocks)
    wire_types = {block.to_wire()["type"] for block in blocks if not isinstance(block, ProseDelta)}
    assert not (wire_types & {"action", "recommendation", "tip", "error"})
    visible = text.markdown.lower()
    assert "nothing for a mandate" not in visible
    assert "you don't have a position yet" not in visible


@pytest.mark.parametrize(
    "message",
    [
        "Morpho or Aave?",
        "should I put my USDC in Rhea or Aave?",
    ],
)
async def test_protocol_choice_questions_take_the_comparative_branch(message: str) -> None:
    """smoke-1102c: "X or Y?" is a choice question, not a deposit/action the planner can drop."""
    llm = _RecordingLlm()
    grounder = _Grounder()
    blocks = await _collect(_dag(llm, grounder), message)

    assert llm.structured_calls == 0, "a protocol choice is not a planner/action turn"
    assert grounder.queries, "grounding is retrieved for the choice"
    text = next(block for block in blocks if isinstance(block, TextBlock))
    visible = text.markdown.lower()
    assert "i don't have a move i can build" not in visible
    assert not any(isinstance(block, TipBlock) for block in blocks)


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
    assert "RECENT CONVERSATION" in prompt
    assert "Aave USDC yield" in prompt, "the follow-up can resolve what 'that' refers to"
    assert "Aave USDC yield" in grounder.queries[-1], "retrieval is deictic-aware"
    assert any(isinstance(block, TextBlock) for block in blocks)


DEFLECTION = (
    "I don’t have details on Morpho or Aave safety in my reference notes, so I can’t compare "
    "their risk profiles or fee structures directly."
)


class _DeflectingLlm:
    """The beta failure (065): a valid model turn that narrates its own notes.

    It is rejected by the shared META guard, which used to be reported to the user as
    ``UPSTREAM_UNAVAILABLE``. Counts prose calls so the regression also pins that a comparative
    content rejection is NOT retried (the honest fallback is immediate), for streaming AND off.
    """

    def __init__(self) -> None:
        self.structured_calls = 0
        self.complete_calls = 0
        self.stream_calls = 0

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.structured_calls += 1
        return StructuredResult(ok=True, value=Intent(kind=IntentKind.LEARN, topic="x"))

    async def complete(self, **_: Any) -> LlmResult:
        self.complete_calls += 1
        return LlmResult(text=DEFLECTION, stop_reason="end_turn")

    async def stream_complete(self, **_: Any) -> AsyncIterator[StreamChunk]:
        self.stream_calls += 1
        yield StreamChunk(delta=DEFLECTION[:48])
        yield StreamChunk(delta=DEFLECTION[48:])
        yield StreamChunk(result=LlmResult(text=DEFLECTION, stop_reason="end_turn"))


class _ExplodingProseLlm:
    def __init__(self) -> None:
        self.structured_calls = 0
        self.calls = 0

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.structured_calls += 1
        return StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER))

    async def complete(self, **_: Any) -> LlmResult:
        self.calls += 1
        raise RuntimeError("gateway down")

    async def stream_complete(self, **_: Any) -> AsyncIterator[StreamChunk]:
        self.calls += 1
        raise RuntimeError("gateway down")
        yield StreamChunk()  # pragma: no cover — unreachable, keeps this an async generator


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
        "Move everything from Aave or Morpho into the SparkPoint vault?",
        "deposit my entire balance into Morpho or Aave, whichever is safer?",
        "move all my USDC from Aave or Morpho?",
        "please deposit into Morpho or Aave?",
        "lend on Rhea or Aave, whichever is better?",
    ],
)
async def test_unsized_imperative_or_choice_does_not_take_the_comparative_branch(
    message: str,
) -> None:
    """075 Defender: the action must stay on the planner path, never a prose-only comparison."""
    llm = _RecordingLlm(Intent(kind=IntentKind.OTHER))
    grounder = _Grounder()
    blocks = await _collect(_dag(llm, grounder), message)
    assert not _is_prose_only_comparison(llm, grounder)
    if llm.structured_calls:
        assert llm.structured_calls == 1, "the planner/action path owns the turn"
    else:
        text = "\n".join(block.markdown for block in blocks if isinstance(block, TextBlock))
        assert "not a financial adviser" in text, "the deterministic action boundary answers"


@pytest.mark.parametrize(
    "message",
    [
        "deposit my entire balance into whichever is safer than Aave",
        "move everything to whatever is better than Aave",
        "withdraw from Aave if Morpho is safer",
    ],
)
async def test_comparative_with_an_action_verb_but_no_amount_is_never_prose_only(
    message: str,
) -> None:
    """Defender medium: an unparseable amount must not silently drop the requested action."""
    llm = _RecordingLlm(Intent(kind=IntentKind.OTHER))
    grounder = _Grounder()
    blocks = await _collect(_dag(llm, grounder), message)
    assert not _is_prose_only_comparison(llm, grounder)
    if llm.structured_calls:
        assert llm.structured_calls == 1, "the planner/action path owns the turn"
    else:
        text = "\n".join(block.markdown for block in blocks if isinstance(block, TextBlock))
        assert "not a financial adviser" in text, "the deterministic allocation boundary answers"
        assert "mandate" in text, "the boundary offers the clarifying next step"


def _is_prose_only_comparison(llm: _RecordingLlm, grounder: _Grounder) -> bool:
    return bool(grounder.queries) and not llm.structured_calls


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
        "Is Morpho better than Aave?",
    ],
)
def test_comparison_shapes_are_recognised(message: str) -> None:
    assert is_comparative_question(message) is True


@pytest.mark.parametrize(
    "message",
    [
        "Morpho or Aave?",
        "Aave or Morpho for USDC?",
        "Aave or Compound for USDC?",
        "compound or aave?",
        "COMPOUND or Aave?",
        "should I put my USDC in Rhea or Aave?",
        "where should I lend USDC, Rhea or Aave?",
    ],
)
def test_protocol_choice_questions_are_comparative(message: str) -> None:
    assert is_comparative_question(message) is True


@pytest.mark.parametrize(
    "message",
    [
        "Move everything from Aave or Morpho into the SparkPoint vault?",
        "deposit my entire balance into Morpho or Aave, whichever is safer?",
        "move all my USDC from Aave or Morpho?",
        "please deposit into Morpho or Aave?",
        "lend on Rhea or Aave, whichever is better?",
    ],
)
def test_unsized_imperative_or_choice_keeps_the_planner(message: str) -> None:
    """075 Defender: a "?" is not enough to turn an unsized command into advice."""
    assert is_comparative_question(message) is False


@pytest.mark.parametrize(
    "message",
    [
        "deposit 500 USDC into Morpho",
        "swap 50 USDC to SOL",
        "lend USDC on Rhea",
        "earn on USDC with Morpho",
        "Morpho or Aave, deposit 500 USDC into the safer one",
        "Should I compound my earnings weekly or monthly on Aave?",
        "Should I park cash in T-bills while the yield curve is inverted, or in Aave?",
        "auto-compound my rewards or move them to Aave?",
    ],
)
def test_sized_or_single_protocol_turns_are_not_comparative(message: str) -> None:
    assert is_comparative_question(message) is False


def test_bare_better_than_in_an_action_turn_is_not_a_comparative_question() -> None:
    assert is_comparative_question("move everything to whatever is better than Aave") is False


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


# ── 066 · per-entity grounding, honest partial coverage, no citation on a non-answer ──────


class _AnswerLlm:
    """Returns one fixed reply (streaming or not) and records the prompt it was given.

    On the 074 path the ONLY prose call is the closing Bottom line, so this double stands in for
    the model's one-sentence trade-off. Tests use it to prove the skeleton never depends on it.
    """

    def __init__(self, answer: str) -> None:
        self.answer = answer
        self.systems: list[str] = []
        self.user_contents: list[str] = []
        self.complete_calls = 0
        self.stream_calls = 0

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        raise AssertionError("a comparative turn must not call the planner")

    async def complete(self, **kwargs: Any) -> LlmResult:
        self.complete_calls += 1
        self._remember(kwargs)
        return LlmResult(text=self.answer, stop_reason="end_turn")

    async def stream_complete(self, **kwargs: Any) -> AsyncIterator[StreamChunk]:
        self.stream_calls += 1
        self._remember(kwargs)
        yield StreamChunk(delta=self.answer[:48])
        yield StreamChunk(delta=self.answer[48:])
        yield StreamChunk(result=LlmResult(text=self.answer, stop_reason="end_turn"))

    def _remember(self, kwargs: dict[str, Any]) -> None:
        self.systems.append(str(kwargs.get("system") or ""))
        messages = kwargs.get("messages") or []
        if messages:
            self.user_contents.append(str(messages[-1].get("content") or ""))


class _SubjectGrounder:
    """A fake corpus keyed by protocol: only a query that NAMES a protocol retrieves its note."""

    def __init__(self, docs: dict[str, str]) -> None:
        self.docs = docs
        self.queries: list[str] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        self.queries.append(query)
        lowered = query.lower()
        return tuple(
            Passage(
                content=text,
                citation=Citation(
                    provider=name,
                    endpoint=f"obsidian://{name.lower()}",
                    field="risk",
                    value=name,
                    as_of="2026-10-29T00:00:00Z",
                    stale=False,
                ),
            )
            for name, text in self.docs.items()
            if name.lower() in lowered
        )


AAVE_DOC = (
    "AAVE-GROUNDING: Aave is a shared lending pool. Suppliers earn a variable rate driven by "
    "utilisation; risk is concentrated in one market and the contracts, and it is not insured."
)
MORPHO_DOC = (
    "MORPHO-GROUNDING: Morpho is a framework of isolated markets and curated vaults. A curator "
    "adds allocation and liquidity risk on top of the market risk; it is not insured."
)
COMPOUND_DOC = (
    "COMPOUND-GROUNDING: Compound is a shared-pool lending protocol governed by its token "
    "holders. It carries contract, governance and market risk, and it is not insured."
)
LIDO_DOC = (
    "LIDO-GROUNDING: Lido is liquid staking for Ethereum; the liquid staking token can trade "
    "below the value of the underlying ETH and the position is not insured."
)

TRADEOFF = (
    "The trade-off is structural rather than a ranking, so the fit depends on which risks you "
    "can tolerate."
)
DETERMINISTIC = "The trade-off is structural rather than a ranking"


def _citations(blocks: Sequence[Any]) -> list[dict[str, Any]]:
    return [b.to_wire() for b in blocks if isinstance(b, CitationBlock)]


def _text(blocks: Sequence[Any]) -> str:
    return next(b.markdown for b in blocks if isinstance(b, TextBlock))


def _bottom(text: str) -> str:
    return text.split("**Bottom line**", 1)[1].strip()


@pytest.mark.parametrize("streaming", [False, True])
async def test_comparative_uses_a_code_authored_skeleton_for_every_subject(
    streaming: bool,
) -> None:
    llm = _AnswerLlm(TRADEOFF)
    grounder = _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC})
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    text = _text(blocks)
    assert "**What it is**" in text
    assert "**How the yield is made**" in text
    assert "**Main risks**" in text
    assert "**Fees & structure**" in text
    assert "**Aave**" in text and "**Morpho**" in text
    assert _bottom(text) == TRADEOFF
    assert "Aave" in grounder.queries and "Morpho" in grounder.queries
    assert not any(isinstance(block, TipBlock) for block in blocks)
    wire_types = {block.to_wire()["type"] for block in blocks if not isinstance(block, ProseDelta)}
    assert not (wire_types & {"action", "recommendation", "tip", "error"})
    assert "nothing for a mandate" not in text.lower()
    assert "you don't have a position yet" not in text.lower()
    assert llm.stream_calls == 0, "a comparative turn has no prose deltas"


@pytest.mark.parametrize("streaming", [False, True])
async def test_skeleton_is_identical_across_runs_and_only_the_bottom_line_moves(
    streaming: bool,
) -> None:
    grounder = _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC})
    first = _text(
        await _collect(
            _dag(_AnswerLlm("Trade-off number one."), grounder, streaming=streaming),
            "Is Morpho safer than Aave?",
        )
    )
    second = _text(
        await _collect(
            _dag(
                _AnswerLlm("A completely different closing sentence."),
                grounder,
                streaming=streaming,
            ),
            "Is Morpho safer than Aave?",
        )
    )
    assert first.split("**Bottom line**")[0] == second.split("**Bottom line**")[0]
    assert _bottom(first) == "Trade-off number one."
    assert _bottom(second) == "A completely different closing sentence."


@pytest.mark.parametrize("streaming", [False, True])
async def test_comparative_retrieves_each_named_subject_separately(streaming: bool) -> None:
    llm = _AnswerLlm(TRADEOFF)
    grounder = _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC})
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    assert "Morpho" in grounder.queries and "Aave" in grounder.queries
    cited = _citations(blocks)
    assert len(cited) == 1
    providers = {source["provider"] for source in cited[0]["sources"]}
    assert providers == {"Aave", "Morpho"}


@pytest.mark.parametrize("streaming", [False, True])
async def test_one_sided_coverage_is_served_but_never_cites_a_partial_set(
    streaming: bool,
) -> None:
    llm = _AnswerLlm(TRADEOFF)
    grounder = _SubjectGrounder({"Aave": AAVE_DOC})
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Compare Compound and Aave for a beginner.",
    )
    text = _text(blocks)
    assert "**Compound**" in text and "**Aave**" in text
    assert "no retrieved source material for Compound" in text
    assert _citations(blocks) == [], "never cite a partial set"


@pytest.mark.parametrize("streaming", [False, True])
async def test_neither_side_grounded_is_still_structured_and_uncited(streaming: bool) -> None:
    llm = _AnswerLlm(TRADEOFF)
    blocks = await _collect(
        _dag(llm, _SubjectGrounder({}), streaming=streaming),
        "Which is riskier, Lido or Rocket Pool?",
    )
    text = _text(blocks)
    assert "**Lido**" in text and "**Rocket Pool**" in text
    assert "no retrieved source material for Lido and Rocket Pool" in text
    assert _citations(blocks) == [], "a no-data answer must not look sourced"


@pytest.mark.parametrize("streaming", [False, True])
async def test_unknown_subject_is_named_as_unverified_and_known_subjects_stay(
    streaming: bool,
) -> None:
    llm = _AnswerLlm(TRADEOFF)
    grounder = _SubjectGrounder({"Aave": AAVE_DOC})
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Compare Yearn and Aave for a beginner.",
    )
    text = _text(blocks)
    assert "SparkPoint has no verified material for Yearn" in text
    assert "**Aave**" in text
    assert text.count("**Yearn**") == 1, "an unknown subject is named once, never described"
    assert _citations(blocks) == []


@pytest.mark.parametrize("streaming", [False, True])
async def test_zero_known_subjects_keeps_the_honest_fallback(streaming: bool) -> None:
    llm = _AnswerLlm(TRADEOFF)
    blocks = await _collect(
        _dag(llm, _EveryQueryGrounder(), streaming=streaming),
        "Compare them for a cautious user.",
    )
    text = _text(blocks)
    assert "I can't rank" in text
    assert "**What it is**" not in text
    assert _citations(blocks) == []
    assert llm.complete_calls == 0, "the zero-known fallback is code-authored"


@pytest.mark.parametrize("streaming", [False, True])
async def test_deictic_followup_resolves_the_missing_side_from_history(
    streaming: bool,
) -> None:
    llm = _AnswerLlm(TRADEOFF)
    history = [
        ("user", "Tell me about the SparkPoint Vault."),
        ("assistant", "It routes USDC into Aave v3 through an ERC-4626 wrapper."),
    ]
    grounder = _SubjectGrounder({"Aave": AAVE_DOC})
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Compare that with keeping it in Aave.",
        history=history,
    )
    text = _text(blocks)
    assert "**SparkPoint Vault**" in text and "**Aave**" in text
    assert "RECENT CONVERSATION" in llm.user_contents[-1], "history still resolves 'that'"
    assert "SparkPoint Vault" in grounder.queries[-1], "retrieval is deictic-aware"
    assert "Aave" in grounder.queries[-1]


@pytest.mark.parametrize("streaming", [False, True])
async def test_model_bottom_line_is_used_when_it_is_a_plain_tradeoff(
    streaming: bool,
) -> None:
    blocks = await _collect(
        _dag(
            _AnswerLlm(TRADEOFF),
            _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}),
            streaming=streaming,
        ),
        "Is Morpho safer than Aave?",
    )
    assert _bottom(_text(blocks)) == TRADEOFF


META_BOTTOM = "Based on the reference notes I was given, the two options differ in structure."
REFUSAL_BOTTOM = "I'm not able to compare Morpho and Aave from the data I have."
VERDICT_BOTTOM = "Aave is safer than Morpho because its APY is 4.41%."


@pytest.mark.parametrize(
    "answer",
    ["", META_BOTTOM, REFUSAL_BOTTOM, VERDICT_BOTTOM, "I can't rank Morpho and Aave."],
)
@pytest.mark.parametrize("streaming", [False, True])
async def test_a_bad_bottom_line_falls_back_to_the_deterministic_one(
    answer: str, streaming: bool
) -> None:
    blocks = await _collect(
        _dag(
            _AnswerLlm(answer),
            _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}),
            streaming=streaming,
        ),
        "Is Morpho safer than Aave?",
    )
    text = _text(blocks)
    assert "**Bottom line**" in text
    assert DETERMINISTIC in text
    assert "reference notes" not in text.lower()
    assert "4.41%" not in text
    assert "Aave is safer" not in text


@pytest.mark.parametrize("streaming", [False, True])
async def test_bottom_line_upstream_failure_still_serves_the_skeleton(streaming: bool) -> None:
    blocks = await _collect(
        _dag(
            _ExplodingProseLlm(),
            _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}),
            streaming=streaming,
        ),
        "Is Morpho safer than Aave?",
    )
    wires = [b.to_wire() for b in blocks if not isinstance(b, ProseDelta)]
    assert not [w for w in wires if w["type"] == "error"], (
        "the comparison still answers when only the Bottom line call fails"
    )
    text = _text(blocks)
    assert "**What it is**" in text
    assert DETERMINISTIC in text


@pytest.mark.parametrize("streaming", [False, True])
async def test_meta_shaped_comparative_answer_gets_honest_prose_not_upstream_error(
    streaming: bool,
) -> None:
    llm = _DeflectingLlm()
    blocks = await _collect(
        _dag(llm, _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}), streaming=streaming),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    wires = [b.to_wire() for b in blocks if not isinstance(b, ProseDelta)]
    assert not [w for w in wires if w["type"] == "error"], (
        "a content-guard rejection is not an upstream outage"
    )
    text = next(w for w in wires if w["type"] == "text")["markdown"]
    assert "**Aave**" in text and "**Morpho**" in text
    assert "reference notes" not in text.lower()
    assert "couldn't reach my model" not in text.lower()
    assert llm.complete_calls == 1, "the Bottom line is the only prose call"
    assert llm.stream_calls == 0, "comparative turns do not stream deltas"


class _ReleaseNoteGrounder:
    """Returns release-note chunks that NAME the protocols — the exact 065 failure shape."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        self.queries.append(query)
        return (
            Passage(
                content=(
                    "Comparison questions get a real answer instead of a retry error. Asking "
                    'Sparky to compare two options — for example "Is Morpho safer than Aave?" — '
                    "…"
                ),
                citation=Citation(
                    provider="Comparison questions get a real answer · SparkPoint release note",
                    endpoint="obsidian://changelog-comparative-answers-065-2026-10",
                    field="Comparison questions get a real answer instead of a retry error",
                    value="release note",
                    as_of="2026-10-29T00:00:00Z",
                    stale=False,
                ),
            ),
        )


async def test_release_notes_that_name_the_protocols_are_not_protocol_grounding() -> None:
    llm = _AnswerLlm(TRADEOFF)
    blocks = await _collect(
        _dag(llm, _ReleaseNoteGrounder()),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    text = _text(blocks)
    assert "**Aave**" in text and "**Morpho**" in text
    assert "release note" not in text.lower()
    assert _citations(blocks) == []


# ── 067 predicates kept (they are shared pure helpers, not the served-answer path) ──


class _WholeMessageOnlyGrounder:
    """Per-subject queries miss; only the whole-message query returns a note naming both."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        self.queries.append(query)
        lowered = query.lower()
        if "morpho" in lowered and "aave" in lowered:
            return (
                Passage(
                    content=(
                        "WHOLE-MESSAGE-GROUNDING: Aave is one shared lending pool; Morpho is a "
                        "framework of isolated markets and curated vaults, so curator and "
                        "market-isolation risk are added. Neither is insured."
                    ),
                    citation=Citation(
                        provider="docs",
                        endpoint="obsidian://protocol-basics",
                        field="risk",
                        value="structural",
                        as_of="2026-10-29T00:00:00Z",
                        stale=False,
                    ),
                ),
            )
        return ()


class _EveryQueryGrounder:
    """Returns a note naming both subjects for ANY query (the deictic whole-message path)."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        self.queries.append(query)
        return (
            Passage(
                content=(
                    "DEICTIC-GROUNDING: Aave is one shared lending pool; Morpho is a framework "
                    "of isolated markets and curated vaults. Neither is insured."
                ),
                citation=Citation(
                    provider="docs",
                    endpoint="obsidian://protocol-basics",
                    field="risk",
                    value="structural",
                    as_of="2026-10-29T00:00:00Z",
                    stale=False,
                ),
            ),
        )


def _capped_passage(content: str, name: str, index: int) -> Passage:
    return Passage(
        content=content,
        citation=Citation(
            provider=name,
            endpoint=f"obsidian://{name}-{index}",
            field="risk",
            value=name,
            as_of="2026-10-29T00:00:00Z",
            stale=False,
        ),
    )


class _CapOverflowGrounder:
    """Per-subject retrieval overflows the passage cap, truncating the second subject away."""

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        lowered = query.lower()
        if "morpho" in lowered and "aave" not in lowered:
            return (
                _capped_passage(
                    "MORPHO-GROUNDING: Morpho uses isolated markets and curated vaults.",
                    "morpho",
                    0,
                ),
            )
        return tuple(
            _capped_passage(
                f"AAVE-GROUNDING {index}: Aave is one shared lending pool.",
                "aave",
                index,
            )
            for index in range(_COMPARATIVE_MAX_PASSAGES)
        )


def _log_lines(caplog: pytest.LogCaptureFixture) -> list[str]:
    return [
        record.getMessage()
        for record in caplog.records
        if "comparative_outcome" in record.getMessage()
    ]


#: A servable comparison: no refusal opener and every extracted subject is named.
BOTH_SUBJECTS_SUBSTANTIVE = (
    "Aave is one shared lending pool with market-wide risk, while Morpho uses isolated markets "
    "and adds curator risk; neither is insured."
)

#: Every explicit first-person refusal opener, with ASCII and curly apostrophes, plus the
#: connective / markdown / apology fashions the old startswith-only check served by mistake.
REFUSAL_ANSWERS = (
    "I can't rank Morpho and Aave.",
    "I cannot rank Morpho and Aave.",
    "I can not rank Morpho and Aave.",
    "I'm not able to rank Morpho and Aave.",
    "I am not able to rank Morpho and Aave.",
    "I'm unable to rank Morpho and Aave.",
    "I am unable to rank Morpho and Aave.",
    "I don't have enough to rank Morpho and Aave.",
    "I do not have enough to rank Morpho and Aave.",
    "I won't rank Morpho and Aave.",
    "I will not compare Morpho and Aave.",
    "I'd rather not compare Morpho and Aave.",
    "I shouldn't rank Morpho and Aave.",
    "I'm afraid I can't compare them.",
    "I’m not able to rank Morpho and Aave.",
    "I’m unable to rank Morpho and Aave.",
    "I don’t have enough to rank Morpho and Aave.",
    "I won’t rank Morpho and Aave.",
    "Unfortunately, I can't rank Morpho and Aave.",
    "But I can't rank Morpho and Aave.",
    "However, I can't rank them.",
    "Sorry, I can't rank Morpho and Aave.",
    "Sorry, I can't compare them.",
    "Apologies, I can't compare them.",
    "**I can't rank Morpho and Aave.**",
    "**I can't rank…**",
)


@pytest.mark.parametrize("answer", REFUSAL_ANSWERS)
def test_each_refusal_opener_is_a_whole_answer_refusal(answer: str) -> None:
    assert _is_whole_answer_refusal(answer) is True


def test_servable_requires_every_subject_and_no_refusal() -> None:
    assert _is_comparative_servable(BOTH_SUBJECTS_SUBSTANTIVE, ("Morpho", "Aave")) is True
    assert _is_comparative_servable("Aave is one shared pool.", ("Morpho", "Aave")) is False
    assert _is_comparative_servable("I can't rank Morpho and Aave.", ("Morpho", "Aave")) is False
    assert _is_comparative_servable("Compare them.", ()) is True


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("answer", REFUSAL_ANSWERS)
async def test_refusal_openers_are_never_used_as_the_bottom_line(
    streaming: bool, answer: str
) -> None:
    blocks = await _collect(
        _dag(
            _AnswerLlm(answer),
            _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}),
            streaming=streaming,
        ),
        "Is Morpho safer than Aave?",
    )
    text = _text(blocks)
    assert answer not in text
    assert DETERMINISTIC in text
    assert _citations(blocks) and len(_citations(blocks)) == 1


@pytest.mark.parametrize("streaming", [False, True])
async def test_third_party_unable_to_verify_bottom_line_is_served(streaming: bool) -> None:
    answer = "The oracle is unable to verify prices, but the structural trade-off still stands."
    llm = _AnswerLlm(answer)
    blocks = await _collect(
        _dag(
            llm,
            _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}),
            streaming=streaming,
        ),
        "Is Morpho safer than Aave?",
    )
    assert _bottom(_text(blocks)) == answer
    assert len(_citations(blocks)) == 1


def test_only_the_first_sentence_is_judged_for_refusal() -> None:
    """A refusal phrase after the first sentence does not make a substantive answer a refusal."""
    assert (
        _is_whole_answer_refusal(
            "Aave is one shared pool. I can't verify which is safer from the material here."
        )
        is False
    )
    assert _is_whole_answer_refusal("Aave is one pool, while I can't rank them.") is True


def test_no_and_unfortunately_openers_are_declines() -> None:
    """A leading "No,"/"Unfortunately," is enough to flag a decline."""
    from sparkpoint_agent.coordinator.dag import _is_decline

    assert _is_decline("No, that data is not available.") is True
    assert _is_decline("Unfortunately, the data is not available.") is True
    assert _is_decline("No, I can't compare them.") is True
    assert _is_decline("Unfortunately, I cannot compare them.") is True


def test_unusable_failure_maps_to_its_own_outcome_reason() -> None:
    assert _comparative_failure_reason("unusable") == "unusable"
    assert _comparative_failure_reason("something-else") == "non_answer"
    assert _comparative_failure_reason(None) == "non_answer"


@pytest.mark.parametrize("streaming", [False, True])
async def test_whole_message_hit_that_names_a_subject_counts_as_coverage(
    streaming: bool,
) -> None:
    """067 — coverage includes a whole-message hit that genuinely names a subject."""
    llm = _AnswerLlm(TRADEOFF)
    grounder = _WholeMessageOnlyGrounder()
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    assert _citations(blocks)
    assert {source["endpoint"] for source in _citations(blocks)[0]["sources"]} == {
        "obsidian://protocol-basics"
    }


@pytest.mark.parametrize("streaming", [False, True])
async def test_cap_is_allocated_round_robin_so_no_subject_is_truncated(streaming: bool) -> None:
    """One subject's overflow must not truncate the later subject to zero."""
    llm = _AnswerLlm(TRADEOFF)
    dag = _dag(llm, _CapOverflowGrounder(), streaming=streaming)
    passages, covered = await dag._ground_comparative("Compare Aave and Morpho", ("Aave", "Morpho"))
    assert len(passages) == _COMPARATIVE_MAX_PASSAGES
    assert covered == ("Aave", "Morpho"), "both subjects must survive the cap"
    assert any("MORPHO-GROUNDING" in passage.content for passage in passages)


class _ThreeSubjectOverflowGrounder:
    """Three named subjects each produce enough hits to overflow the passage cap together."""

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        lowered = query.lower()
        names = [name for name in ("Aave", "Morpho", "Compound") if name.lower() in lowered]
        if len(names) != 1:
            return ()
        name = names[0]
        return tuple(
            _capped_passage(
                f"{name.upper()}-GROUNDING {index}: {name} carries a distinct risk profile.",
                name.lower(),
                index,
            )
            for index in range(3)
        )


async def test_three_subject_cap_keeps_every_subject_with_hits_represented() -> None:
    """With 3 subjects (3x3 hits vs cap 8), round-robin keeps every covered subject represented."""
    llm = _AnswerLlm(TRADEOFF)
    dag = _dag(llm, _ThreeSubjectOverflowGrounder(), streaming=False)
    subjects = ("Aave", "Morpho", "Compound")
    passages, covered = await dag._ground_comparative("Compare Aave, Morpho and Compound", subjects)
    assert len(passages) == _COMPARATIVE_MAX_PASSAGES
    assert covered == subjects
    counts = {
        subject: sum(1 for passage in passages if subject.lower() in passage.content.lower())
        for subject in subjects
    }
    assert all(count >= 1 for count in counts.values()), counts
    assert all(count >= _COMPARATIVE_MAX_PASSAGES // len(subjects) for count in counts.values())


@pytest.mark.parametrize("streaming", [False, True])
async def test_served_comparative_logs_both_states(
    streaming: bool, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="sparkpoint_agent.coordinator.dag"):
        await _collect(
            _dag(
                _AnswerLlm(TRADEOFF),
                _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}),
                streaming=streaming,
            ),
            "Is Morpho safer than Aave?",
        )
    assert any("reason=served" in line and "cited=true" in line for line in _log_lines(caplog))

    caplog.clear()
    with caplog.at_level(logging.INFO, logger="sparkpoint_agent.coordinator.dag"):
        await _collect(
            _dag(
                _AnswerLlm(TRADEOFF),
                _SubjectGrounder({"Aave": AAVE_DOC}),
                streaming=streaming,
            ),
            "Is Morpho safer than Aave?",
        )
    assert any("reason=served" in line and "cited=false" in line for line in _log_lines(caplog))


@pytest.mark.parametrize("streaming", [False, True])
async def test_zero_known_logs_non_answer_without_content(
    streaming: bool, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="sparkpoint_agent.coordinator.dag"):
        await _collect(
            _dag(_AnswerLlm(TRADEOFF), _SubjectGrounder({}), streaming=streaming),
            "Compare them for a cautious user.",
        )
    lines = _log_lines(caplog)
    assert lines
    assert "reason=non_answer" in lines[-1] and "cited=false" in lines[-1]
    assert "Compare them" not in lines[-1]


def test_proper_noun_fallback_drops_all_caps_grammar_and_question_words() -> None:
    """The fallback must not return AND/OR/NOT/VS or Does/Should/... as "subjects"."""
    from sparkpoint_agent.coordinator.comparative import extract_comparison_subjects

    assert extract_comparison_subjects("Compare AND OR NOT VS") == ()
    assert (
        extract_comparison_subjects("Should Does Would Can Has When Which What Is Are How compare?")
        == ()
    )
    assert extract_comparison_subjects("Compare Yearn with something.") == ("Yearn",)


def test_subject_extraction_is_word_bounded_and_preserves_message_order() -> None:
    from sparkpoint_agent.coordinator.comparative import extract_comparison_subjects

    assert extract_comparison_subjects("Which is riskier, Lido or Rocket Pool?") == (
        "Lido",
        "Rocket Pool",
    )
    assert extract_comparison_subjects("Compare Compound and Aave for a beginner.") == (
        "Compound",
        "Aave",
    )
    assert extract_comparison_subjects("Is Morpho safer than Aave?") == ("Morpho", "Aave")
    # "auto-compounds" is a verb, not the Compound protocol.
    assert extract_comparison_subjects("How does the vault auto-compound?") == ()
    # A table-known subject keeps its place when a fallback proper noun precedes it.
    assert extract_comparison_subjects("Compare Yearn and Aave.") == ("Yearn", "Aave")


def test_unknown_protocols_fall_back_to_proper_nouns() -> None:
    from sparkpoint_agent.coordinator.comparative import extract_comparison_subjects

    assert extract_comparison_subjects("Compare Yearn and Beefy for a beginner.") == (
        "Yearn",
        "Beefy",
    )


def test_function_word_sentence_opener_is_not_extracted_as_a_subject() -> None:
    from sparkpoint_agent.coordinator.comparative import extract_comparison_subjects

    assert extract_comparison_subjects("For a cautious user, is Aerodrome safer than Curve?") == (
        "Aerodrome",
        "Curve",
    )


@pytest.mark.parametrize("word", sorted(comparative._NOT_A_SUBJECT))
def test_every_stoplist_word_is_dropped_by_the_proper_noun_fallback(word: str) -> None:
    from sparkpoint_agent.coordinator.comparative import extract_comparison_subjects

    subjects = extract_comparison_subjects(f"Compare {word.title()} with something.")
    assert word.lower() not in {subject.lower() for subject in subjects}


def test_stoplist_fallback_subject_cannot_claim_coverage_or_unlock_the_cite_gate() -> None:
    from sparkpoint_agent.coordinator.comparative import (
        passage_mentions_subject,
        text_mentions_subject,
    )

    answer = (
        "For a cautious user, Aerodrome is safer than Curve because Aerodrome concentrates "
        "liquidity while Curve is a stableswap pool; neither is insured."
    )
    passage = Passage(
        content="For a cautious user, read the docs; this is not protocol material.",
        citation=Citation(
            provider="docs",
            endpoint="obsidian://caution",
            field="caution",
            value="note",
            as_of="2026-10-29T00:00:00Z",
            stale=False,
        ),
    )
    assert text_mentions_subject(answer, "For") is False
    assert passage_mentions_subject(passage, "For") is False
    assert _comparative_citable_passages(("For",), (passage,)) == ()
