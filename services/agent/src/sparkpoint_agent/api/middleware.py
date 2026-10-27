"""The request middleware — s2s auth, header scoping, idempotency (agent-service-api §1).

Order per request (non-custody, fail-closed):
    1. Assign a ``requestId`` (correlation id on every response + envelope, §1.5).
    2. Exempt paths (probes/docs) pass straight through — no auth, no header scoping.
    3. ``Authorization: Bearer <web-tier-token>`` (§1.2)         → else UNAUTHENTICATED.
    4. Parse/validate ``X-Account`` / ``X-Owner`` / ``X-Chain-Id`` → else ACCOUNT_HEADERS_INVALID.
    5. ``Idempotency-Key`` (§1.3): validate UUID; replay a cached POST response, or
       capture + store the fresh 2xx JSON response so a retry can't double-emit.

``ApiError`` raised inside the middleware is rendered HERE (Starlette runs custom
middleware OUTSIDE the exception-handler layer), so it still yields the §1.5 envelope.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from .errors import ApiError, ErrorCode, new_request_id, render_api_error
from .idempotency import IdempotencyScope, ScopedStore, StoredResponse, is_valid_key
from .security import (
    authenticate,
    has_optional_account_context,
    is_exempt,
    parse_account_headers,
    requires_account_context,
)

_CallNext = Callable[[Request], Awaitable[Response]]

# Headers not copied verbatim onto a rebuilt/replayed response (recomputed instead).
_MANAGED_HEADERS = frozenset({"content-length", "content-type"})


def _response_from_bytes(
    status_code: int,
    content_type: str,
    body: bytes,
    extra_headers: dict[str, str] | None = None,
) -> Response:
    """Rebuild a buffered response (content-length recomputed from ``body``)."""
    response = Response(content=body, status_code=status_code)
    response.headers["content-type"] = content_type
    for key, value in (extra_headers or {}).items():
        response.headers[key] = value
    return response


class RequestContextMiddleware(BaseHTTPMiddleware):
    """s2s auth + user-scoping headers + idempotency, sharing one scoped store."""

    def __init__(self, app: object, store: ScopedStore) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self._store = store

    async def dispatch(self, request: Request, call_next: _CallNext) -> Response:
        request_id = new_request_id()
        request.state.request_id = request_id
        request.state.idempotency = self._store

        # Probes/docs bypass auth + scoping entirely (keep /healthz, /readyz open).
        if is_exempt(request.url.path):
            return await call_next(request)

        try:
            authenticate(request.headers.get("Authorization"))
            # 045: a handful of s2s routes have no user to scope to (the public alpha-application
            # form — nobody signed in). Auth above is unconditional; only the identity parse is
            # skipped, leaving `request.state.account` unset so `get_account` raises rather than
            # handing any route a fabricated owner.
            if requires_account_context(request.url.path):
                try:
                    request.state.account = parse_account_headers(
                        request.headers.get("X-Account"),
                        request.headers.get("X-Owner"),
                        request.headers.get("X-Chain-Id"),
                    )
                except ApiError:
                    # 061 — a handful of advisory reads can answer "unavailable" without an
                    # identity. Auth already passed; only the scoping parse is optional here.
                    if not has_optional_account_context(request.url.path):
                        raise
            key = self._validate_idempotency_key(request)
        except ApiError as exc:
            return render_api_error(exc, request_id)

        # Replay a previously stored response for this idempotency key (POST only, §1.3).
        # 023 (FR-023-013): the cache is scoped to (account, chain_id, method, path, key). The raw
        # key is client-supplied and carries no tenant component, so keying on it alone could serve
        # one wallet's cached IntentBundle to another — or one chain's bundle on another chain.
        scope = None
        if key is not None and request.method == "POST":
            account = getattr(request.state, "account", None)
            scope = IdempotencyScope.build(
                account=getattr(account, "account", None),
                chain_id=getattr(account, "chain_id", None),
                method=request.method,
                path=request.url.path,
                key=key,
            )
            cached = await self._store.get(scope)
            if cached is not None:
                return _response_from_bytes(cached.status_code, cached.media_type, cached.body)

        response = await call_next(request)

        # Capture + store the original 2xx JSON response so a retry replays it. Streamed
        # (SSE) and non-2xx responses are never cached.
        if scope is not None:
            content_type = response.headers.get("content-type", "")
            # ``call_next`` yields a streaming response exposing ``body_iterator``.
            body_iterator = getattr(response, "body_iterator", None)
            if (
                body_iterator is not None
                and 200 <= response.status_code < 300
                and content_type.startswith("application/json")
            ):
                body = b"".join([chunk async for chunk in body_iterator])
                await self._store.put(
                    scope, StoredResponse(response.status_code, content_type, body)
                )
                extra = {
                    k: v for k, v in response.headers.items() if k.lower() not in _MANAGED_HEADERS
                }
                return _response_from_bytes(response.status_code, content_type, body, extra)

        return response

    @staticmethod
    def _validate_idempotency_key(request: Request) -> str | None:
        """Return the validated ``Idempotency-Key`` (or ``None`` if absent); raise if malformed."""
        key = request.headers.get("Idempotency-Key")
        if key is None:
            return None
        if not is_valid_key(key):
            raise ApiError(ErrorCode.VALIDATION_ERROR, "Idempotency-Key must be a UUID (§1.3).")
        request.state.idempotency_key = key
        return key
