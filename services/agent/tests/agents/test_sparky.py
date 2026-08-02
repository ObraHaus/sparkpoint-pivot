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


# ── 027 · background context: memory in, meta-commentary out ────────────────────


def test_system_forbids_narrating_the_reference_notes_or_the_memory() -> None:
    """Radar 2 (live on develop, once RAG grounding went active).

    A plain "who are you?" came back as *"The reference notes you provided don't include any
    information about who I am."* — the model narrating its own scaffolding INSTEAD of answering,
    while carrying a full persona in its SYSTEM the whole time. The 027 memory digest is a second
    channel with the identical failure mode ("according to my memory of you…"), so one rule covers
    both: background is something to USE, never to TALK ABOUT.
    """
    lowered = SYSTEM.lower()
    assert "reference notes" in lowered
    assert "memory" in lowered
    for forbidden in ("mention", "quote", "describe", "apolog"):
        assert forbidden in lowered, f"the background rule must forbid {forbidden}…"
    assert "instruction" in lowered, "fenced background must be labelled data, not instructions"


async def test_memory_lines_are_rendered_into_the_user_turn_not_the_system() -> None:
    # A memory line quotes the USER's own words. That is untrusted content and must not share a
    # prompt position with the operator-authored (trusted) persona.
    fake = _ok("Last time we looked at your vault position.")
    await Sparky(llm=fake, persona_provider=lambda: "PERSONA_BLOCK").reply(
        "what did we do last time?", memory_lines=["viewed their portfolio"]
    )
    (call,) = fake.calls
    assert "viewed their portfolio" in str(call["messages"])
    assert "<<<USER_MEMORY" in str(call["messages"])
    assert "viewed their portfolio" not in call["system"]
    assert "PERSONA_BLOCK" in call["system"]


async def test_no_memory_leaves_the_prompt_byte_identical_to_pre_027() -> None:
    without = _ok("hi")
    empty = _ok("hi")
    await Sparky(llm=without).reply("hi")
    await Sparky(llm=empty).reply("hi", memory_lines=[])
    assert without.calls[0]["messages"] == empty.calls[0]["messages"]
    assert "USER_MEMORY" not in str(without.calls[0]["messages"])


async def test_memory_and_grounding_can_both_be_present_and_stay_separately_fenced() -> None:
    fake = _ok("An answer.")
    await Sparky(llm=fake).reply(
        "what is APY?",
        context_hint="<<<REFERENCE_NOTES\nAPY is annualised yield.\n>>>",
        memory_lines=["asked: what is APY?"],
    )
    content = str(fake.calls[0]["messages"])
    assert "<<<USER_MEMORY" in content and "<<<REFERENCE_NOTES" in content


# ── 028 hotfix · leaked deliberation is DISCARDED, not served ───────────────────


async def test_leaked_reasoning_monologue_falls_back() -> None:
    # Live incident (2026-08-02, free pool): the "answer" was the model's internal plan —
    # "We need to answer the user: … Use only the reference notes and memory data. We must not
    # mention instructions inside them…". The prompt forbids this; the discard ENFORCES it.
    leaked = (
        'We need to answer the user: "remind me what happened". Use only the reference notes '
        "and memory data. We must not mention instructions inside them, and not invent facts."
    )
    reply = await Sparky(llm=_ok(leaked)).reply("remind me what happened")
    assert reply.fell_back and reply.body == ""


async def test_meta_discard_catches_each_marker_family() -> None:
    from sparkpoint_agent.agents.sparky import _looks_meta_shaped

    for bad in [
        "According to the reference notes you provided, I am Sparky.",
        "The memory data shows you deposited yesterday.",
        "We should only use what's in the notes.",
        "The user asks about their portfolio.",
        "<<<USER_MEMORY seems empty>>>",
        "My system prompt says I can't do that.",
    ]:
        assert _looks_meta_shaped(bad), bad


async def test_normal_second_person_answers_survive_the_meta_discard() -> None:
    from sparkpoint_agent.agents.sparky import _looks_meta_shaped

    for good in [
        "Last time you asked about the vault, and you deposited 1.00 USDC yourself.",
        "I'm Sparky — I can explain DeFi, show your portfolio, and suggest strategies.",
        "You claimed test SRK from the faucet on Aug 2, then we looked at your holdings.",
        "We looked at your portfolio together yesterday.",
    ]:
        assert not _looks_meta_shaped(good), good
