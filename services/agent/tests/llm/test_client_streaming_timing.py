# ruff: noqa: S101, S105  (pytest asserts; test-only fake key)
"""063 — the gateway transport must yield SSE frames as they arrive.

Pins the bottom of the stack independently of the agent: a real localhost HTTP server writes five
OpenAI-compatible SSE chunks 200 ms apart, and ``OpenAICompatTransport.stream`` (through
``AsyncClaudeClient.stream_complete``) must surface the first delta long before the last. This is
the exact seam the LiteLLM guard proxy sits above; if either the transport or the client buffers,
first-text collapses onto done again.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Callable

from sparkpoint_agent.llm import AsyncClaudeClient, AuthMode
from sparkpoint_agent.llm.client import OpenAICompatTransport


async def _serve_sse(
    frames: int, delay: float, on_frame: Callable[[int], None]
) -> tuple[asyncio.AbstractServer, int]:
    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = await reader.read(4096)
            if not chunk:
                writer.close()
                return
            head += chunk
        writer.write(
            b"HTTP/1.1 200 OK\r\n"
            b"content-type: text/event-stream\r\n"
            b"transfer-encoding: chunked\r\n\r\n"
        )
        await writer.drain()
        try:
            for index in range(frames):
                await asyncio.sleep(delay)
                payload = {
                    "choices": [
                        {"delta": {"content": f"tok{index} "}, "finish_reason": None}
                    ]
                }
                body = f"data: {json.dumps(payload)}\n\n".encode()
                writer.write(f"{len(body):x}\r\n".encode() + body + b"\r\n")
                await writer.drain()
                on_frame(index)
            tail = (
                b'data: {"choices":[{"delta":{},"finish_reason":"stop"}],'
                b'"usage":{"prompt_tokens":1,"completion_tokens":5}}\n\ndata: [DONE]\n\n'
            )
            writer.write(f"{len(tail):x}\r\n".encode() + tail + b"\r\n0\r\n\r\n")
            await writer.drain()
        finally:
            writer.close()

    server = await asyncio.start_server(handle, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    return server, port


async def test_gateway_transport_yields_deltas_while_the_server_is_still_writing() -> None:
    sent: list[float] = []
    start = time.monotonic()
    server, port = await _serve_sse(5, 0.2, lambda _i: sent.append(time.monotonic()))
    transport = OpenAICompatTransport(
        base_url=f"http://127.0.0.1:{port}", api_key="test-virtual-key"
    )
    client = AsyncClaudeClient(transport=transport, auth_mode=AuthMode.GATEWAY)

    async def collect() -> AsyncIterator[float]:
        async for chunk in client.stream_complete(
            system="s", messages=[{"role": "user", "content": "hi"}]
        ):
            if chunk.delta:
                yield time.monotonic() - start

    try:
        arrivals = [delta_at async for delta_at in collect()]
    finally:
        server.close()
        await server.wait_closed()

    total = time.monotonic() - start
    assert len(arrivals) == 5
    assert arrivals[0] < 0.4 * total, (arrivals, total)
    # And the transport saw the frames spread out, not one batch at the end.
    assert sent[-1] - sent[0] > 0.5
