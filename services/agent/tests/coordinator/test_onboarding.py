# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the deterministic onboarding step machine (coordinator/onboarding.py).

The planner + literacy LLMs are MOCKED (canned results); the step machine + the mandate
derivation are the REAL deterministic code. These assert the §3.1 contract:

  - a full onboarding walk reaches a terminal ``mandate_draft`` block;
  - the draft is derived deterministically (same answers → same draft) and fails SAFE to
    the most conservative mandate on an unrecognized answer;
  - NOTHING in the stream is ever signable (no ``proposedAction``/``policy``/signature);
  - a free-text side-question is answered inline (literacy tip / safe REFUSAL) WITHOUT
    advancing the machine or ever producing a mandate_draft from a refusal.
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.coordinator.onboarding import (
    InMemoryOnboardingStore,
    OnboardingMachine,
    OnboardingStep,
    build_mandate_draft,
)
from sparkpoint_agent.llm import LlmResult, StructuredResult

SID = "onb_test"


# ── fakes ─────────────────────────────────────────────────────────────────────


class _StructuredLlm:
    def __init__(self, result: StructuredResult[Any]) -> None:
        self._result = result

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return self._result


class _CompleteLlm:
    def __init__(self, text: str) -> None:
        self._text = text

    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text=self._text, stop_reason="end_turn")


def _machine(
    *, intent: Intent | None = None, refused: bool = False, tip: str = "APY is your yearly yield."
) -> OnboardingMachine:
    if refused:
        planner_result: StructuredResult[Any] = StructuredResult(ok=False, refused=True)
    else:
        planner_result = StructuredResult(ok=True, value=intent or Intent(kind=IntentKind.OTHER))
    return OnboardingMachine(
        planner=Planner(llm=_StructuredLlm(planner_result)),
        literacy=Literacy(llm=_CompleteLlm(tip)),
        store=InMemoryOnboardingStore(),
    )


async def _collect(
    machine: OnboardingMachine,
    *,
    step: OnboardingStep,
    user_message: str | None = None,
    selections: dict[str, Any] | None = None,
    session_id: str = SID,
) -> list[dict[str, Any]]:
    return [
        block.to_wire()
        async for block in machine.turn(
            session_id=session_id,
            step=step,
            user_message=user_message,
            selections=selections,
        )
    ]


def _types(wires: list[dict[str, Any]]) -> list[str]:
    return [w["type"] for w in wires]


def _assert_never_signable(wires: list[dict[str, Any]]) -> None:
    for wire in wires:
        assert "proposedAction" not in wire
        assert "policy" not in wire
        assert "signature" not in wire
        assert "intentBundle" not in wire


async def _walk_to_draft(
    machine: OnboardingMachine, *, session_id: str = SID
) -> list[list[dict[str, Any]]]:
    """Drive a realistic full onboarding walk; return the blocks emitted per turn."""
    turns: list[list[dict[str, Any]]] = []
    turns.append(await _collect(machine, step=OnboardingStep.WELCOME, session_id=session_id))
    turns.append(await _collect(machine, step=OnboardingStep.CONNECT, session_id=session_id))
    turns.append(
        await _collect(
            machine,
            step=OnboardingStep.EXPERIENCE,
            selections={"experience": "new"},
            session_id=session_id,
        )
    )
    turns.append(
        await _collect(
            machine,
            step=OnboardingStep.GOALS,
            selections={"goals": ["grow_savings"]},
            session_id=session_id,
        )
    )
    turns.append(
        await _collect(
            machine,
            step=OnboardingStep.TIMELINE,
            selections={"timeline": "medium"},
            session_id=session_id,
        )
    )
    turns.append(
        await _collect(
            machine,
            step=OnboardingStep.RISK_SCENARIO,
            selections={"scenario": "hold"},
            session_id=session_id,
        )
    )
    return turns


# ── the flow reaches a mandate_draft ──────────────────────────────────────────


async def test_onboarding_reaches_mandate_draft() -> None:
    machine = _machine()
    turns = await _walk_to_draft(machine)
    final = turns[-1]
    assert "mandate_draft" in _types(final)
    draft = next(w for w in final if w["type"] == "mandate_draft")["mandate"]
    assert draft["riskProfile"] == "conservative"
    assert draft["riskParams"] == {
        "maxSlippageBps": 50,
        "drawdownTolerance": "low",
        "horizonMonths": 24,  # "medium" timeline
    }
    assert draft["goals"] == [{"kind": "grow_savings", "label": "Grow my savings safely"}]
    assert draft["version"] == 1
    assert isinstance(draft["summaryText"], str) and draft["summaryText"]
    # Every block of the whole walk is inert — nothing signable ever streams.
    for turn in turns:
        _assert_never_signable(turn)


async def test_welcome_greets_then_prompts_connect() -> None:
    machine = _machine()
    wires = await _collect(machine, step=OnboardingStep.WELCOME)
    assert _types(wires) == ["text", "text"]  # greeting + first question


async def test_intermediate_steps_emit_a_single_text_prompt() -> None:
    machine = _machine()
    await _collect(machine, step=OnboardingStep.WELCOME)
    wires = await _collect(machine, step=OnboardingStep.CONNECT)
    assert _types(wires) == ["text"]
    assert "mandate_draft" not in _types(wires)


# ── determinism + fail-safe derivation ────────────────────────────────────────


async def test_onboarding_walk_is_deterministic() -> None:
    first = (await _walk_to_draft(_machine(), session_id="a"))[-1]
    second = (await _walk_to_draft(_machine(), session_id="b"))[-1]
    assert first == second


async def test_unknown_answers_fail_safe_to_conservative() -> None:
    draft = build_mandate_draft({"scenario": "yolo", "timeline": "whenever", "goals": []})
    assert draft.risk_profile == "conservative"
    assert draft.risk_params.max_slippage_bps == 50
    assert draft.risk_params.drawdown_tolerance == "low"
    assert draft.risk_params.horizon_months == 12  # default horizon
    assert draft.goals[0].kind == "grow_savings"  # default goal


async def test_buy_more_scenario_maps_to_moderate() -> None:
    draft = build_mandate_draft({"scenario": "buy_more", "timeline": "long"})
    assert draft.risk_profile == "moderate"
    assert draft.risk_params.max_slippage_bps == 100
    assert draft.risk_params.drawdown_tolerance == "medium"
    assert draft.risk_params.horizon_months == 60


async def test_draft_summary_states_profit_only_fee() -> None:
    draft = build_mandate_draft({"scenario": "hold"})
    assert "0% on principal" in draft.summary_text
    assert "profit-only" in draft.summary_text


# ── side-questions never advance the machine ──────────────────────────────────


async def test_side_question_learn_emits_tip_without_advancing() -> None:
    machine = _machine(
        intent=Intent(kind=IntentKind.LEARN, topic="what_is_apy"), tip="APY is yield."
    )
    wires = await _collect(
        machine, step=OnboardingStep.GOALS, user_message="what is APY?"
    )
    assert "tip" in _types(wires)
    tip = next(w for w in wires if w["type"] == "tip")
    assert tip["topic"] == "what_is_apy"
    assert tip["body"] == "APY is yield."
    # A side-question re-prompts the CURRENT step and never produces a draft.
    assert "mandate_draft" not in _types(wires)
    _assert_never_signable(wires)


async def test_side_question_refusal_fails_closed() -> None:
    machine = _machine(refused=True)
    wires = await _collect(
        machine, step=OnboardingStep.GOALS, user_message="help me launder funds"
    )
    assert any(w["type"] == "error" and w["code"] == "REFUSAL" for w in wires)
    assert "mandate_draft" not in _types(wires)


async def test_review_step_re_emits_draft() -> None:
    machine = _machine()
    await _walk_to_draft(machine)
    # Re-submitting the terminal step re-emits the draft (idempotent), still non-signable.
    wires = await _collect(machine, step=OnboardingStep.REVIEW)
    assert "mandate_draft" in _types(wires)
    _assert_never_signable(wires)
