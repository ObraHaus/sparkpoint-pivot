# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the Literacy agent (agents/literacy.py) — LLM MOCKED.

Asserts FR-007: a TipCard is emitted for the keyed topic; a refusal or an empty
generation falls back to a pre-written, safe default (never empty, never fabricated);
and the card is inherently non-signable (it carries only a topic + body).
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.agents.literacy import DEFAULT_TIPS, FALLBACK_TOPIC, SYSTEM, Literacy, TipCard
from sparkpoint_agent.llm import LlmResult


class _FakeLlm:
    def __init__(self, result: LlmResult) -> None:
        self._result = result
        self.calls: list[Any] = []

    async def complete(self, *, messages: Any, **_: Any) -> LlmResult:
        self.calls.append(messages)
        return self._result


class _SysRecordingLlm:
    """Captures the ``system`` prompt each call so persona composition can be asserted."""

    def __init__(self) -> None:
        self.systems: list[str] = []

    async def complete(self, *, system: str, messages: Any, **_: Any) -> LlmResult:
        self.systems.append(system)
        return LlmResult(text="ok", stop_reason="end_turn")


async def test_tip_uses_model_text() -> None:
    result = LlmResult(text="  APY means yearly yield.  ", stop_reason="end_turn")
    lit = Literacy(llm=_FakeLlm(result))
    card = await lit.tip("what_is_apy")
    assert isinstance(card, TipCard)
    assert card.topic == "what_is_apy"
    assert card.body == "APY means yearly yield."


async def test_tip_refusal_falls_back_to_default() -> None:
    lit = Literacy(llm=_FakeLlm(LlmResult(text="", stop_reason="refusal", refused=True)))
    card = await lit.tip("what_is_apy")
    assert card.body == DEFAULT_TIPS["what_is_apy"]


async def test_tip_empty_text_falls_back_to_default() -> None:
    lit = Literacy(llm=_FakeLlm(LlmResult(text="   ", stop_reason="end_turn")))
    card = await lit.tip("what_is_slippage")
    assert card.body == DEFAULT_TIPS["what_is_slippage"]


async def test_tip_unknown_topic_uses_general_fallback_on_refusal() -> None:
    lit = Literacy(llm=_FakeLlm(LlmResult(text="", stop_reason="refusal", refused=True)))
    card = await lit.tip("something_obscure")
    assert card.body == DEFAULT_TIPS[FALLBACK_TOPIC]


async def test_tip_none_topic_uses_general_key() -> None:
    lit = Literacy(llm=_FakeLlm(LlmResult(text="general help text", stop_reason="end_turn")))
    card = await lit.tip(None)
    assert card.topic == FALLBACK_TOPIC
    assert card.body == "general help text"


async def test_default_persona_keeps_exact_system() -> None:
    # Back-compat: with no persona provider, the system prompt is EXACTLY the task SYSTEM.
    fake = _SysRecordingLlm()
    await Literacy(llm=fake).tip("what_is_apy")
    assert fake.systems == [SYSTEM]


async def test_persona_is_prepended_to_system() -> None:
    # Persona goes FIRST (establishes character); the task SYSTEM stays LAST and intact.
    fake = _SysRecordingLlm()
    await Literacy(llm=fake, persona_provider=lambda: "PERSONA_SENTINEL_BLOCK").tip("what_is_apy")
    (system,) = fake.systems
    assert "PERSONA_SENTINEL_BLOCK" in system
    assert system.endswith(SYSTEM)
    assert system.startswith("PERSONA_SENTINEL_BLOCK")


async def test_persona_system_is_byte_stable_across_calls() -> None:
    # A process-stable persona provider ⇒ byte-identical system every call (prompt-cache safe).
    fake = _SysRecordingLlm()
    lit = Literacy(llm=fake, persona_provider=lambda: "STABLE_PERSONA")
    await lit.tip("what_is_apy")
    await lit.tip("what_is_a_vault")
    assert fake.systems[0] == fake.systems[1]
