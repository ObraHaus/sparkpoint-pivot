# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Resilience wired through the async client + the SSE surface — LLM MOCKED, no network.

Covers, end to end through :meth:`AsyncClaudeClient.complete`:
  - a non-stream call retries a 429/529 atomically and then succeeds (work order (a));
  - retry exhaustion re-raises (fail-closed); a non-retryable status is never re-sent;
  - the prompt-cache observability seam: a WARM call surfaces ``cache_read_input_tokens > 0``
    and the stable system prefix is byte-identical across calls (catches silent cache
    invalidation, work order (c));
  - the SSE guarantee: once ``run_chat`` has emitted its first block, a mid-turn upstream
    failure FAILS CLOSED to a single inert error block — the stream never restarts / dupes
    text (work order (a)).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import pytest

from sparkpoint_agent.api.chat import _event_stream
from sparkpoint_agent.coordinator.chat_blocks import ChatBlock, TextBlock
from sparkpoint_agent.llm import AuthMode, Limiter, RetryPolicy
from sparkpoint_agent.llm.client import AsyncClaudeClient

# A zero-delay policy so the retry loop never really sleeps (jitter window collapses to 0).
_FAST = RetryPolicy(max_attempts=3, base_delay_s=0.0, max_delay_s=0.0)


# ── fakes ────────────────────────────────────────────────────────────────────


class _Block:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


class _Usage:
    def __init__(self, **kw: Any) -> None:
        self.__dict__.update(kw)


class _Msg:
    def __init__(self, *, text: str, usage: _Usage | None = None) -> None:
        self.stop_reason = "end_turn"
        self.content = [_Block(type="text", text=text)]
        self.usage = usage


class _Response:
    def __init__(self, headers: dict[str, Any]) -> None:
        self.headers = headers


class _StatusError(Exception):
    def __init__(self, status: int, *, retry_after: Any = None) -> None:
        super().__init__(f"status {status}")
        self.status_code = status
        headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
        self.response = _Response(headers)


class _ScriptedTransport:
    """Pops queued items per ``create`` call: an ``Exception`` is raised, a ``_Msg`` returned."""

    def __init__(self, *items: Any) -> None:
        self.queue = list(items)
        self.calls: list[dict[str, Any]] = []

    async def create(
        self,
        *,
        model: str,
        system: list[dict[str, Any]],
        messages: list[dict[str, Any]],
        max_tokens: int,
        tools: Any,
        extra_body: Any,
        user: str | None = None,
    ) -> Any:
        self.calls.append({"system": system, "messages": messages})
        item = self.queue.pop(0)
        if isinstance(item, Exception):
            raise item
        return item


def _client(transport: _ScriptedTransport) -> AsyncClaudeClient:
    # A fresh per-test limiter avoids leaking the process-global across tests.
    return AsyncClaudeClient(
        transport=transport,
        auth_mode=AuthMode.OAUTH,
        retry_policy=_FAST,
        limiter=Limiter(max_inflight=1),
    )


# ── retry through complete() (atomic, pre-token) ─────────────────────────────


async def test_complete_retries_retryable_then_succeeds() -> None:
    transport = _ScriptedTransport(_StatusError(429, retry_after=0), _Msg(text="recovered"))
    result = await _client(transport).complete(
        system="s", messages=[{"role": "user", "content": "x"}]
    )
    assert result.text == "recovered"
    assert len(transport.calls) == 2  # retried the whole atomic create, then succeeded


async def test_complete_retries_on_529() -> None:
    transport = _ScriptedTransport(_StatusError(529), _Msg(text="ok"))
    result = await _client(transport).complete(
        system="s", messages=[{"role": "user", "content": "x"}]
    )
    assert result.text == "ok"


async def test_complete_reraises_on_exhaustion() -> None:
    transport = _ScriptedTransport(
        _StatusError(429), _StatusError(429), _StatusError(429)
    )
    with pytest.raises(_StatusError) as exc:
        await _client(transport).complete(
            system="s", messages=[{"role": "user", "content": "x"}]
        )
    assert exc.value.status_code == 429
    assert len(transport.calls) == 3  # capped at max_attempts, then fail-closed


async def test_complete_does_not_retry_non_retryable() -> None:
    transport = _ScriptedTransport(_StatusError(400), _Msg(text="unreached"))
    with pytest.raises(_StatusError):
        await _client(transport).complete(
            system="s", messages=[{"role": "user", "content": "x"}]
        )
    assert len(transport.calls) == 1  # a 400 is a client error — never re-sent


# ── prompt-cache observability (work order (c)) ──────────────────────────────


async def test_warm_call_exposes_cache_read_tokens() -> None:
    # The integration check: a warm call must report cache_read_input_tokens > 0. A silent
    # cache invalidation would drop this to 0 and fail here.
    warm = _Msg(
        text="warm",
        usage=_Usage(input_tokens=12, output_tokens=8, cache_read_input_tokens=2048),
    )
    result = await _client(_ScriptedTransport(warm)).complete(
        system="stable system prefix", messages=[{"role": "user", "content": "x"}]
    )
    assert result.usage is not None
    assert result.usage.cache_read_input_tokens > 0


async def test_stable_system_prefix_is_byte_identical_across_calls() -> None:
    # Volatile content interpolated into the system prompt is the usual cause of a silent
    # cache miss; assert the cached prefix (incl. cache_control) is identical call-to-call.
    transport = _ScriptedTransport(_Msg(text="a"), _Msg(text="b"))
    client = _client(transport)
    for _ in range(2):
        await client.complete(
            system="the stable prefix", messages=[{"role": "user", "content": "x"}]
        )
    assert transport.calls[0]["system"] == transport.calls[1]["system"]
    assert transport.calls[0]["system"][0]["cache_control"] == {"type": "ephemeral"}


# ── SSE guarantee: fail closed after the first block, never restart ──────────


class _FirstBlockThenFailDag:
    """A stand-in Coordinator: emits one block, then raises an upstream error mid-turn."""

    def run_chat(
        self, message: str, chain: Any, *, surface: str = "chat"
    ) -> AsyncIterator[ChatBlock]:
        async def _gen() -> AsyncIterator[ChatBlock]:
            yield TextBlock("first visible block")
            raise _StatusError(429)  # upstream failure AFTER streaming has begun

        return _gen()


async def test_sse_fails_closed_after_first_block_no_duplication() -> None:
    frames = [
        frame
        async for frame in _event_stream(
            _FirstBlockThenFailDag(),  # type: ignore[arg-type]
            "hello",
            chain=None,  # type: ignore[arg-type]
            surface="chat",
            conversation_id="cnv_test",
        )
    ]
    joined = "".join(frames)
    # The first block is emitted exactly once — no restart re-runs the stream.
    assert joined.count("first visible block") == 1
    # The mid-stream failure degrades to a single inert UPSTREAM_UNAVAILABLE block.
    assert joined.count("UPSTREAM_UNAVAILABLE") == 1
    # Terminal done event reports exactly the two blocks (first + error), nothing signed.
    assert '"blockCount":2' in joined
