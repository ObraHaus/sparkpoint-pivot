# ruff: noqa: S101
"""R2 — Obsidian grounding + the CRITICAL non-custody boundary.

Grounding: a LEARN or OTHER turn retrieves corpus passages and answers FROM them (the passage text
reaches the prose agent) and emits a citation block.

BOUNDARY (N-invariant / T126): corpus passage TEXT must NEVER reach the propose / build_action /
policy path. A RECOMMEND turn (which goes understand → gather → propose → policy_gate → assemble)
must not invoke the grounder at all, and the sentinel passage text must appear in NO block and in
NO input to the recommender — knowledge is advisory-prose-only.
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender, _Rank
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.knowledge import Passage
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import ActionType, CapHeadroom
from sparkpoint_agent.wire import Citation

SENTINEL = "AERODROME_VE33_SECRET_PASSAGE_TEXT_XYZ"
VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15


class _FakeGrounder:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def retrieve_passages(self, query: str, *, k: int | None = None) -> tuple[Passage, ...]:
        self.calls.append(query)
        cite = Citation(provider="Aerodrome", endpoint="obsidian://aerodrome-slipstream",
                        field="", value=SENTINEL[:40], as_of="", stale=False)
        return (Passage(content=SENTINEL, citation=cite),)


class _RecordingComplete:
    def __init__(self) -> None:
        self.messages: list[Any] = []

    async def complete(self, *, messages: Any, **_: Any) -> LlmResult:
        self.messages.append(messages)
        return LlmResult(text="Grounded answer.", stop_reason="end_turn")


class _RecordingStructured:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result
        self.messages: list[Any] = []

    async def structured(self, *, messages: Any, **_: Any) -> StructuredResult[Any]:
        self.messages.append(messages)
        return self._result


class _Portfolio:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView()


class _Mandate:
    def __init__(self, view: MandateView | None) -> None:
        self._view = view

    async def active(self, chain: ChainContext) -> MandateView | None:
        return self._view


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453, user_account=USER, owner=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        market=MarketData(gross_apy_bps=421, projected_apy_bps=379),
    )


def _dag(intent: Intent, *, grounder: _FakeGrounder,
         literacy_llm: _RecordingComplete, reco_llm: _RecordingStructured) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=_RecordingStructured(StructuredResult(ok=True, value=intent))),
        recommender=Recommender(llm=reco_llm),
        literacy=Literacy(llm=literacy_llm),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(MandateView(version=1)),
        knowledge=grounder,  # type: ignore[arg-type]
    )


async def _run(dag: CoordinatorDag, msg: str) -> list[dict[str, Any]]:
    return [b.to_wire() async for b in dag.run_chat(msg, _chain())]


async def test_learn_answer_is_grounded_and_cited() -> None:
    g, lit = _FakeGrounder(), _RecordingComplete()
    dag = _dag(Intent(kind=IntentKind.LEARN, topic="what_is_slippage"), grounder=g,
               literacy_llm=lit, reco_llm=_RecordingStructured(StructuredResult(ok=True, value={})))
    wires = await _run(dag, "how does aerodrome concentrated liquidity work?")
    assert g.calls, "the grounder must be consulted for a LEARN turn"
    # The passage TEXT reached the prose agent (grounding).
    assert any(SENTINEL in str(m) for m in lit.messages), "passage text grounds literacy"
    # A citation block was emitted.
    assert any(b.get("type") == "citation" for b in wires), "a grounded answer must cite its source"


async def test_other_answer_is_grounded_and_cited() -> None:
    g, lit = _FakeGrounder(), _RecordingComplete()
    dag = _dag(Intent(kind=IntentKind.OTHER), grounder=g,
               literacy_llm=lit, reco_llm=_RecordingStructured(StructuredResult(ok=True, value={})))
    wires = await _run(dag, "tell me about the vault's fee")
    assert g.calls
    assert any(SENTINEL in str(m) for m in lit.messages)
    assert any(b.get("type") == "citation" for b in wires)


async def test_corpus_text_never_reaches_propose_or_policy() -> None:
    # THE BOUNDARY: a RECOMMEND turn must not invoke the grounder, and the sentinel must appear in
    # NO recommender input and NO emitted block — knowledge stays advisory-prose-only.
    g, lit = _FakeGrounder(), _RecordingComplete()
    ranking = {ActionType.VAULT_DEPOSIT: _Rank(rank=1, title="Deposit", rationale="steady")}
    reco = _RecordingStructured(StructuredResult(ok=True, value=ranking))
    dag = _dag(Intent(kind=IntentKind.RECOMMEND), grounder=g, literacy_llm=lit, reco_llm=reco)
    wires = await _run(dag, "where can I earn yield?")
    assert g.calls == [], "the grounder must NOT be consulted on the action/recommend path"
    assert all(SENTINEL not in str(m) for m in reco.messages), "no corpus text in propose"
    assert all(SENTINEL not in str(b) for b in wires), "no corpus text in a block"
