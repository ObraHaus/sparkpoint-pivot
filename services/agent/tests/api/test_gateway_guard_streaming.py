# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism in pytest)
"""063 — the in-container LiteLLM guard proxy must RELAY SSE, never buffer it.

The deployed path is ``agent → Traefik → guard(:4000) → LiteLLM(:4001)``. The guard used to call
``httpx.request(...)`` and rebuild the response from ``upstream.content``, so every streamed token
arrived only after the model finished (first-text ≈ done) even though LiteLLM itself streamed.
This test drives ``guard._proxy`` with a fake upstream that yields five chunks slowly and asserts
the returned ``StreamingResponse`` exposes them as they arrive.
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import time
import types
from pathlib import Path
from typing import Any

import pytest
from starlette.requests import Request
from starlette.responses import StreamingResponse

GUARD_PATH = Path(__file__).resolve().parents[3] / "litellm" / "guard.py"


def _load_guard() -> types.ModuleType:
    spec = importlib.util.spec_from_file_location("sparkpoint_litellm_guard", GUARD_PATH)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class _Upstream:
    def __init__(self, *, chunks: int = 5, delay: float = 0.1) -> None:
        self.status_code = 200
        self.headers = {"content-type": "text/event-stream"}
        self.chunks = chunks
        self.delay = delay
        self.closed = False
        self.content = b'ok'

    async def aiter_raw(self) -> Any:
        for i in range(self.chunks):
            await asyncio.sleep(self.delay)
            yield f"data: {{\"i\": {i}}}\n\n".encode()

    async def aread(self) -> bytes:
        return b"error"

    async def aclose(self) -> None:
        self.closed = True


class _Client:
    def __init__(self, upstream: _Upstream) -> None:
        self.upstream = upstream
        self.streamed = False

    def build_request(self, *_: Any, **__: Any) -> object:
        return object()

    async def send(self, _request: Any, *, stream: bool) -> _Upstream:
        self.streamed = stream
        return self.upstream

    async def request(self, *_args: Any, **_kwargs: Any) -> _Upstream:
        return self.upstream


def _request(payload: dict[str, Any], *, accept: str = "application/json") -> Request:
    body = json.dumps(payload).encode()
    scope = {
        "type": "http",
        "method": "POST",
        "scheme": "http",
        "path": "/chat/completions",
        "raw_path": b"/chat/completions",
        "query_string": b"",
        "headers": [(b"accept", accept.encode()), (b"content-type", b"application/json")],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    }
    sent = {"done": False}

    async def receive() -> dict[str, Any]:
        if sent["done"]:
            return {"type": "http.disconnect"}
        sent["done"] = True
        return {"type": "http.request", "body": body, "more_body": False}

    return Request(scope, receive)


async def test_streamed_completion_is_relayed_chunk_by_chunk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = _load_guard()
    upstream = _Upstream()
    client = _Client(upstream)
    monkeypatch.setattr(guard, "_client", client)

    response = await guard._proxy(_request({"model": "x", "stream": True}))
    assert isinstance(response, StreamingResponse)
    assert client.streamed is True
    assert response.status_code == 200
    assert "content-length" not in {k.lower() for k in response.headers}

    times: list[float] = []
    start = time.monotonic()
    async for _ in response.body_iterator:
        times.append(time.monotonic() - start)

    assert len(times) == 5
    # The first chunk must arrive well before the last's deadline, not all together at the end.
    assert times[0] < 0.4 * times[-1], times
    assert upstream.closed, "the upstream connection is released after the relay"


async def test_non_streaming_json_keeps_the_buffered_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    guard = _load_guard()
    upstream = _Upstream()
    client = _Client(upstream)
    monkeypatch.setattr(guard, "_client", client)

    response = await guard._proxy(_request({"model": "x", "stream": False}))
    assert client.streamed is False
    assert not isinstance(response, StreamingResponse)
    assert response.body == b"ok"
