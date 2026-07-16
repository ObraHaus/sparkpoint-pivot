"""Tiny guard reverse-proxy in front of LiteLLM (same container, 127.0.0.1 — no inter-container
DNS). LiteLLM's `main-stable` image can't disable `/` (Swagger), `/ui` (admin login), or
`/openapi.json` via env, so this fronts it on :4000 and returns 404 for those info/UI surfaces
while proxying every functional endpoint (/chat/completions, /key/*, /health/*, …) to LiteLLM on
:4001. It adds NO auth of its own — LiteLLM's master/virtual-key auth is unchanged; this only
removes the anonymous UI/schema surface. Buffered proxy (the agent calls are non-streaming)."""

from __future__ import annotations

import httpx
import uvicorn
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

UPSTREAM = "http://127.0.0.1:4001"
# Exactly these paths + anything under /ui are the anonymous UI/schema surfaces to hide.
_BLOCK_EXACT = {"/", "/docs", "/redoc", "/openapi.json"}
_BLOCK_PREFIX = ("/ui", "/swagger")
# Hop-by-hop headers we must not forward back.
_STRIP = {"content-length", "transfer-encoding", "connection", "keep-alive"}

_client = httpx.AsyncClient(base_url=UPSTREAM, timeout=180.0)


async def _proxy(request: Request) -> Response:
    path = request.url.path
    if path in _BLOCK_EXACT or any(path == p or path.startswith(p + "/") or path == p for p in _BLOCK_PREFIX):
        return Response("Not Found", status_code=404)
    url = httpx.URL(path=path, query=request.url.query.encode("utf-8"))
    fwd = [(k, v) for k, v in request.headers.raw if k.lower() != b"host"]
    body = await request.body()
    upstream = await _client.request(request.method, url, headers=fwd, content=body)
    headers = {k: v for k, v in upstream.headers.items() if k.lower() not in _STRIP}
    return Response(content=upstream.content, status_code=upstream.status_code, headers=headers)


app = Starlette(
    routes=[Route("/{path:path}", _proxy, methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])]
)

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=4000, log_level="warning")  # noqa: S104 — Traefik fronts it
