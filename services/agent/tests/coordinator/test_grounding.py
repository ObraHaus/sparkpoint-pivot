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
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.knowledge import Passage
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import ActionType, Asset, CapHeadroom
from sparkpoint_agent.wire import Citation

SENTINEL = "AERODROME_VE33_SECRET_PASSAGE_TEXT_XYZ"
VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15


class _FakeGrounder:
    def __init__(self) -> None:
        self.calls: list[str] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
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
         literacy_llm: _RecordingComplete, reco_llm: _RecordingStructured,
         sparky_llm: _RecordingComplete | None = None) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=_RecordingStructured(StructuredResult(ok=True, value=intent))),
        recommender=Recommender(llm=reco_llm),
        literacy=Literacy(llm=literacy_llm),
        # The general/identity branch's prose agent (025). LEARN still goes through literacy;
        # OTHER goes through here, so the grounding assertions below follow the branch.
        sparky=Sparky(llm=sparky_llm or _RecordingComplete()),
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
    # The OTHER branch grounds the SAME way as LEARN, but through the persona-bearing general
    # responder (025): passage text reaches Sparky's prose turn and the answer is cited.
    g, lit, sparky = _FakeGrounder(), _RecordingComplete(), _RecordingComplete()
    dag = _dag(Intent(kind=IntentKind.OTHER), grounder=g, literacy_llm=lit,
               reco_llm=_RecordingStructured(StructuredResult(ok=True, value={})),
               sparky_llm=sparky)
    wires = await _run(dag, "tell me about the vault's fee")
    assert g.calls
    assert any(SENTINEL in str(m) for m in sparky.messages), "passage text grounds the general turn"
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


async def test_corpus_text_never_reaches_build_action_or_policy() -> None:
    # BOUNDARY extended to BUILD_ACTION (B5): a directly-commanded action goes understand → gather →
    # propose → build_action → policy_gate → assemble; the grounder must NOT be consulted and the
    # sentinel must appear in NO recommender input and NO emitted block.
    g, lit = _FakeGrounder(), _RecordingComplete()
    ranking = {ActionType.VAULT_DEPOSIT: _Rank(rank=1, title="Deposit", rationale="steady")}
    reco = _RecordingStructured(StructuredResult(ok=True, value=ranking))
    intent = Intent(
        kind=IntentKind.BUILD_ACTION, action_type=ActionType.VAULT_DEPOSIT,
        asset=Asset.USDC, amount=100_000_000,
    )
    dag = _dag(intent, grounder=g, literacy_llm=lit, reco_llm=reco)
    wires = await _run(dag, "deposit 100 USDC into the vault")
    assert g.calls == [], "the grounder must NOT be consulted on the build-action path"
    assert all(SENTINEL not in str(m) for m in reco.messages), "no corpus text in build_action"
    assert all(SENTINEL not in str(b) for b in wires), "no corpus text in a block"


class _ThresholdGrounder:
    """Returns a passage only when the caller passes NO threshold (min_score == 0) — simulates a
    below-threshold OTHER hit that must ground NOTHING (B5)."""

    def __init__(self) -> None:
        self.calls: list[float] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        self.calls.append(min_score)
        if min_score > 0.0:
            return ()  # below the OTHER threshold -> nothing grounds
        cite = Citation(provider="X", endpoint="obsidian://x", field="",
                        value="x", as_of="", stale=False)
        return (Passage(content=SENTINEL, citation=cite),)


async def test_other_branch_below_threshold_grounds_nothing() -> None:
    # The OTHER branch passes a similarity threshold; a below-threshold hit yields NO citation block
    # (and no corpus text) — the answer degrades to the ungrounded general help rather than lying.
    g, lit = _ThresholdGrounder(), _RecordingComplete()
    dag = _dag(Intent(kind=IntentKind.OTHER), grounder=g,  # type: ignore[arg-type]
               literacy_llm=lit, reco_llm=_RecordingStructured(StructuredResult(ok=True, value={})))
    wires = await _run(dag, "an unrelated general question")
    assert g.calls and g.calls[0] > 0.0, "OTHER must apply a similarity threshold"
    assert not any(b.get("type") == "citation" for b in wires), "below-threshold must not cite"
