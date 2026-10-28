"""Tiny guard reverse-proxy in front of LiteLLM (same container, 127.0.0.1 — no inter-container
DNS). LiteLLM's `main-stable` image can't disable `/` (Swagger), `/ui` (admin login), or
`/openapi.json` via env, so this fronts it on :4000 and returns 404 for those info/UI surfaces
while proxying every functional endpoint (/chat/completions, /key/*, /health/*, …) to LiteLLM on
:4001. It adds NO auth of its own — LiteLLM's master/virtual-key auth is unchanged; this only
removes the anonymous UI/schema surface.

063 — SSE MUST STREAM. The agent's final prose turn opens `/chat/completions` with
``"stream": true`` and forwards each token as an SSE ``text-delta``. The original guard read the
whole upstream response with ``httpx.request(...)`` and rebuilt it with ``Response(content=...)``,
which buffered every token until the model had finished: the user saw tool-step rows on time and
then the complete answer at once (first-text ≈ done). A streamed request is now relayed chunk by
chunk with ``send(stream=True)`` + ``StreamingResponse``; non-streaming JSON calls keep the simple
buffered path.
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response, StreamingResponse
from starlette.routing import Route

UPSTREAM = "http://127.0.0.1:4001"
# Exactly these paths + anything under /ui are the anonymous UI/schema surfaces to hide.
_BLOCK_EXACT = {"/", "/docs", "/redoc", "/openapi.json"}
_BLOCK_PREFIX = ("/ui", "/swagger")
# Hop-by-hop headers we must not forward back. ``content-length`` in particular is invalid on a
# streamed (chunked) relay.
_STRIP = {"content-length", "transfer-encoding", "connection", "keep-alive"}

_client = httpx.AsyncClient(base_url=UPSTREAM, timeout=180.0)


def _wants_stream(body: bytes, request: Request) -> bool:
    """True for an OpenAI-style streaming completion (``"stream": true`` in the JSON body).

    The agent's ``httpx`` streaming call sends no SSE ``Accept`` header, so the JSON body — not
    the Accept header — is the reliable signal. The header is still honoured for other clients.
    """
    if body:
        try:
            payload = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            payload = None
        if isinstance(payload, dict):
            return bool(payload.get("stream"))
    return "text/event-stream" in request.headers.get("accept", "")


async def _relay(upstream: httpx.Response) -> AsyncIterator[bytes]:
    """Forward the upstream body incrementally and always release the connection."""
    try:
        async for chunk in upstream.aiter_raw():
            yield chunk
    finally:
        await upstream.aclose()


async def _proxy(request: Request) -> Response:
    path = request.url.path
    if path in _BLOCK_EXACT or any(
        path == prefix or path.startswith(prefix + "/") for prefix in _BLOCK_PREFIX
    ):
        return Response("Not Found", status_code=404)
    url = httpx.URL(path=path, query=request.url.query.encode("utf-8"))
    fwd = [(k, v) for k, v in request.headers.raw if k.lower() != b"host"]
    body = await request.body()

    if _wants_stream(body, request):
        upstream = await _client.send(
            _client.build_request(request.method, url, headers=fwd, content=body),
            stream=True,
        )
        headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _STRIP}
        if upstream.status_code >= 400:
            # A rejected stream (e.g. unknown stream_options) is a normal response, not a relay.
            content = await upstream.aread()
            await upstream.aclose()
            return Response(content=content, status_code=upstream.status_code, headers=headers)
        # Defence-in-depth against any intermediary (Traefik) buffering or compressing the SSE.
        headers.setdefault("cache-control", "no-cache, no-transform")
        headers["x-accel-buffering"] = "no"
        return StreamingResponse(
            _relay(upstream), status_code=upstream.status_code, headers=headers
        )

    upstream = await _client.request(request.method, url, headers=fwd, content=body)
    headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _STRIP}
    return Response(content=upstream.content, status_code=upstream.status_code, headers=headers)


app = Starlette(
    routes=[Route("/{path:path}", _proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])]
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=4000, log_level="warning")  # noqa: S104 — Traefik fronts it
