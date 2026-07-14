# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the Planner (agents/planner.py) — LLM MOCKED.

Asserts the ``understand`` stage's fail-closed contract: valid classifications extract
whitelisted params; an unknown kind, off-whitelist action, or unparseable amount is
coerced away safely; and a refusal / malformed model turn yields a benign ``OTHER``
intent the DAG can never build an action from.
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner, _parse_intent
from sparkpoint_agent.llm import StructuredResult
from sparkpoint_agent.policy import ActionType, Asset


class _FakeLlm:
    """A stand-in for AsyncClaudeClient.structured returning a canned StructuredResult."""

    def __init__(self, result: StructuredResult[Intent]) -> None:
        self._result = result
        self.calls: list[Any] = []

    async def structured(self, *, messages: Any, **_: Any) -> StructuredResult[Intent]:
        self.calls.append(messages)
        return self._result


# ── _parse_intent ────────────────────────────────────────────────────────────


def test_parse_intent_recommend() -> None:
    intent = _parse_intent({"kind": "recommend", "asset": "USDC"})
    assert intent.kind is IntentKind.RECOMMEND
    assert intent.asset is Asset.USDC


def test_parse_intent_build_action_extracts_amount() -> None:
    intent = _parse_intent(
        {"kind": "build_action", "actionType": "vault_deposit", "asset": "USDC",
         "amount": "100000000"}
    )
    assert intent.kind is IntentKind.BUILD_ACTION
    assert intent.action_type is ActionType.VAULT_DEPOSIT
    assert intent.amount == 100_000_000


def test_parse_intent_unknown_kind_defaults_other() -> None:
    assert _parse_intent({"kind": "banana"}).kind is IntentKind.OTHER


def test_parse_intent_off_whitelist_action_dropped() -> None:
    # session_key_grant is a real ActionType but NOT an advisory action — dropped to None.
    intent = _parse_intent({"kind": "build_action", "actionType": "session_key_grant"})
    assert intent.action_type is None


def test_parse_intent_bad_amounts_dropped() -> None:
    assert _parse_intent({"kind": "build_action", "amount": "100.5"}).amount is None
    assert _parse_intent({"kind": "build_action", "amount": "abc"}).amount is None
    assert _parse_intent({"kind": "build_action", "amount": "0"}).amount is None
    assert _parse_intent({"kind": "build_action", "amount": -5}).amount is None
    assert _parse_intent({"kind": "build_action", "amount": True}).amount is None


def test_parse_intent_learn_topic() -> None:
    intent = _parse_intent({"kind": "learn", "topic": "what_is_apy"})
    assert intent.kind is IntentKind.LEARN
    assert intent.topic == "what_is_apy"


def test_parse_intent_non_dict_raises() -> None:
    with pytest.raises(TypeError):
        _parse_intent(["not", "a", "dict"])


# ── Planner.classify ─────────────────────────────────────────────────────────


async def test_classify_returns_parsed_intent() -> None:
    want = Intent(kind=IntentKind.RECOMMEND, asset=Asset.USDC)
    planner = Planner(llm=_FakeLlm(StructuredResult(ok=True, value=want)))
    got = await planner.classify("where can I earn yield?")
    assert got is want
    assert planner.llm.calls  # the LLM was actually consulted


async def test_classify_refusal_is_safe_other() -> None:
    planner = Planner(llm=_FakeLlm(StructuredResult(ok=False, refused=True)))
    got = await planner.classify("do something sketchy")
    assert got.kind is IntentKind.OTHER
    assert got.refused is True
    assert got.action_type is None


async def test_classify_malformed_defaults_other() -> None:
    planner = Planner(llm=_FakeLlm(StructuredResult(ok=False, error="no json")))
    got = await planner.classify("garbled")
    assert got.kind is IntentKind.OTHER
    assert got.refused is False
