# ruff: noqa: S101, S105, S106  (pytest asserts; test-only fixture creds, never real secrets)
"""059/A2 — streamed completions at the LLM boundary (no network).

Pins the contract the SSE surface depends on:
  * the gateway transport parses OpenAI SSE deltas + terminal usage into a full ``LlmResult``;
  * a non-streaming transport degrades to ONE whole-text delta, so the feature is additive;
  * a pre-delta stream failure falls back to the non-streaming call (gateway without SSE);
  * a mid-stream failure is NOT retried (that would duplicate text) and propagates to the agent.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx
import pytest

from sparkpoint_agent.llm import AsyncClaudeClient, AuthMode
from sparkpoint_agent.llm.client import (
    GatewayError,
    OpenAICompatTransport,
    StreamChunk,
)

_VKEY = "sk-virtual-DO-NOT-LEAK"


class _Block:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


class _Msg:
    def __init__(self, text: str, *, stop_reason: str = "end_turn") -> None:
        self.stop_reason = stop_reason
        self.content = [_Block(type="text", text=text)]
        self.stop_details = None
        self.usage = None


@dataclass
class _WholeMessageTransport:
    """A transport with NO ``stream`` — the Anthropic path / an older test double."""

    text: str
    complete_calls: int = 0

    async def create(self, **_: Any) -> Any:
        self.complete_calls += 1
        return _Msg(self.text)


@dataclass
class _StreamingTransport:
    """A fake streaming transport; ``fail_at`` raises after that many deltas."""

    deltas: list[str]
    fail_at: int | None = None
    fail_status: int = 529
    stream_calls: int = 0
    complete_calls: int = 0

    async def create(self, **_: Any) -> Any:
        self.complete_calls += 1
        return _Msg("".join(self.deltas))

    async def stream(self, **_: Any) -> AsyncIterator[Any]:
        self.stream_calls += 1
        for i, delta in enumerate(self.deltas):
            if self.fail_at is not None and i == self.fail_at:
                raise GatewayError(self.fail_status)
            yield _piece(delta=delta)

    def stream_calls_count(self) -> int:
        return self.stream_calls


class _Piece:
    def __init__(
        self, *, delta: str | None = None, finish_reason: str | None = None, usage: Any = None
    ) -> None:
        self.delta = delta
        self.finish_reason = finish_reason
        self.usage = usage


def _piece(
    *, delta: str | None = None, finish_reason: str | None = None, usage: Any = None
) -> _Piece:
    return _Piece(delta=delta, finish_reason=finish_reason, usage=usage)


async def _collect(client: AsyncClaudeClient) -> list[StreamChunk]:
    return [
        chunk
        async for chunk in client.stream_complete(
            system="You are helpful.", messages=[{"role": "user", "content": "hi"}]
        )
    ]


def _client(transport: Any) -> AsyncClaudeClient:
    return AsyncClaudeClient(transport=transport, auth_mode=AuthMode.GATEWAY)


async def test_streaming_transport_yields_deltas_then_the_full_result() -> None:
    transport = _StreamingTransport(deltas=["Hel", "lo ", "there"])
    chunks = await _collect(_client(transport))
    assert [c.delta for c in chunks if c.delta is not None] == ["Hel", "lo ", "there"]
    assert chunks[-1].result is not None
    assert chunks[-1].result.text == "Hello there"


async def test_non_streaming_transport_degrades_to_one_whole_delta() -> None:
    transport = _WholeMessageTransport(text="A whole answer.")
    chunks = await _collect(_client(transport))
    assert len(chunks) == 2
    assert chunks[0].delta == "A whole answer."
    assert chunks[1].result is not None and chunks[1].result.text == "A whole answer."
    assert transport.complete_calls == 1


async def test_pre_delta_stream_failure_falls_back_to_non_streaming() -> None:
    transport = _StreamingTransport(deltas=["never"], fail_at=0, fail_status=400)
    chunks = await _collect(_client(transport))
    # The fallback produced the WHOLE answer as one delta via `complete`, not an error.
    assert chunks[0].delta == "never"
    assert chunks[-1].result is not None and chunks[-1].result.text == "never"
    assert transport.complete_calls == 1


async def test_mid_stream_failure_propagates_without_retry_or_duplicate_text() -> None:
    transport = _StreamingTransport(deltas=["half", "rest"], fail_at=1)
    seen: list[str] = []
    with pytest.raises(GatewayError):
        async for chunk in _client(transport).stream_complete(
            system="s", messages=[{"role": "user", "content": "hi"}]
        ):
            if chunk.delta:
                seen.append(chunk.delta)
    assert seen == ["half"]  # what the user saw, never re-sent
    assert transport.complete_calls == 0  # no whole-message retry after content


async def test_gateway_transport_parses_sse_and_terminal_usage() -> None:
    frames = [
        {"choices": [{"delta": {"content": "Spark"}}]},
        {"choices": [{"delta": {"content": "y"}}]},
        {"choices": [{"delta": {}, "finish_reason": "stop"}]},
        {"choices": [], "usage": {"prompt_tokens": 7, "completion_tokens": 2}},
    ]
    body = "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames) + "data: [DONE]\n\n"

    def handler(request: httpx.Request) -> httpx.Response:
        assert json.loads(request.content)["stream"] is True
        assert json.loads(request.content)["stream_options"] == {"include_usage": True}
        assert request.headers["authorization"] == f"Bearer {_VKEY}"
        return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})

    transport = OpenAICompatTransport(
        base_url="http://gw.example/v1",
        api_key=_VKEY,
        client=httpx.AsyncClient(transport=httpx.MockTransport(handler)),  # type: ignore[arg-type]
    )
    client = AsyncClaudeClient(transport=transport, auth_mode=AuthMode.GATEWAY)
    chunks = [
        c
        async for c in client.stream_complete(
            system="s", messages=[{"role": "user", "content": "hi"}], user="0xWALLET"
        )
    ]
    assert "".join(c.delta or "" for c in chunks) == "Sparky"
    result = chunks[-1].result
    assert result is not None
    assert result.text == "Sparky"
    assert result.stop_reason == "end_turn"
    assert result.usage is not None
    assert result.usage.input_tokens == 7
    assert result.usage.output_tokens == 2
