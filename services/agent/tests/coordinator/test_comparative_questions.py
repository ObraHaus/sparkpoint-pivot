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
from sparkpoint_agent.coordinator.chat_blocks import (
    CitationBlock,
    ProseDelta,
    TextBlock,
    TipBlock,
)
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


@pytest.mark.parametrize("streaming", [False, True])
async def test_meta_shaped_comparative_answer_gets_honest_prose_not_upstream_error(
    streaming: bool,
) -> None:
    llm = _DeflectingLlm()
    blocks = await _collect(
        _dag(llm, _Grounder(), streaming=streaming),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    wires = [b.to_wire() for b in blocks if not isinstance(b, ProseDelta)]
    assert not [w for w in wires if w["type"] == "error"], (
        "a content-guard rejection is not an upstream outage"
    )
    text = next(w for w in wires if w["type"] == "text")["markdown"]
    assert "Morpho" in text and "Aave" in text
    assert "reference notes" not in text.lower()
    assert "couldn't reach my model" not in text.lower()
    prose_calls = llm.stream_calls if streaming else llm.complete_calls
    assert prose_calls == 1, "a deterministic content rejection must not be retried"


@pytest.mark.parametrize("streaming", [False, True])
async def test_a_true_upstream_failure_on_a_comparative_turn_is_still_upstream_unavailable(
    streaming: bool,
) -> None:
    llm = _ExplodingProseLlm()
    blocks = await _collect(
        _dag(llm, _Grounder(), streaming=streaming),
        "Is Morpho safer than Aave?",
    )
    wires = [b.to_wire() for b in blocks if not isinstance(b, ProseDelta)]
    errors = [w for w in wires if w["type"] == "error"]
    assert len(errors) == 1 and errors[0]["code"] == "UPSTREAM_UNAVAILABLE"


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
    """Returns one fixed prose answer (streaming or not) and records the prompt."""

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


def _citations(blocks: Sequence[Any]) -> list[dict[str, Any]]:
    return [b.to_wire() for b in blocks if isinstance(b, CitationBlock)]


def _text(blocks: Sequence[Any]) -> str:
    return next(
        b.markdown for b in blocks if isinstance(b, TextBlock)
    )


@pytest.mark.parametrize("streaming", [False, True])
async def test_comparative_retrieves_each_named_subject_separately(streaming: bool) -> None:
    llm = _AnswerLlm(ANSWER)
    grounder = _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC})
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    prompt = llm.user_contents[-1]
    assert "AAVE-GROUNDING" in prompt and "MORPHO-GROUNDING" in prompt
    assert "SparkPoint-verified material is available for Morpho and Aave" in prompt
    assert "Morpho" in grounder.queries and "Aave" in grounder.queries
    cited = _citations(blocks)
    assert len(cited) == 1
    providers = {source["provider"] for source in cited[0]["sources"]}
    assert providers == {"Aave", "Morpho"}


@pytest.mark.parametrize("streaming", [False, True])
async def test_one_sided_coverage_names_the_missing_side_and_cites_only_the_grounded_one(
    streaming: bool,
) -> None:
    partial = (
        "SparkPoint has no verified data on Compound, but Aave is a shared lending pool whose "
        "supply rate moves with utilisation. Compound is also a lending protocol, so compare "
        "the smart-contract and governance risk of each rather than a single rate, and remember "
        "that neither is insured."
    )
    llm = _AnswerLlm(partial)
    grounder = _SubjectGrounder({"Aave": AAVE_DOC})
    blocks = await _collect(
        _dag(llm, grounder, streaming=streaming),
        "Compare Compound and Aave for a beginner.",
    )
    prompt = llm.user_contents[-1]
    assert "AAVE-GROUNDING" in prompt
    assert "COMPOUND-GROUNDING" not in prompt
    assert "SparkPoint has no verified material for Compound" in prompt
    text = _text(blocks)
    assert "Compound" in text and "Aave" in text
    cited = _citations(blocks)
    assert len(cited) == 1
    assert {source["provider"] for source in cited[0]["sources"]} == {"Aave"}


@pytest.mark.parametrize("streaming", [False, True])
async def test_neither_side_grounded_is_useful_and_uncited(streaming: bool) -> None:
    useful = (
        "I don't have SparkPoint-verified data on Lido or Rocket Pool, so I won't call one "
        "safer. Both are liquid-staking protocols for Ethereum: Lido relies on a set of "
        "professional validators, while Rocket Pool uses independent node operators, so compare "
        "validator and operator risk, withdrawal liquidity, and smart-contract risk. Neither is "
        "insured."
    )
    llm = _AnswerLlm(useful)
    blocks = await _collect(
        _dag(llm, _SubjectGrounder({}), streaming=streaming),
        "Which is riskier, Lido or Rocket Pool?",
    )
    prompt = llm.user_contents[-1]
    assert "SparkPoint has no verified material for Lido and Rocket Pool" in prompt
    text = _text(blocks)
    assert "Lido" in text and "Rocket Pool" in text
    assert _citations(blocks) == [], "a no-data answer must not look sourced"


@pytest.mark.parametrize("streaming", [False, True])
async def test_fallback_names_the_actual_subjects_not_those_options(streaming: bool) -> None:
    deflection = (
        "I’m not able to compare Compound and Aave because the reference information doesn’t "
        "include details on either protocol’s risk, yield, or fees."
    )
    llm = _AnswerLlm(deflection)
    blocks = await _collect(
        _dag(llm, _SubjectGrounder({"Aave": AAVE_DOC}), streaming=streaming),
        "Compare Compound and Aave for a beginner.",
    )
    text = _text(blocks)
    assert "Compound" in text and "Aave" in text
    assert "those options" not in text.lower()
    assert "reference information" not in text.lower()
    assert _citations(blocks) == []


@pytest.mark.parametrize("streaming", [False, True])
async def test_a_pure_decline_with_a_curly_apostrophe_is_not_cited(streaming: bool) -> None:
    decline = "I’m not able to compare Morpho and Aave from the data I have."
    llm = _AnswerLlm(decline)
    blocks = await _collect(
        _dag(
            llm,
            _SubjectGrounder({"Aave": AAVE_DOC, "Morpho": MORPHO_DOC}),
            streaming=streaming,
        ),
        "Is Morpho safer than Aave?",
    )
    text = _text(blocks)
    assert "Morpho" in text and "Aave" in text
    assert _citations(blocks) == []


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


def test_unknown_protocols_fall_back_to_proper_nouns() -> None:
    from sparkpoint_agent.coordinator.comparative import extract_comparison_subjects

    assert extract_comparison_subjects("Compare Yearn and Beefy for a beginner.") == (
        "Yearn",
        "Beefy",
    )


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
                    "Sparky to compare two options — for example \"Is Morpho safer than Aave?\" — "
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
    useful = (
        "I don't have SparkPoint-verified data on Morpho or Aave, so I won't call one safer. "
        "Structurally, Aave is a shared lending pool, while Morpho is a framework of isolated "
        "markets and curated vaults, so compare curator risk, market isolation and withdrawal "
        "liquidity as well as smart-contract risk. Neither is insured."
    )
    llm = _AnswerLlm(useful)
    blocks = await _collect(
        _dag(llm, _ReleaseNoteGrounder()),
        "Is Morpho safer than Aave? Compare them for a cautious user.",
    )
    prompt = llm.user_contents[-1]
    assert "SparkPoint has no verified material for Morpho and Aave" in prompt
    assert "release note" not in prompt.lower()
    assert _citations(blocks) == []
