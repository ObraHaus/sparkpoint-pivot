# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the Literacy agent (agents/literacy.py) — LLM MOCKED.

Asserts FR-007: a TipCard is emitted for the keyed topic; a refusal or an empty
generation falls back to a pre-written, safe default (never empty, never fabricated);
and the card is inherently non-signable (it carries only a topic + body).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

from sparkpoint_agent.agents.literacy import (
    DEFAULT_TIPS,
    FALLBACK_TOPIC,
    SYSTEM,
    Literacy,
    TipCard,
    TipChunk,
)
from sparkpoint_agent.llm import LlmResult, StreamChunk


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


# ── 073 · incremental streaming guard on the tip path ──────────────────────────


class _ScriptedStreamLlm:
    """Pops one ``(deltas, full_text)`` script entry per ``stream_complete`` call."""

    def __init__(self, script: list[tuple[list[str], str]]) -> None:
        self._script = list(script)
        self.consumed = 0
        self.calls = 0
        self.closed = 0

    async def stream_complete(self, **_: Any) -> AsyncIterator[StreamChunk]:
        self.calls += 1
        deltas, text = self._script.pop(0)
        try:
            for delta in deltas:
                self.consumed += 1
                yield StreamChunk(delta=delta)
            yield StreamChunk(result=LlmResult(text=text, stop_reason="end_turn"))
        finally:
            self.closed += 1


async def _stream_tip(
    script: list[tuple[list[str], str]], topic: str = "what_is_apy"
) -> tuple[_ScriptedStreamLlm, list[TipChunk]]:
    llm = _ScriptedStreamLlm(script)
    lit = Literacy(llm=llm)  # type: ignore[arg-type]
    chunks = [chunk async for chunk in lit.stream_tip(topic)]
    return llm, chunks


async def test_tip_streams_complete_sentences_and_the_terminal_card() -> None:
    first = "APY means the yearly return on a deposit. "
    second = "It is an estimate, not a promise."
    llm, chunks = await _stream_tip([([first, second], first + second)])

    painted = "".join(chunk.delta for chunk in chunks if chunk.delta)
    assert painted == first + second
    assert not any(chunk.retract for chunk in chunks)
    assert llm.closed == 1
    card = next(chunk.card for chunk in chunks if chunk.card is not None)
    assert card == TipCard(topic="what_is_apy", body=first + second, fell_back=False)


async def test_tip_meta_phrase_mid_stream_is_never_painted_and_retries() -> None:
    bad = "I don't have information about that in the reference notes provided. "
    good = "APY means the yearly return on a deposit. It is an estimate."
    llm, chunks = await _stream_tip(
        [
            ([bad, "This tail must never be pulled."], bad + "This tail must never be pulled."),
            ([good], good),
        ]
    )

    painted = "".join(chunk.delta for chunk in chunks if chunk.delta)
    assert painted == good
    assert "reference notes" not in painted
    # Attempt 1 is closed early (two deltas pulled, not three), then attempt 2 runs.
    assert llm.calls == 2
    assert llm.closed == 2
    painted_pieces = [(chunk.delta, chunk.attempt) for chunk in chunks if chunk.delta]
    assert {attempt for _, attempt in painted_pieces} == {2}
    assert "".join(piece for piece, _ in painted_pieces) == good
    retracts = [chunk for chunk in chunks if chunk.retract]
    assert retracts == []  # attempt 1 never painted, so there is nothing to clear
    card = next(chunk.card for chunk in chunks if chunk.card is not None)
    assert card.body == good


async def test_tip_action_shape_at_the_start_paints_nothing_then_retries() -> None:
    bad = '{"type": "vault_deposit", "amount": "1"}'
    good = "A vault pools deposits. Your shares represent your portion."
    llm, chunks = await _stream_tip([([bad, "never pulled"], bad), ([good], good)])

    assert "".join(chunk.delta for chunk in chunks if chunk.delta) == good
    assert not any(chunk.retract for chunk in chunks)
    assert not any(chunk.attempt == 1 and chunk.delta for chunk in chunks)
    # The bad chunk tripped; its tail was never pulled, then the whole good answer was.
    assert llm.consumed == 2


async def test_tip_retracts_when_an_attempt_painted_before_the_trip() -> None:
    first = "APY means the yearly return on a deposit. "
    bad = "The user asks about APY. "
    llm, chunks = await _stream_tip(
        [
            ([first, bad, "tail"], first + bad + "tail"),
            (["A different answer."], "A different answer."),
        ]
    )

    painted = "".join(chunk.delta for chunk in chunks if chunk.delta)
    assert "The user asks" not in painted
    retracts = [chunk for chunk in chunks if chunk.retract]
    assert retracts == [TipChunk(retract=True, attempt=1)]
    assert [chunk.attempt for chunk in chunks if chunk.delta] == [1, 2]
    card = next(chunk.card for chunk in chunks if chunk.card is not None)
    assert card.body == "A different answer."


async def test_tip_both_attempts_guarded_falls_back_to_the_safe_default() -> None:
    bad = "The user asks about APY. "
    llm, chunks = await _stream_tip([([bad], bad), ([bad], bad)])

    assert [chunk.delta for chunk in chunks if chunk.delta] == []
    assert not any(chunk.retract for chunk in chunks)
    card = next(chunk.card for chunk in chunks if chunk.card is not None)
    assert card == TipCard(topic="what_is_apy", body=DEFAULT_TIPS["what_is_apy"], fell_back=True)
    assert llm.calls == 2
