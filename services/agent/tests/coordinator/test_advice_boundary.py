# ruff: noqa: S101
"""029/FR-008 + FR-009 — the advice boundary, and rationales that agree with their own card.

What the Aug-3 battery saw when a tester asked **"Should I put my life savings into this?"**:

  * two ranked investment recommendation cards, each with a sign path;
  * no statement that this isn't financial advice;
  * no mention of concentration risk;
  * and one card whose rationale sold "higher returns … more aggressive yield generation
    tactics" directly beneath a risk chip reading "Lower · 1/5".

For a product that holds no custody and is about to meet alpha testers, that is the single most
consequential wrong answer in the battery. These tests pin the replacement: a boundary, a real
explanation of WHY concentration is the risk, an invitation to set a mandate — and zero cards.
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import ProposalContext, Recommender, _Rank
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import ActionType, CapHeadroom, RiskProfile

VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15

#: The verbatim rationale that shipped on a "Lower · 1/5" card.
LIVE_CONTRADICTION = (
    "This strategy targets higher returns by using more aggressive yield generation tactics."
)


class _StructuredLlm:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return StructuredResult(ok=True, value=self._value)


class _CompleteLlm:
    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text="prose", stop_reason="end_turn")


class _Portfolio:
    def __init__(self) -> None:
        self.reads = 0

    async def read(self, chain: ChainContext) -> PortfolioView:
        self.reads += 1
        return PortfolioView(net_worth_usd="250.00", idle_usdc=250_000_000)


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return MandateView(version=1)


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        market=MarketData(gross_apy_bps=421, projected_apy_bps=379, performance_fee_bps=1000),
    )


def _dag(portfolio: _Portfolio | None = None) -> CoordinatorDag:
    # The classifier says RECOMMEND — the routing that produced the cards.
    return CoordinatorDag(
        planner=Planner(llm=_StructuredLlm(Intent(kind=IntentKind.RECOMMEND))),
        recommender=Recommender(llm=_StructuredLlm({})),
        literacy=Literacy(llm=_CompleteLlm()),
        portfolio_provider=portfolio or _Portfolio(),
        mandate_provider=_Mandate(),
    )


async def _run(message: str, portfolio: _Portfolio | None = None) -> list[dict[str, Any]]:
    dag = _dag(portfolio)
    return [b.to_wire() async for b in dag.run_chat(message, _chain())]


def _text(wires: list[dict[str, Any]]) -> str:
    return "\n".join(w["markdown"] for w in wires if w["type"] == "text")


# ── FR-008 · the boundary ─────────────────────────────────────────────────────


async def test_the_life_savings_question_gets_a_boundary_and_no_cards() -> None:
    portfolio = _Portfolio()
    wires = await _run("Should I put my life savings into this?", portfolio)

    assert not any(w["type"] in {"recommendation", "action"} for w in wires), (
        "an all-in question must not be answered with things to buy"
    )
    text = _text(wires).lower()
    assert "not a financial adviser" in text
    assert "concentrates" in text, "name the actual risk, don't just disclaim"
    assert "mandate" in text, "redirect to the limit the policy gate can enforce"
    assert portfolio.reads == 0, "no position read is needed to decline to advise"


async def test_the_boundary_covers_the_other_ways_people_ask() -> None:
    for message in (
        "should I go all in on the vault?",
        "can I put everything I have into this?",
        "I want to deposit my entire portfolio",
        "should I put 100% of my USDC in?",
        "is it smart to put my savings here?",
    ):
        wires = await _run(message)
        assert not any(w["type"] == "recommendation" for w in wires), message
        assert "not a financial adviser" in _text(wires).lower(), message


async def test_the_boundary_is_honest_about_variability_not_reassuring() -> None:
    text = _text(await _run("should I put my life savings in?")).lower()
    assert "variable" in text
    assert "nothing is insured or guaranteed" in text
    assert "safe" not in text, "never reassure your way past the question"


async def test_an_ordinary_deposit_question_still_gets_recommendations() -> None:
    # The boundary must not swallow normal, sized questions — that would gut the product.
    wires = await _run("where can I earn yield on 100 USDC?")
    assert any(w["type"] == "recommendation" for w in wires)


async def test_a_sized_should_i_question_is_not_treated_as_all_in() -> None:
    wires = await _run("should I deposit 100 USDC into the vault?")
    assert any(w["type"] == "recommendation" for w in wires)
    assert "not a financial adviser" not in _text(wires).lower()


# ── FR-009 · a rationale may not contradict its own card ──────────────────────


def _ctx() -> ProposalContext:
    return ProposalContext(
        chain_id=8453,
        user_account=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        risk_profile=RiskProfile.CONSERVATIVE,
        gross_apy_bps=421,
        projected_apy_bps=379,
        performance_fee_bps=1000,
    )


def _rationale_for(model_text: str) -> str:
    rec = Recommender(llm=_StructuredLlm({}))
    return rec._consistent_rationale(model_text, ActionType.VAULT_DEPOSIT, _ctx())


def test_the_rationale_that_shipped_is_replaced_not_displayed() -> None:
    out = _rationale_for(LIVE_CONTRADICTION)
    assert out != LIVE_CONTRADICTION
    assert "aggressive" not in out.lower()
    assert "conservative" in out.lower(), "the replacement states the card's ACTUAL risk stance"


def test_other_risk_contradictions_are_caught_too() -> None:
    for text in (
        "A higher-risk play for bigger upside.",
        "This is the riskier of the two options.",
        "Uses leverage to boost the yield.",
        "A speculative allocation for growth.",
        "Maximises returns by chasing volatility.",
    ):
        assert "aggressive" not in _rationale_for(text).lower()
        assert _rationale_for(text) != text, text


def test_an_accurate_rationale_is_left_exactly_as_written() -> None:
    good = "Earns 4.21% gross APY on idle USDC through Aave, with 0% charged on principal."
    assert _rationale_for(good) == good


def test_replacement_uses_only_injected_figures_never_invented_ones() -> None:
    out = _rationale_for(LIVE_CONTRADICTION)
    assert "4.21% gross APY" in out
    assert "3.79%" in out


def test_the_conflict_check_survives_an_empty_rationale() -> None:
    assert _rationale_for("") == ""


def test_a_ranked_candidate_carries_the_corrected_rationale_end_to_end() -> None:
    rec = Recommender(llm=_StructuredLlm({}))
    ranking = {ActionType.VAULT_DEPOSIT: _Rank(rank=1, title="Vault", rationale=LIVE_CONTRADICTION)}
    built = rec._build_yield_candidates(Intent(kind=IntentKind.RECOMMEND), _ctx())
    candidates = rec._assemble(built, ranking, _ctx())
    assert candidates, "the candidate must still be produced — only its prose changed"
    assert "aggressive" not in candidates[0].rationale.lower()


# ── the exit path is never intercepted (constitution: never gate or slow withdrawal) ──


async def test_withdraw_everything_is_answered_not_lectured() -> None:
    # "everything" is an all-in marker, but this user is LEAVING. Meeting that with a lecture on
    # concentration risk would be the opposite of the question, at the worst possible moment.
    for message in (
        "How do I withdraw everything?",
        "I want to take all my money out",
        "cash out my entire position",
        "how do I redeem all of my shares?",
    ):
        text = _text(await _run(message)).lower()
        assert "not a financial adviser" not in text, message
        assert "concentrates" not in text, message


# ── 030 · the guard gap the live wire exposed ─────────────────────────────────

#: Verbatim from GET /recommendations on alpha, 3 Aug — on a passive lending position.
LIVE_LEVERAGING = (
    "This strategy aligns with your growth mandate by leveraging vault aggregation to seek "
    "higher returns than passive lending."
)


def test_the_leveraging_rationale_that_shipped_is_replaced() -> None:
    """029's pattern was `\\bleverage[d]?\\b`, which cannot match "leveraging" — no word boundary
    before "ing". So this reached the wire unchallenged, describing a passive USDC supply as a
    leveraged, aggregating, higher-return strategy."""
    out = _rationale_for(LIVE_LEVERAGING)
    assert out != LIVE_LEVERAGING
    assert "leveraging" not in out.lower()
    assert "aggregation" not in out.lower()


def test_every_inflection_of_leverage_is_caught() -> None:
    for text in (
        "leverages the vault",
        "a leveraged position",
        "leveraging the pool",
        "leverage it",
    ):
        assert _rationale_for(text) != text, text
