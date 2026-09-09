# ruff: noqa: S101
"""Sparky persona — the trusted-voice wiring + its non-custody boundary.

Persona is injected ONLY into the literacy prose agent (the one free-form surface). These tests pin:
  * WIRING — on a LEARN turn the persona text reaches the literacy SYSTEM prompt (Sparky's voice);
  * BOUNDARY — on a RECOMMEND / BUILD_ACTION turn (understand → propose → policy → assemble) the
    persona text must reach NO recommender input and appear in NO emitted block. Persona shapes tone
    only; it can never influence a signable action (N2, non-custody).
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
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import ActionType, Asset, CapHeadroom

PERSONA = "SPARKY_PERSONA_SENTINEL_BLOCK"
VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15


class _SysComplete:
    """Literacy LLM double — records the SYSTEM prompt (to prove persona wiring)."""

    def __init__(self) -> None:
        self.systems: list[str] = []

    async def complete(self, *, system: str, messages: Any, **_: Any) -> LlmResult:
        self.systems.append(system)
        return LlmResult(text="An answer.", stop_reason="end_turn")


class _RecordingStructured:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result
        self.messages: list[Any] = []
        self.systems: list[Any] = []

    async def structured(
        self, *, messages: Any, system: Any = None, **_: Any
    ) -> StructuredResult[Any]:
        self.messages.append(messages)
        self.systems.append(system)
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


def _dag(
    intent: Intent,
    *,
    literacy_llm: _SysComplete,
    reco_llm: _RecordingStructured,
    sparky_llm: _SysComplete | None = None,
) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=_RecordingStructured(StructuredResult(ok=True, value=intent))),
        recommender=Recommender(llm=reco_llm),
        literacy=Literacy(llm=literacy_llm, persona_provider=lambda: PERSONA),
        # The SECOND persona-bearing prose surface (025) — the general/identity branch.
        sparky=Sparky(llm=sparky_llm or _SysComplete(), persona_provider=lambda: PERSONA),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(MandateView(version=1)),
    )


async def _run(dag: CoordinatorDag, msg: str) -> list[dict[str, Any]]:
    return [b.to_wire() async for b in dag.run_chat(msg, _chain())]


async def test_persona_reaches_literacy_system_on_learn() -> None:
    # WIRING: the persona is prepended to the literacy SYSTEM on the prose path.
    lit = _SysComplete()
    dag = _dag(
        Intent(kind=IntentKind.LEARN, topic="what_is_apy"),
        literacy_llm=lit,
        reco_llm=_RecordingStructured(StructuredResult(ok=True, value={})),
    )
    await _run(dag, "what is APY?")
    assert lit.systems, "the literacy agent must be invoked on a LEARN turn"
    assert all(PERSONA in s for s in lit.systems), "persona must be in the literacy SYSTEM prompt"


async def test_persona_reaches_the_general_responder_on_other() -> None:
    # WIRING (025): the general/identity branch is the SECOND persona surface — "who are you?"
    # must be answered in Sparky's voice, not by the static help line.
    lit, sparky = _SysComplete(), _SysComplete()
    dag = _dag(
        Intent(kind=IntentKind.OTHER),
        literacy_llm=lit,
        reco_llm=_RecordingStructured(StructuredResult(ok=True, value={})),
        sparky_llm=sparky,
    )
    await _run(dag, "who are you?")
    assert sparky.systems, "the general responder must be invoked on an OTHER turn"
    assert all(PERSONA in s for s in sparky.systems), "persona must be in its SYSTEM prompt"


async def test_persona_never_reaches_recommender_or_blocks() -> None:
    # BOUNDARY: a RECOMMEND turn never routes through literacy, so the persona reaches neither the
    # recommender input nor any emitted block — voice can't leak into the action path.
    lit = _SysComplete()
    ranking = {ActionType.VAULT_DEPOSIT: _Rank(rank=1, title="Deposit", rationale="steady")}
    reco = _RecordingStructured(StructuredResult(ok=True, value=ranking))
    dag = _dag(Intent(kind=IntentKind.RECOMMEND), literacy_llm=lit, reco_llm=reco)
    wires = await _run(dag, "where can I earn yield?")
    assert all(PERSONA not in str(m) for m in reco.messages), "no persona in recommender messages"
    assert all(PERSONA not in str(s) for s in reco.systems), "no persona in recommender system"
    assert all(PERSONA not in str(b) for b in wires), "no persona text in any emitted block"


async def test_persona_never_reaches_build_action_path() -> None:
    lit = _SysComplete()
    ranking = {ActionType.VAULT_DEPOSIT: _Rank(rank=1, title="Deposit", rationale="steady")}
    reco = _RecordingStructured(StructuredResult(ok=True, value=ranking))
    intent = Intent(
        kind=IntentKind.BUILD_ACTION, action_type=ActionType.VAULT_DEPOSIT,
        asset=Asset.USDC, amount=100_000_000,
    )
    dag = _dag(intent, literacy_llm=lit, reco_llm=reco)
    wires = await _run(dag, "deposit 100 USDC into the vault")
    assert all(PERSONA not in str(m) for m in reco.messages), "no persona in build_action propose"
    assert all(PERSONA not in str(b) for b in wires), "no persona text in any emitted block"
