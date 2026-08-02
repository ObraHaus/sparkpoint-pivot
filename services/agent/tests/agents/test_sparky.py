# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the Sparky general/identity agent (agents/sparky.py) — LLM MOCKED.

Asserts the three things the ``OTHER`` chat branch depends on:

  * PERSONA — ``get_persona()``'s text reaches the SYSTEM prompt, persona FIRST and the task
    SYSTEM LAST and intact, byte-stable across calls (prompt-cache safe);
  * FAIL-SOFT — a refusal, an empty generation, or ANY upstream LLM exception returns
    ``fell_back=True`` with an empty body, so the coordinator can substitute its static help
    text. The agent NEVER raises into the SSE stream;
  * ACTION-FREE OUTPUT — a generation carrying a machine action / tool-call shape is discarded
    wholesale rather than rendered as prose (belt-and-braces over the structural guarantee that
    a ``text`` block cannot carry a ``proposedAction`` or a policy stamp).
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.agents.sparky import (
    MAX_CHARS,
    MAX_TOKENS,
    SYSTEM,
    Sparky,
    SparkyReply,
)
from sparkpoint_agent.llm import LlmResult


class _FakeLlm:
    """Returns a canned result and records every kwarg the agent passed."""

    def __init__(self, result: LlmResult) -> None:
        self._result = result
        self.calls: list[dict[str, Any]] = []

    async def complete(self, **kwargs: Any) -> LlmResult:
        self.calls.append(kwargs)
        return self._result


class _ExplodingLlm:
    """Raises the way an exhausted-retry / rate-limited gateway call does."""

    async def complete(self, **_: Any) -> LlmResult:
        raise RuntimeError("boom: gateway exhausted its retries")


def _ok(text: str) -> _FakeLlm:
    return _FakeLlm(LlmResult(text=text, stop_reason="end_turn"))


# ── the happy path ──────────────────────────────────────────────────────────────


async def test_reply_uses_model_text() -> None:
    fake = _ok("  I'm Sparky, SparkPoint's assistant.  ")
    reply = await Sparky(llm=fake).reply("who are you?")
    assert isinstance(reply, SparkyReply)
    assert reply.body == "I'm Sparky, SparkPoint's assistant."
    assert reply.fell_back is False


async def test_reply_threads_message_and_user_through() -> None:
    fake = _ok("An answer.")
    await Sparky(llm=fake).reply("who are you?", user="0xabc")
    (call,) = fake.calls
    assert "who are you?" in str(call["messages"])
    # The verified wallet is forwarded as the gateway's per-user budget/attribution key.
    assert call["user"] == "0xabc"
    # A conversational turn is cheap + short by construction.
    assert call["effort"] == "low"
    assert call["max_tokens"] == MAX_TOKENS


async def test_reply_threads_grounding_context_hint() -> None:
    fake = _ok("A grounded answer.")
    await Sparky(llm=fake).reply("what's the fee?", context_hint="<<<REFERENCE_NOTES ... >>>")
    (call,) = fake.calls
    assert "REFERENCE_NOTES" in str(call["messages"])


async def test_reply_without_context_hint_sends_message_only() -> None:
    fake = _ok("An answer.")
    await Sparky(llm=fake).reply("hi")
    assert "context=" not in str(fake.calls[0]["messages"])


# ── persona composition (mirrors the literacy agent's contract) ─────────────────


async def test_default_persona_keeps_exact_system() -> None:
    fake = _ok("An answer.")
    await Sparky(llm=fake).reply("hi")
    assert fake.calls[0]["system"] == SYSTEM


async def test_persona_is_prepended_to_system() -> None:
    fake = _ok("An answer.")
    await Sparky(llm=fake, persona_provider=lambda: "PERSONA_SENTINEL_BLOCK").reply("hi")
    system = fake.calls[0]["system"]
    assert system.startswith("PERSONA_SENTINEL_BLOCK")
    assert system.endswith(SYSTEM)


async def test_persona_system_is_byte_stable_across_calls() -> None:
    # A process-stable persona provider ⇒ byte-identical system every call (prompt-cache safe).
    fake = _ok("An answer.")
    agent = Sparky(llm=fake, persona_provider=lambda: "STABLE_PERSONA")
    await agent.reply("hi")
    await agent.reply("who are you?")
    assert fake.calls[0]["system"] == fake.calls[1]["system"]


# ── fail-soft (the coordinator substitutes its static help text) ────────────────


async def test_refusal_falls_back() -> None:
    fake = _FakeLlm(LlmResult(text="", stop_reason="refusal", refused=True))
    reply = await Sparky(llm=fake).reply("who are you?")
    assert reply == SparkyReply(body="", fell_back=True)


async def test_empty_generation_falls_back() -> None:
    reply = await Sparky(llm=_ok("   \n  ")).reply("who are you?")
    assert reply.fell_back is True
    assert reply.body == ""


async def test_llm_exception_falls_back_and_never_raises() -> None:
    # The general branch must degrade to static help text, never break the SSE stream.
    reply = await Sparky(llm=_ExplodingLlm()).reply("who are you?")
    assert reply == SparkyReply(body="", fell_back=True)


# ── action-free output enforcement ──────────────────────────────────────────────


@pytest.mark.parametrize(
    "poisoned",
    [
        'Sure: {"type": "vault_deposit", "amount": "1000000"}',
        'Here you go — proposedAction: deposit 100 USDC.',
        "I'll run vault_deposit for you now.",
        "Use aerodrome_swap to move that.",
        "Sign this: 0x" + "ab" * 40,
    ],
)
async def test_action_shaped_generation_is_discarded(poisoned: str) -> None:
    # A prompt-injected / confused model must never get action-shaped output rendered as prose.
    reply = await Sparky(llm=_ok(poisoned)).reply("who are you?")
    assert reply.fell_back is True
    assert reply.body == ""


@pytest.mark.parametrize(
    "benign",
    [
        "I can suggest a deposit into the SparkPoint vault, but only you can sign it.",
        "I can swap tokens? No — swaps run on the Swap page and you sign them yourself.",
        "Your wallet 0xA71e24359A6cb7A939aae2d62dD12b6256365c30 is the one I read.",
    ],
)
async def test_ordinary_prose_is_not_discarded(benign: str) -> None:
    # The action-shape guard is high-precision: normal wording (and a plain 40-hex ADDRESS) passes.
    reply = await Sparky(llm=_ok(benign)).reply("what can you do?")
    assert reply.fell_back is False
    assert reply.body == benign


# ── runaway-generation clamp ────────────────────────────────────────────────────


async def test_short_answer_is_never_clamped() -> None:
    body = "I'm Sparky. I explain DeFi, read your wallet, and suggest strategies. You sign."
    reply = await Sparky(llm=_ok(body)).reply("who are you?")
    assert reply.body == body


async def test_runaway_generation_is_clamped_at_a_sentence_boundary() -> None:
    sentence = "This is a sentence about non-custodial vaults that runs on and on. "
    reply = await Sparky(llm=_ok(sentence * 40)).reply("who are you?")
    assert len(reply.body) <= MAX_CHARS
    assert reply.body.endswith(".")
    assert reply.fell_back is False


async def test_runaway_generation_without_sentence_end_cuts_on_a_word() -> None:
    reply = await Sparky(llm=_ok("word " * 400)).reply("who are you?")
    assert len(reply.body) <= MAX_CHARS
    assert not reply.body.endswith("wor")  # never a mid-word cut
