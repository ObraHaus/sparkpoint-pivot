# ruff: noqa: S101
"""029 — the three questions that must be answered in the RIGHT SHAPE (FR-005, FR-006, FR-007).

Every case below is a verbatim prompt from the Aug-3 browser battery, together with what it
actually produced before this feature:

  * "How much have I paid in fees?"        → the PORTFOLIO CARD, with no fee information at all.
  * "What's the current APY on the vault?" → a textbook explanation of what an APY is.
  * "Can you buy ETH for me automatically?" → an inline SWAP CARD, and no mention of the fact
    that Sparky cannot move funds at all.

A wrong-shaped answer is the failure mode a user actually notices: it is delivered confidently,
so it reads as a product that does not understand its own domain. These routes are therefore
deterministic — no model call — and these tests pin both what they DO catch and, just as
importantly, what they must NOT steal from the classifier (a genuine "what is APY?" literacy
question, a general "what's the vault fee?" corpus question, and a real order to trade).
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import ActionType, Asset, CapHeadroom

VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15


class _StructuredLlm:
    def __init__(self, value: Any) -> None:
        self._value = value

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return StructuredResult(ok=True, value=self._value)


class _CompleteLlm:
    def __init__(self, text: str = "prose") -> None:
        self._text = text
        self.calls = 0

    async def complete(self, **_: Any) -> LlmResult:
        self.calls += 1
        return LlmResult(text=self._text, stop_reason="end_turn")


class _Portfolio:
    def __init__(self) -> None:
        self.reads = 0

    async def read(self, chain: ChainContext) -> PortfolioView:
        self.reads += 1
        return PortfolioView(net_worth_usd="250.00")


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return MandateView(version=1)


#: The live-ish market the chain provider supplies on a healthy read.
_MARKET = MarketData(gross_apy_bps=421, projected_apy_bps=379, performance_fee_bps=1000)


def _chain(*, market: MarketData | None = None) -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        market=_MARKET if market is None else market,
    )


def _dag(intent: Intent, *, portfolio: _Portfolio | None = None,
         prose: _CompleteLlm | None = None) -> CoordinatorDag:
    """A DAG whose classifier would return ``intent`` — so a passing test proves the
    deterministic route fired BEFORE the classifier ever got its way."""
    return CoordinatorDag(
        planner=Planner(llm=_StructuredLlm(intent)),
        recommender=Recommender(llm=_StructuredLlm({})),
        literacy=Literacy(llm=_CompleteLlm("An APY is your annualised yield.")),
        portfolio_provider=portfolio or _Portfolio(),
        mandate_provider=_Mandate(),
        sparky=None if prose is None else _sparky(prose),
    )


def _sparky(llm: _CompleteLlm) -> Any:
    from sparkpoint_agent.agents.sparky import Sparky

    return Sparky(llm=llm, persona_provider=lambda: "PERSONA")


async def _run(dag: CoordinatorDag, message: str, chain: ChainContext | None = None) -> list[dict]:
    return [b.to_wire() async for b in dag.run_chat(message, chain or _chain())]


def _text(wires: list[dict[str, Any]]) -> str:
    return "\n".join(w["markdown"] for w in wires if w["type"] == "text")


def _types(wires: list[dict[str, Any]]) -> set[str]:
    return {w["type"] for w in wires}


# ── FR-005 · "how much have I paid in fees?" ──────────────────────────────────


async def test_fees_paid_question_answers_about_fees_not_with_the_portfolio_card() -> None:
    portfolio = _Portfolio()
    # The classifier said PORTFOLIO — which is exactly what shipped the wrong answer.
    dag = _dag(Intent(kind=IntentKind.PORTFOLIO), portfolio=portfolio)
    wires = await _run(dag, "How much have I paid in fees?")

    assert "portfolio_snapshot" not in _types(wires)
    assert portfolio.reads == 0, "a fee question must not read positions to answer with them"
    text = _text(wires)
    assert "0%" in text and "deposits" in text
    assert "10% performance fee" in text
    assert "0.20%" in text, "the swap routing fee is part of what the user pays"


async def test_the_absence_of_a_per_wallet_total_is_stated_not_implied() -> None:
    wires = await _run(_dag(Intent(kind=IntentKind.PORTFOLIO)), "what fees have I been charged?")
    text = _text(wires).lower()
    assert "can't show a per-wallet" in text
    assert "share dilution" in text, "say WHY, so it reads as a design fact and not a defect"


async def test_the_quoted_performance_fee_is_the_live_on_chain_one() -> None:
    chain = _chain(market=MarketData(performance_fee_bps=1500))
    wires = await _run(_dag(Intent(kind=IntentKind.PORTFOLIO)), "how much do I pay in fees?", chain)
    assert "15% performance fee" in _text(wires)


async def test_a_general_fee_question_is_left_to_the_grounded_corpus_path() -> None:
    # "what's the vault fee?" has no first-person marker: it belongs on the general branch, where
    # it is answered from the knowledge base WITH citations. Stealing it would lose that.
    prose = _CompleteLlm("The vault charges a 10% performance fee.")
    dag = _dag(Intent(kind=IntentKind.OTHER), prose=prose)
    wires = await _run(dag, "what's the vault fee?")
    assert prose.calls == 1, "the general branch must still handle this"
    assert "can't show a per-wallet" not in _text(wires)


# ── FR-006 · "what's the current APY?" ────────────────────────────────────────


async def test_live_apy_question_gives_the_figure_not_a_definition() -> None:
    # The classifier said LEARN/what_is_apy — the routing that produced the definition.
    dag = _dag(Intent(kind=IntentKind.LEARN, topic="what_is_apy"))
    wires = await _run(dag, "What's the current APY on the vault?")

    assert "tip" not in _types(wires), "a live-figure question must not return a literacy card"
    text = _text(wires)
    assert "3.79% APY" in text, "the NET figure leads — that's what the user earns"
    assert "4.21%" in text, "gross is shown alongside so the fee is visible"
    assert "variable" in text.lower(), "a rate quote must carry its own caveat"


async def test_an_unreadable_rate_is_admitted_rather_than_guessed() -> None:
    dag = _dag(Intent(kind=IntentKind.LEARN, topic="what_is_apy"))
    wires = await _run(dag, "what's the vault's APY right now?", _chain(market=MarketData()))
    text = _text(wires).lower()
    assert "can't read the vault's live apy" in text
    assert "%" not in text, "never quote a number the feed didn't give us"


async def test_a_genuine_apy_definition_question_still_gets_the_literacy_card() -> None:
    dag = _dag(Intent(kind=IntentKind.LEARN, topic="what_is_apy"))
    wires = await _run(dag, "What is APY?")
    assert "tip" in _types(wires)


async def test_explain_style_phrasing_is_not_treated_as_a_figure_request() -> None:
    dag = _dag(Intent(kind=IntentKind.LEARN, topic="what_is_apy"))
    wires = await _run(dag, "explain how the current APY is calculated")
    assert "tip" in _types(wires)


# ── FR-007 · "can you do it automatically?" ───────────────────────────────────


async def test_automation_question_answers_non_custody_not_with_a_swap_card() -> None:
    # The classifier said BUILD_ACTION/swap — which is what put a swap card on screen.
    dag = _dag(
        Intent(
            kind=IntentKind.BUILD_ACTION,
            action_type=ActionType.AERODROME_SWAP,
            asset=Asset.USDC,
            amount=1_000_000,
        )
    )
    wires = await _run(dag, "Can you buy ETH for me automatically?")

    assert not (_types(wires) & {"action", "recommendation"}), "no card — this was a question"
    text = _text(wires)
    assert "never move your funds" in text.lower()
    assert "session key" in text.lower(), "the real, shipped capability must be named"
    assert "revoke" in text.lower(), "and so must the way out of it"


async def test_the_automation_answer_offers_the_one_off_path() -> None:
    dag = _dag(Intent(kind=IntentKind.OTHER))
    text = _text(await _run(dag, "can you rebalance my portfolio automatically?"))
    assert "tell me the amount" in text.lower()


async def test_a_real_order_to_trade_is_not_hijacked_by_the_automation_route() -> None:
    # "swap 100 usdc for eth" carries no automation language — it must still build.
    dag = _dag(
        Intent(
            kind=IntentKind.BUILD_ACTION,
            action_type=ActionType.AERODROME_SWAP,
            asset=Asset.USDC,
            amount=100_000_000,
        )
    )
    wires = await _run(dag, "swap 100 USDC for ETH")
    assert "never move your funds" not in _text(wires).lower()


# ── shape guarantees shared by all three ──────────────────────────────────────


async def test_no_direct_answer_ever_emits_a_signable_block() -> None:
    for message in (
        "how much have I paid in fees?",
        "what's the current APY?",
        "can you buy ETH for me automatically?",
    ):
        wires = await _run(_dag(Intent(kind=IntentKind.RECOMMEND)), message)
        assert not (_types(wires) & {"action", "recommendation"}), message
        assert all(not w.get("policy", {}).get("status") == "approved" for w in wires), message


async def test_direct_answers_never_call_a_model() -> None:
    prose = _CompleteLlm()
    for message in (
        "what fees have I paid?",
        "what's the current APY on the vault?",
        "can you invest for me automatically?",
    ):
        await _run(_dag(Intent(kind=IntentKind.OTHER), prose=prose), message)
    assert prose.calls == 0, "these shapes are code-authored — a model cannot mis-say them"
