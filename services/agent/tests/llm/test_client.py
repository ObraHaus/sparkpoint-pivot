# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the async Claude client (llm/client.py) — LLM MOCKED via a fake transport.

Covers the custody-critical guarantees:
  - refusal is detected BEFORE any content is read (no fabrication from a declined turn);
  - raw chain-of-thought (``thinking`` blocks) NEVER reaches the normalized text;
  - structured output is fail-closed on refusal / non-JSON / schema-invalid output;
  - the OAuth system prompt carries the required Claude-Code prefix + a cached block;
  - adaptive thinking + per-agent effort are sent verbatim in ``extra_body``.

No network + no ``anthropic`` import: every message comes from :class:`_FakeTransport`.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from sparkpoint_agent.llm import AuthMode, ClaudeAuthError
from sparkpoint_agent.llm.client import (
    CLAUDE_CODE_SYSTEM_PREFIX,
    AsyncClaudeClient,
    extract_json,
    normalize_message,
)

# ── Fake SDK message + transport ─────────────────────────────────────────────


class _Block:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


class _Details:
    def __init__(self, category: str) -> None:
        self.category = category


class _Msg:
    def __init__(
        self, *, stop_reason: str | None, content: list[Any], stop_details: Any = None
    ) -> None:
        self.stop_reason = stop_reason
        self.content = content
        self.stop_details = stop_details


@dataclass
class _FakeTransport:
    """A queue-backed transport; records each request and pops the next canned message."""

    queue: list[Any]
    calls: list[dict[str, Any]]

    def __init__(self, *messages: Any) -> None:
        self.queue = list(messages)
        self.calls = []

    async def create(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        tools: Any,
        extra_body: Any,
    ) -> Any:
        self.calls.append(
            {
                "model": model,
                "system": system,
                "messages": messages,
                "max_tokens": max_tokens,
                "tools": tools,
                "extra_body": dict(extra_body),
            }
        )
        return self.queue.pop(0)


def _text_msg(text: str, *, thinking: str | None = None) -> _Msg:
    content: list[Any] = []
    if thinking is not None:
        content.append(_Block(type="thinking", thinking=thinking))
    content.append(_Block(type="text", text=text))
    return _Msg(stop_reason="end_turn", content=content)


def _client(
    transport: _FakeTransport, *, auth_mode: AuthMode = AuthMode.API_KEY
) -> AsyncClaudeClient:
    return AsyncClaudeClient(transport=transport, auth_mode=auth_mode)


# ── normalize_message ────────────────────────────────────────────────────────


def test_normalize_drops_thinking_blocks() -> None:
    msg = _text_msg("visible answer", thinking="SECRET internal chain of thought")
    result = normalize_message(msg)
    assert result.text == "visible answer"
    assert "SECRET" not in result.text
    assert result.refused is False


def test_normalize_refusal_first_ignores_content() -> None:
    msg = _Msg(
        stop_reason="refusal",
        content=[_Block(type="text", text="should never be read")],
        stop_details=_Details("policy"),
    )
    result = normalize_message(msg)
    assert result.refused is True
    assert result.text == ""
    assert result.refusal_category == "policy"


def test_normalize_collects_tool_calls() -> None:
    msg = _Msg(
        stop_reason="tool_use",
        content=[_Block(type="tool_use", id="t1", name="get_positions", input={"account": "0x1"})],
    )
    result = normalize_message(msg)
    assert len(result.tool_calls) == 1
    assert result.tool_calls[0].name == "get_positions"
    assert result.tool_calls[0].input == {"account": "0x1"}


# ── complete ─────────────────────────────────────────────────────────────────


async def test_complete_returns_text_and_records_extra_body() -> None:
    transport = _FakeTransport(_text_msg("hello"))
    client = _client(transport)
    result = await client.complete(
        system="be helpful",
        messages=[{"role": "user", "content": "hi"}],
        effort="high",
    )
    assert result.text == "hello"
    body = transport.calls[0]["extra_body"]
    assert body["thinking"] == {"type": "adaptive"}
    assert body["output_config"] == {"effort": "high"}


async def test_complete_without_thinking_omits_field() -> None:
    transport = _FakeTransport(_text_msg("ok"))
    client = _client(transport)
    await client.complete(system="s", messages=[{"role": "user", "content": "x"}], thinking=False)
    assert "thinking" not in transport.calls[0]["extra_body"]


async def test_oauth_system_prompt_prefixed_and_cached() -> None:
    transport = _FakeTransport(_text_msg("ok"))
    client = _client(transport, auth_mode=AuthMode.OAUTH)
    await client.complete(
        system="You are the assistant.", messages=[{"role": "user", "content": "x"}]
    )
    system = transport.calls[0]["system"]
    assert len(system) == 1
    assert system[0]["text"].startswith(CLAUDE_CODE_SYSTEM_PREFIX)
    assert system[0]["cache_control"] == {"type": "ephemeral"}


async def test_api_key_system_prompt_not_prefixed() -> None:
    transport = _FakeTransport(_text_msg("ok"))
    client = _client(transport, auth_mode=AuthMode.API_KEY)
    await client.complete(system="plain system", messages=[{"role": "user", "content": "x"}])
    assert transport.calls[0]["system"][0]["text"] == "plain system"


# ── structured (fail-closed) ─────────────────────────────────────────────────


def _parse_kind(payload: Any) -> str:
    if not isinstance(payload, dict) or "kind" not in payload:
        raise KeyError("kind")
    return str(payload["kind"])


async def test_structured_ok_parses_json() -> None:
    transport = _FakeTransport(_text_msg('answer: {"kind": "recommend"} done'))
    client = _client(transport)
    result = await client.structured(
        system="classify", messages=[{"role": "user", "content": "m"}], parse=_parse_kind
    )
    assert result.ok is True
    assert result.value == "recommend"


async def test_structured_no_json_fails_closed() -> None:
    transport = _FakeTransport(_text_msg("there is no json in this reply"))
    client = _client(transport)
    result = await client.structured(
        system="classify", messages=[{"role": "user", "content": "m"}], parse=_parse_kind
    )
    assert result.ok is False
    assert result.value is None
    assert result.error is not None


async def test_structured_schema_invalid_fails_closed() -> None:
    transport = _FakeTransport(_text_msg('{"unexpected": 1}'))
    client = _client(transport)
    result = await client.structured(
        system="classify", messages=[{"role": "user", "content": "m"}], parse=_parse_kind
    )
    assert result.ok is False
    assert result.error is not None
    assert "schema parse failed" in result.error


async def test_structured_refusal_fails_closed() -> None:
    refusal = _Msg(stop_reason="refusal", content=[], stop_details=_Details("policy"))
    transport = _FakeTransport(refusal)
    client = _client(transport)
    result = await client.structured(
        system="classify", messages=[{"role": "user", "content": "m"}], parse=_parse_kind
    )
    assert result.ok is False
    assert result.refused is True
    assert result.value is None


# ── extract_json edge cases ──────────────────────────────────────────────────


def test_extract_json_handles_brace_in_string() -> None:
    assert extract_json('x {"s": "a}b{c", "k": 5} y') == {"s": "a}b{c", "k": 5}


def test_extract_json_returns_none_on_garbage() -> None:
    assert extract_json("no json here at all") is None
    assert extract_json("") is None


# ── from_env fail-closed ─────────────────────────────────────────────────────


def test_from_env_without_credentials_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEW_ANTHROPIC_OAUTH_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_OAUTH_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    with pytest.raises(ClaudeAuthError):
        AsyncClaudeClient.from_env()


def test_from_env_prefers_new_oauth_over_legacy_and_api_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Work order (0): NEW_ANTHROPIC_OAUTH_TOKEN wins over the legacy OAuth token and the key.
    monkeypatch.setenv("NEW_ANTHROPIC_OAUTH_TOKEN", "new-oauth")
    monkeypatch.setenv("ANTHROPIC_OAUTH_TOKEN", "legacy-oauth")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "plain-key")
    client = AsyncClaudeClient.from_env()
    assert client.auth_mode is AuthMode.OAUTH
    # The token value must never leak through the client/transport repr.
    assert "new-oauth" not in repr(client)
    assert "new-oauth" not in repr(client.transport)


def test_from_env_falls_back_to_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("NEW_ANTHROPIC_OAUTH_TOKEN", raising=False)
    monkeypatch.delenv("ANTHROPIC_OAUTH_TOKEN", raising=False)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "plain-key")
    client = AsyncClaudeClient.from_env()
    assert client.auth_mode is AuthMode.API_KEY
    assert "plain-key" not in repr(client)
