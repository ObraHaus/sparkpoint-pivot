# ruff: noqa: S101, S105, S106  (pytest asserts; test-only fixture creds, never real secrets)
"""OpenAI-compatible LiteLLM gateway transport (Phase A) — no network.

Verifies the DEFAULT LLM path: the OpenAI `/chat/completions` request shape (system+messages
conversion, the `user` field), the Anthropic-`Message` adapter (so `normalize_message` works
unchanged), fail-closed error mapping (`GatewayError.status_code` → resilience retries 429/529),
the virtual key never leaking, and `from_env` preferring the gateway over the Anthropic path.
"""

from __future__ import annotations

import json

import httpx
import pytest

from sparkpoint_agent.llm import AsyncClaudeClient, AuthMode
from sparkpoint_agent.llm.claude import gateway_from_env
from sparkpoint_agent.llm.client import (
    GatewayError,
    OpenAICompatTransport,
    normalize_message,
    set_model_alias,
)
from sparkpoint_agent.llm.resilience import is_retryable, status_code

_VKEY = "sk-virtual-DO-NOT-LEAK"


def _transport(handler: object) -> OpenAICompatTransport:
    return OpenAICompatTransport(
        base_url="http://gw.example/v1",
        api_key=_VKEY,
        model="sparkpoint-chat",
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),  # type: ignore[arg-type]
    )


async def test_request_shape_and_adapter() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "hi there"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 11, "completion_tokens": 3},
                "model": "openrouter/google/gemma-4-26b-a4b-it:free",
            },
        )

    t = _transport(handler)
    msg = await t.create(
        model="ignored",
        system=[
            {"type": "text", "text": "You are helpful.", "cache_control": {"type": "ephemeral"}}
        ],
        messages=[{"role": "user", "content": "hello"}],
        max_tokens=64,
        tools=None,
        extra_body={"thinking": {"type": "adaptive"}},  # dropped on this path
        user="0xWALLET",
    )
    # adapter → normalize_message reads it as an Anthropic Message
    result = normalize_message(msg)
    assert result.text == "hi there"
    assert result.stop_reason == "end_turn"
    assert result.usage is not None
    assert result.usage.input_tokens == 11
    assert result.usage.output_tokens == 3

    body = captured["body"]
    assert body["model"] == "sparkpoint-chat"  # the alias, not the caller's model
    assert body["user"] == "0xWALLET"  # per-user field forwarded
    assert body["messages"][0] == {"role": "system", "content": "You are helpful."}  # no CC prefix
    assert body["messages"][1] == {"role": "user", "content": "hello"}
    assert "thinking" not in body  # Anthropic params dropped
    assert captured["url"] == "http://gw.example/v1/chat/completions"
    assert captured["auth"] == f"Bearer {_VKEY}"


async def test_http_error_maps_to_retryable_gatewayerror_without_leaking_key() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(429, json={"error": "rate limited"})

    with pytest.raises(GatewayError) as ei:
        await _transport(handler).create(
            model="x", system=[], messages=[{"role": "user", "content": "hi"}],
            max_tokens=8, tools=None, extra_body={},
        )
    exc = ei.value
    assert exc.status_code == 429
    assert status_code(exc) == 429 and is_retryable(exc)  # resilience will retry it
    assert _VKEY not in str(exc)


async def test_network_error_is_retryable_529() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("boom")

    with pytest.raises(GatewayError) as ei:
        await _transport(handler).create(
            model="x", system=[], messages=[{"role": "user", "content": "hi"}],
            max_tokens=8, tools=None, extra_body={},
        )
    assert ei.value.status_code == 529 and is_retryable(ei.value)


def test_from_env_prefers_gateway(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("LITELLM_BASE_URL", "http://gw.example/v1")
    monkeypatch.setenv("LITELLM_API_KEY", _VKEY)
    monkeypatch.setenv("LITELLM_MODEL", "sparkpoint-chat")
    # even with an Anthropic OAuth token present, the gateway wins (it's the default path)
    monkeypatch.setenv("NEW_ANTHROPIC_OAUTH_TOKEN", "oauth-should-not-be-used")
    assert gateway_from_env() == ("http://gw.example/v1", _VKEY, "sparkpoint-chat")
    client = AsyncClaudeClient.from_env()
    assert client.auth_mode is AuthMode.GATEWAY
    assert isinstance(client.transport, OpenAICompatTransport)


def test_from_env_falls_back_to_anthropic(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("LITELLM_BASE_URL", "LITELLM_API_KEY", "LITELLM_MODEL"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setenv("NEW_ANTHROPIC_OAUTH_TOKEN", "oauth-token")
    client = AsyncClaudeClient.from_env()
    assert client.auth_mode is AuthMode.OAUTH


def _capture_model_transport() -> tuple[OpenAICompatTransport, dict[str, object]]:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["model"] = json.loads(request.content)["model"]
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": "ok"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1},
                "model": "x",
            },
        )

    return _transport(handler), captured


async def _one_turn(t: OpenAICompatTransport) -> None:
    await t.create(
        model="ignored",
        system=[{"type": "text", "text": "sys"}],
        messages=[{"role": "user", "content": "hi"}],
        max_tokens=16,
        tools=None,
        extra_body={},
        user="0xabc",
    )


async def test_model_alias_override_routes_premium_to_its_alias() -> None:
    # Feature 008 US4: a per-request tier alias (premium) overrides the transport's default alias.
    t, captured = _capture_model_transport()
    set_model_alias("sparkpoint-chat-premium")
    try:
        await _one_turn(t)
    finally:
        set_model_alias(None)
    assert captured["model"] == "sparkpoint-chat-premium"


async def test_model_defaults_to_transport_alias_when_unset() -> None:
    t, captured = _capture_model_transport()
    set_model_alias(None)  # free / no override
    await _one_turn(t)
    assert captured["model"] == "sparkpoint-chat"  # the transport's configured default
