# ruff: noqa: S101
"""025 · Task 1 — the GENERAL / identity branch (``IntentKind.OTHER``) of the Coordinator DAG.

Before 025 this branch emitted ONE hardcoded sentence whenever corpus grounding was empty — which
on a deployment without an embedding backend is always — so "who are you?", "what can you do?" and
"what's the weather?" all got the same canned line. These tests pin the fix and its guardrails:

  * ROUTING — an OTHER turn calls the persona-bearing responder and surfaces ITS answer;
  * PERSONA — the persona text reaches that responder's SYSTEM prompt (Sparky's voice);
  * PROSE-ONLY — the branch can never emit an action / recommendation block, and it returns
    before the gather → propose → policy_gate stages run at all;
  * FALLBACK (rewritten by 029) — an LLM failure/refusal is RETRIED once and, if it fails
    again, surfaced as an honest error block. The Aug-3 regression watched three good questions
    (the persona intro, the memory recall, the withdrawal explanation) silently collapse to the
    canned help line under back-to-back use, which reads to a tester as a stupid assistant
    rather than a degraded one. ``_GENERAL_HELP`` now survives ONLY where nothing failed —
    the non-chat consumers that wire no responder at all;
  * HONEST CITATIONS — a grounded answer cites its passages, but a FALLBACK answer does not
    (the static text is not grounded in them).
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.coordinator.dag import (
    _GENERAL_FAILURE,
    _GENERAL_HELP,
    ChainContext,
    CoordinatorDag,
    MandateView,
    PortfolioView,
)
from sparkpoint_agent.knowledge import Passage
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import CapHeadroom
from sparkpoint_agent.wire import Citation

PERSONA = "SPARKY_PERSONA_SENTINEL_BLOCK"
SENTINEL = "GROUNDED_PASSAGE_SENTINEL_TEXT"
ANSWER = "I'm Sparky, SparkPoint's assistant. Only you can sign a transaction."
VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15


class _RecordingComplete:
    """Prose LLM double — records system + messages, returns a canned result."""

    def __init__(self, result: LlmResult | None = None) -> None:
        self._result = result or LlmResult(text=ANSWER, stop_reason="end_turn")
        self.systems: list[str] = []
        self.messages: list[Any] = []

    async def complete(self, *, system: str, messages: Any, **_: Any) -> LlmResult:
        self.systems.append(system)
        self.messages.append(messages)
        return self._result


class _ExplodingComplete:
    def __init__(self) -> None:
        self.calls = 0

    async def complete(self, **_: Any) -> LlmResult:
        self.calls += 1
        raise RuntimeError("boom: the model gateway is down")


class _FlakyComplete:
    """Fails the FIRST call and succeeds on the second — the observed transient (029).

    Back-to-back turns in the Aug-3 battery hit a gateway timeout that cleared immediately;
    the same prompts answered fine when paced. That is exactly what one retry is for.
    """

    def __init__(self, *, good: str = ANSWER) -> None:
        self.calls = 0
        self._good = good

    async def complete(self, **_: Any) -> LlmResult:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("boom: transient gateway timeout")
        return LlmResult(text=self._good, stop_reason="end_turn")


class _StructuredLlm:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result
        self.messages: list[Any] = []

    async def structured(self, *, messages: Any = None, **_: Any) -> StructuredResult[Any]:
        self.messages.append(messages)
        return self._result


class _ExplodingPortfolio:
    """Proves the OTHER branch returns BEFORE stage 2 — if gather ran, this would blow up."""

    async def read(self, chain: ChainContext) -> PortfolioView:
        raise AssertionError("the general branch must never reach the gather stage")


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return MandateView(version=1)


class _FakeGrounder:
    def __init__(self, *, hit: bool) -> None:
        self._hit = hit
        self.calls: list[str] = []

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        self.calls.append(query)
        if not self._hit:
            return ()
        cite = Citation(provider="SparkPoint", endpoint="obsidian://vault-fee", field="",
                        value="fee", as_of="", stale=False)
        return (Passage(content=SENTINEL, citation=cite),)


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453, user_account=USER, owner=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
    )


def _dag(
    *,
    sparky_llm: Any = None,
    grounder: _FakeGrounder | None = None,
    with_sparky: bool = True,
) -> CoordinatorDag:
    llm = sparky_llm if sparky_llm is not None else _RecordingComplete()
    intent = Intent(kind=IntentKind.OTHER)
    return CoordinatorDag(
        planner=Planner(llm=_StructuredLlm(StructuredResult(ok=True, value=intent))),
        recommender=Recommender(llm=_StructuredLlm(StructuredResult(ok=True, value={}))),
        literacy=Literacy(llm=_RecordingComplete()),
        sparky=Sparky(llm=llm, persona_provider=lambda: PERSONA) if with_sparky else None,
        portfolio_provider=_ExplodingPortfolio(),
        mandate_provider=_Mandate(),
        knowledge=grounder,  # type: ignore[arg-type]
    )


async def _run(dag: CoordinatorDag, msg: str) -> list[dict[str, Any]]:
    return [b.to_wire() async for b in dag.run_chat(msg, _chain())]


def _texts(wires: list[dict[str, Any]]) -> list[str]:
    return [w["markdown"] for w in wires if w["type"] == "text"]


# ── routing + persona ───────────────────────────────────────────────────────────


async def test_identity_question_answers_with_the_model_not_the_canned_line() -> None:
    dag = _dag()
    wires = await _run(dag, "who are you?")
    assert _texts(wires) == [ANSWER]
    assert _GENERAL_HELP not in _texts(wires)


async def test_persona_reaches_the_general_responder_system_prompt() -> None:
    llm = _RecordingComplete()
    await _run(_dag(sparky_llm=llm), "what can you do?")
    assert llm.systems, "the general responder must be invoked on an OTHER turn"
    assert all(PERSONA in s for s in llm.systems), "persona must be in the general SYSTEM prompt"


async def test_user_message_reaches_the_general_responder() -> None:
    llm = _RecordingComplete()
    await _run(_dag(sparky_llm=llm), "what's the weather like?")
    assert any("weather" in str(m) for m in llm.messages)


# ── prose-only / non-custody ────────────────────────────────────────────────────


async def test_general_branch_emits_only_prose_scaffolding() -> None:
    # No action, no recommendation, no portfolio snapshot — and _ExplodingPortfolio proves the
    # branch returned before the gather stage could run.
    wires = await _run(_dag(), "hello there")
    kinds = {w["type"] for w in wires}
    assert kinds <= {"tool_step", "text", "citation"}
    assert not (kinds & {"action", "recommendation", "portfolio_snapshot"})


async def test_action_shaped_generation_never_reaches_the_wire() -> None:
    # An action-shaped "prose" answer is discarded by the agent. It is discarded on the retry
    # too, so what the user sees is the honest error — never the poisoned payload.
    poisoned = LlmResult(text='{"type": "vault_deposit", "amount": "999"}', stop_reason="end_turn")
    wires = await _run(_dag(sparky_llm=_RecordingComplete(poisoned)), "who are you?")
    assert _texts(wires) == []
    assert not any(w["type"] in {"action", "recommendation"} for w in wires)
    assert all("vault_deposit" not in str(w) for w in wires)


# ── fallback ────────────────────────────────────────────────────────────────────


async def test_a_transient_failure_is_retried_and_the_user_gets_the_real_answer() -> None:
    llm = _FlakyComplete()
    wires = await _run(_dag(sparky_llm=llm), "who are you?")
    assert llm.calls == 2, "the first failure must be retried exactly once"
    assert _texts(wires) == [ANSWER]
    assert not any(w["type"] == "error" for w in wires)


async def test_a_persistent_failure_is_admitted_not_disguised_as_an_answer() -> None:
    llm = _ExplodingComplete()
    wires = await _run(_dag(sparky_llm=llm), "who are you?")
    assert llm.calls == 2, "one attempt, then one retry"
    assert _texts(wires) == [], "a failed turn must not produce prose at all"
    errors = [w for w in wires if w["type"] == "error"]
    assert len(errors) == 1
    assert errors[0]["message"] == _GENERAL_FAILURE
    assert _GENERAL_HELP not in str(wires), "the canned capability pitch must NOT stand in"
    assert "nothing was signed" in errors[0]["message"].lower(), "reassure about funds"


async def test_model_refusal_is_also_retried_then_admitted() -> None:
    refused = LlmResult(text="", stop_reason="refusal", refused=True)
    llm = _RecordingComplete(refused)
    wires = await _run(_dag(sparky_llm=llm), "who are you?")
    assert len(llm.systems) == 2
    assert _texts(wires) == []
    assert [w["message"] for w in wires if w["type"] == "error"] == [_GENERAL_FAILURE]


async def test_the_failure_block_is_not_written_into_the_transcript() -> None:
    # 029: an error block is excluded from the persisted set, so reopening the conversation
    # shows no phantom answer where the model never produced one (025/0028 replay).
    from sparkpoint_agent.api.chat import _PERSISTED_BLOCK_TYPES

    assert "error" not in _PERSISTED_BLOCK_TYPES


async def test_unwired_responder_keeps_the_static_help_text() -> None:
    # The non-chat DAG consumers build no prose responder. NOTHING failed here — there is no
    # transient to retry and no outage to admit — so the static help text remains correct.
    wires = await _run(_dag(with_sparky=False), "who are you?")
    assert _texts(wires) == [_GENERAL_HELP]
    assert not any(w["type"] == "error" for w in wires)


# ── grounding + honest citations ────────────────────────────────────────────────


async def test_grounded_general_answer_cites_its_passages() -> None:
    grounder, llm = _FakeGrounder(hit=True), _RecordingComplete()
    wires = await _run(_dag(sparky_llm=llm, grounder=grounder), "what's the vault fee?")
    assert grounder.calls, "the general branch still consults the grounder"
    assert any(SENTINEL in str(m) for m in llm.messages), "passage text grounds the prose turn"
    assert any(w["type"] == "citation" for w in wires)


async def test_ungrounded_general_answer_cites_nothing() -> None:
    grounder = _FakeGrounder(hit=False)
    wires = await _run(_dag(grounder=grounder), "who are you?")
    assert grounder.calls
    assert not any(w["type"] == "citation" for w in wires)
    assert _texts(wires) == [ANSWER], "no grounding still means a real, persona-bearing answer"


async def test_failed_turn_never_cites_passages_it_did_not_use() -> None:
    # Grounding HIT but the model failed twice → the honest error is shown, and citing those
    # passages would claim a provenance no answer has (there IS no answer).
    wires = await _run(
        _dag(sparky_llm=_ExplodingComplete(), grounder=_FakeGrounder(hit=True)),
        "what's the vault fee?",
    )
    assert _texts(wires) == []
    assert not any(w["type"] == "citation" for w in wires)
    assert any(w["type"] == "error" for w in wires)


# ── 029/FR-014 · a refusal must not borrow someone else's sources ───────────────


async def test_a_declining_answer_carries_no_citations() -> None:
    # Observed: ERC-4626 documentation cited beneath "I can't move your funds", which reads as
    # though the refusal were something the docs say.
    decline = LlmResult(
        text="I can't move your funds — only you can sign a transaction.", stop_reason="end_turn"
    )
    wires = await _run(
        _dag(sparky_llm=_RecordingComplete(decline), grounder=_FakeGrounder(hit=True)),
        "can you move my USDC into the vault for me?",
    )
    assert _texts(wires) == ["I can't move your funds — only you can sign a transaction."]
    assert not any(w["type"] == "citation" for w in wires)


async def test_an_answer_that_merely_mentions_a_limit_still_cites_its_sources() -> None:
    # "I can't" partway through is not a refusal — the answer is still grounded work.
    answer = LlmResult(
        text="Vault shares track your slice of the pool, though I can't predict future yield.",
        stop_reason="end_turn",
    )
    wires = await _run(
        _dag(sparky_llm=_RecordingComplete(answer), grounder=_FakeGrounder(hit=True)),
        "what are vault shares?",
    )
    assert any(w["type"] == "citation" for w in wires)


# ── 029/FR-003 · a literacy turn that degraded must not pose as an explanation ──


async def test_a_topic_without_its_own_default_admits_failure_instead_of_generic_copy() -> None:
    """The verification run asked "Is the Aave vault safe?" and got back:

        "SparkPoint is a non-custodial assistant: it can suggest and simulate strategies…"

    True, unrelated, and indistinguishable from an assistant that didn't understand the question.
    That generic line is the LAST-RESORT default for a topic with no pre-written answer, so
    reaching it means the turn failed — and a failed turn must look failed.
    """
    dag = _dag(sparky_llm=_RecordingComplete())
    # Force the LEARN branch with a topic that has no entry in DEFAULT_TIPS.
    dag.planner = Planner(
        llm=_StructuredLlm(
            StructuredResult(
                ok=True, value=Intent(kind=IntentKind.LEARN, topic="aave_vault_safety")
            )
        )
    )
    dag.literacy = Literacy(llm=_ExplodingComplete())
    wires = await _run(dag, "Is the Aave vault safe?")

    assert not any(w["type"] == "tip" for w in wires), "no generic card standing in for an answer"
    assert [w["message"] for w in wires if w["type"] == "error"] == [_GENERAL_FAILURE]


async def test_a_topic_with_a_real_default_still_answers_from_it() -> None:
    # `what_is_apy` has a pre-written answer that genuinely answers the question — degrade to it
    # rather than erroring, because the user gets a correct explanation either way.
    from sparkpoint_agent.agents.literacy import DEFAULT_TIPS

    dag = _dag(sparky_llm=_RecordingComplete())
    dag.planner = Planner(
        llm=_StructuredLlm(
            StructuredResult(ok=True, value=Intent(kind=IntentKind.LEARN, topic="what_is_apy"))
        )
    )
    dag.literacy = Literacy(llm=_ExplodingComplete())
    wires = await _run(dag, "what is APY?")

    tips = [w for w in wires if w["type"] == "tip"]
    assert len(tips) == 1
    assert tips[0]["body"] == DEFAULT_TIPS["what_is_apy"]
    assert not any(w["type"] == "error" for w in wires)


async def test_a_degraded_tip_is_retried_before_being_given_up_on() -> None:
    llm = _FlakyComplete(good="A vault is as safe as its contracts and its lending market are.")
    dag = _dag(sparky_llm=_RecordingComplete())
    dag.planner = Planner(
        llm=_StructuredLlm(
            StructuredResult(
                ok=True, value=Intent(kind=IntentKind.LEARN, topic="aave_vault_safety")
            )
        )
    )
    dag.literacy = Literacy(llm=llm)
    wires = await _run(dag, "Is the Aave vault safe?")

    assert llm.calls == 2, "one attempt, then one retry"
    tips = [w for w in wires if w["type"] == "tip"]
    assert len(tips) == 1 and "contracts" in tips[0]["body"]
