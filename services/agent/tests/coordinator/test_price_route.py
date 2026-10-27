# ruff: noqa: S101
"""060 — the deterministic price route.

The route must answer a price question without the model, keep SRK on its no-price policy, and
never steal a portfolio/APY/command shape from the route that owns it.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest

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
from sparkpoint_agent.coordinator.prices import (
    SRK_PRICE_ANSWER,
    format_price_answer,
    is_price_question,
    is_srk_price_question,
    requested_price_symbols,
)
from sparkpoint_agent.data.prices import PriceQuote, PriceSnapshot
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import CapHeadroom

USER = "0x2222222222222222222222222222222222222222"
VAULT = "0x1111111111111111111111111111111111111111"
BIG = 10**15
STAMP = datetime(2026, 10, 27, 12, 34, tzinfo=UTC)


def _quote(symbol: str, usd: float, **kwargs: Any) -> PriceQuote:
    return PriceQuote(
        symbol=symbol,
        usd=usd,
        source="CoinGecko",
        as_of=STAMP,
        **kwargs,
    )


class _FakePrices:
    def __init__(self, snapshot: PriceSnapshot) -> None:
        self.snapshot = snapshot
        self.calls: list[tuple[str, ...]] = []

    async def get(self, symbols: tuple[str, ...]) -> PriceSnapshot:
        self.calls.append(tuple(symbols))
        return self.snapshot


class _CountingStructuredLlm:
    def __init__(self, intent: Intent | None = None) -> None:
        self.calls = 0
        self._intent = intent or Intent(kind=IntentKind.OTHER)

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.calls += 1
        return StructuredResult(ok=True, value=self._intent)


class _CompleteLlm:
    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text="prose", stop_reason="end_turn")


class _Portfolio:
    def __init__(self) -> None:
        self.reads = 0

    async def read(self, chain: ChainContext) -> PortfolioView:
        self.reads += 1
        return PortfolioView(net_worth_usd="250.00")


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


def _dag(
    prices: _FakePrices | None,
    intent: Intent | None = None,
    portfolio: _Portfolio | None = None,
    *,
    streaming: bool = False,
    single_call: bool = False,
) -> tuple[CoordinatorDag, _CountingStructuredLlm]:
    classifier = _CountingStructuredLlm(intent)
    dag = CoordinatorDag(
        planner=Planner(llm=classifier),
        recommender=Recommender(llm=classifier),
        literacy=Literacy(llm=_CompleteLlm()),
        portfolio_provider=portfolio or _Portfolio(),
        mandate_provider=_Mandate(),
        prices=prices,  # type: ignore[arg-type]
        streaming=streaming,
        single_call=single_call,
    )
    return dag, classifier


async def _run(dag: CoordinatorDag, message: str) -> list[dict[str, Any]]:
    return [b.to_wire() async for b in dag.run_chat(message, _chain())]


def _text(wires: list[dict[str, Any]]) -> str:
    return "\n".join(w["markdown"] for w in wires if w["type"] == "text")


# ── detection ────────────────────────────────────────────────────────────────


def test_price_questions_are_recognised_and_other_shapes_are_not() -> None:
    for question in (
        "What is the price of ETH today?",
        "how much is ETH",
        "ETH price",
        "what's BTC trading at?",
        "how much does SOL cost",
        "price of USDC",
    ):
        assert is_price_question(question), question

    for other in (
        "what is my portfolio worth?",
        "what's the current APY on the vault?",
        "swap 100 USDC for ETH",
        "how much is my ETH worth?",
        "what's the vault fee?",
        "what is slippage?",
    ):
        assert not is_price_question(other), other


_TRANSACTIONAL_PRICE_PHRASES = (
    "buy ETH at the current price",
    "sell ETH at the current price",
    "trade ETH at the current price",
    "purchase ETH at the current price",
    "place an order for ETH at the current price",
    "exchange ETH at the current price",
    "convert ETH at the current price",
    "bridge ETH at the current price",
    "stake ETH at the current price",
    "lend ETH at the current price",
    "borrow ETH at the current price",
    "long ETH at the current price",
    "short ETH at the current price",
    "set a limit order for ETH at the current price",
    "place a market order for ETH at the current price",
)

_PRICE_QUESTION_PHRASES = (
    "what is the ETH price",
    "ETH price today",
    "how much is BTC",
    "price of ETH and SRK",
    "What is the price of ETH today?",
    "how much is ETH",
    "what's BTC trading at?",
    "how much does SOL cost",
    "price of USDC",
)


@pytest.mark.parametrize("message", _TRANSACTIONAL_PRICE_PHRASES)
def test_transactional_price_phrasings_are_not_spot_quotes(message: str) -> None:
    assert not is_price_question(message), message


@pytest.mark.parametrize("message", _PRICE_QUESTION_PHRASES)
def test_pure_price_questions_still_route(message: str) -> None:
    assert is_price_question(message), message


def test_srk_is_detected_by_policy_before_the_feed() -> None:
    assert is_srk_price_question("What is the price of SRK?")
    assert is_srk_price_question("SRK price")
    assert not is_srk_price_question("what is SRK?")
    assert requested_price_symbols("what is the price of SRK?") == ()


def test_symbols_are_deduped_and_ordered() -> None:
    assert requested_price_symbols("ETH or BTC?") == ("ETH", "BTC")
    assert requested_price_symbols("price of ethereum and ethereum") == ("ETH",)


# ── formatting ──────────────────────────────────────────────────────────────


def test_the_answer_carries_price_source_as_of_and_not_advice() -> None:
    snapshot = PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0)})
    text = format_price_answer(snapshot, ("ETH",))

    assert "$2,500.00" in text
    assert "as of 12:34 UTC" in text
    assert "CoinGecko" in text
    assert "not financial advice" in text


def test_context_only_assets_are_labelled() -> None:
    snapshot = PriceSnapshot(quotes={"BTC": _quote("BTC", 90000.0)})
    text = format_price_answer(snapshot, ("BTC",))
    assert "context only" in text


def test_context_only_wording_counts_only_the_context_assets() -> None:
    snapshot = PriceSnapshot(
        quotes={
            "ETH": _quote("ETH", 2500.0),
            "BTC": _quote("BTC", 90000.0),
            "SOL": _quote("SOL", 150.0),
        }
    )
    text = format_price_answer(snapshot, ("ETH", "BTC", "SOL"))
    assert "BTC and SOL are shown for context only" in text


def test_a_lone_context_asset_is_singular_even_beside_a_priceable_one() -> None:
    snapshot = PriceSnapshot(
        quotes={"ETH": _quote("ETH", 2500.0), "BTC": _quote("BTC", 90000.0)}
    )
    text = format_price_answer(snapshot, ("ETH", "BTC"))
    assert "BTC is shown for context only" in text
    assert "BTC are shown" not in text


def test_a_stale_quote_says_it_is_cached() -> None:
    snapshot = PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0, stale=True)})
    text = format_price_answer(snapshot, ("ETH",))
    assert "cached while refreshing" in text


def test_an_unavailable_feed_is_honest() -> None:
    text = format_price_answer(PriceSnapshot(quotes={}), ("ETH",))
    assert "couldn't fetch a live price" in text
    assert "won't guess" in text


# ── through run_chat ────────────────────────────────────────────────────────


async def test_a_price_question_is_answered_without_the_model() -> None:
    prices = _FakePrices(PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0)}))
    dag, classifier = _dag(prices)
    wires = await _run(dag, "What is the price of ETH today?")

    assert wires and wires[0]["type"] == "tool_step"
    assert "2,500.00" in _text(wires)
    assert classifier.calls == 0, "a price is code-authored, not a model guess"
    assert prices.calls == [("ETH",)]


async def test_srk_gets_the_no_price_policy_without_calling_the_feed() -> None:
    prices = _FakePrices(PriceSnapshot(quotes={}))
    dag, classifier = _dag(prices)
    wires = await _run(dag, "What is the price of SRK?")

    assert SRK_PRICE_ANSWER.splitlines()[0] in _text(wires)
    assert "doesn't quote a dollar price" in _text(wires)
    assert prices.calls == [], "SRK must never be sent to a price source"
    assert classifier.calls == 0


async def test_a_mixed_srk_and_priceable_question_quotes_the_priceable_symbol() -> None:
    prices = _FakePrices(PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0)}))
    dag, classifier = _dag(prices)
    wires = await _run(dag, "what's the price of ETH and SRK?")

    text = _text(wires)
    assert "2,500.00" in text, "the priceable half must not be dropped"
    assert SRK_PRICE_ANSWER.splitlines()[0] in text, "the SRK policy still applies"
    assert prices.calls == [("ETH",)]
    assert classifier.calls == 0


async def test_an_unreachable_feed_does_not_break_the_turn() -> None:
    dag, _ = _dag(_FakePrices(PriceSnapshot(quotes={})))
    wires = await _run(dag, "how much is ETH")

    assert wires[-1]["type"] == "text"
    assert "couldn't fetch a live price" in _text(wires)


async def test_a_portfolio_valuation_stays_on_the_portfolio_route() -> None:
    portfolio = _Portfolio()
    dag, classifier = _dag(
        _FakePrices(PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0)})),
        Intent(kind=IntentKind.PORTFOLIO),
        portfolio,
    )
    wires = await _run(dag, "what is my portfolio worth?")

    assert classifier.calls == 1, "this needs the wallet, not a spot price"
    assert "portfolio_snapshot" in {w["type"] for w in wires}
    assert "2,500.00" not in _text(wires)


async def test_an_apy_question_stays_on_the_apy_route() -> None:
    prices = _FakePrices(PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0)}))
    dag, classifier = _dag(prices)
    wires = await _run(dag, "what's the current APY on the vault?")

    assert "APY" in _text(wires)
    assert "as of" in _text(wires)
    assert prices.calls == []
    assert classifier.calls == 0, "the APY answer is deterministic too"


async def test_a_swap_command_is_not_hijacked() -> None:
    dag, classifier = _dag(_FakePrices(PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0)})))
    await _run(dag, "swap 100 USDC for ETH")

    assert classifier.calls == 1, "an explicit order must reach the normal build path"


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("single_call", [False, True])
async def test_buy_eth_at_current_price_reaches_the_planner_on_every_flag_combo(
    streaming: bool, single_call: bool
) -> None:
    prices = _FakePrices(PriceSnapshot(quotes={"ETH": _quote("ETH", 2500.0)}))
    dag, classifier = _dag(prices, streaming=streaming, single_call=single_call)
    wires = await _run(dag, "buy ETH at the current price")

    assert classifier.calls == 1, "the order must reach the planner/swap path"
    assert prices.calls == [], "an order is not a spot-quote request"
    assert "2,500.00" not in _text(wires)


def test_a_quote_with_a_note_can_be_replaced_without_mutating_the_cache() -> None:
    quote = _quote("USDC", 1.0)
    annotated = replace(quote, note="peg")
    assert quote.note is None and annotated.note == "peg"
