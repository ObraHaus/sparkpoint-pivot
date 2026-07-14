"""The canonical error envelope + error codes (agent-service-api.md §1.5, §1.6).

Every non-2xx response shares the §1.5 shape and one of the §1.6 canonical codes.
Non-custody framing: a fail-closed rejection is surfaced here as a typed explanation
with structured ``reasons[]`` — NEVER as a signature request (the envelope carries no
signable artifact). ``policyVersion`` is stamped on every envelope for the Trust
Center / audit trail (N5). The renderer used for both the FastAPI exception handler
and the middleware is shared so the two paths emit byte-identical envelopes.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from ..policy import POLICY_VERSION


class ErrorCode(StrEnum):
    """agent-service-api.md §1.6 — the canonical error codes (superset of ReasonCode)."""

    UNAUTHENTICATED = "UNAUTHENTICATED"
    ACCOUNT_HEADERS_INVALID = "ACCOUNT_HEADERS_INVALID"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    NOT_FOUND = "NOT_FOUND"
    BETA_NOT_ENABLED = "BETA_NOT_ENABLED"
    GEO_BLOCKED = "GEO_BLOCKED"
    POLICY_REJECTED = "POLICY_REJECTED"
    CAP_EXCEEDED = "CAP_EXCEEDED"
    SLIPPAGE_EXCEEDED = "SLIPPAGE_EXCEEDED"
    SIMULATION_REVERT = "SIMULATION_REVERT"
    SIMULATION_UNAVAILABLE = "SIMULATION_UNAVAILABLE"
    DATA_STALE = "DATA_STALE"
    KILL_SWITCH_PAUSED = "KILL_SWITCH_PAUSED"
    UPSTREAM_UNAVAILABLE = "UPSTREAM_UNAVAILABLE"
    REFUSAL = "REFUSAL"
    RATE_LIMITED = "RATE_LIMITED"
    INTERNAL = "INTERNAL"


@dataclass(frozen=True)
class _CodeSpec:
    """The (HTTP status, default retryability) pinned to a code by §1.6."""

    http_status: int
    retryable: bool


# agent-service-api.md §1.6 — the canonical (code → HTTP, retryable) table. Where the
# spec says "maybe"/"no (re-quote)", the conservative bool is used and noted; callers
# may override per response via ``ApiError(retryable=...)``.
ERROR_SPEC: dict[ErrorCode, _CodeSpec] = {
    ErrorCode.UNAUTHENTICATED: _CodeSpec(401, False),
    ErrorCode.ACCOUNT_HEADERS_INVALID: _CodeSpec(400, False),
    ErrorCode.VALIDATION_ERROR: _CodeSpec(400, False),
    ErrorCode.NOT_FOUND: _CodeSpec(404, False),
    ErrorCode.BETA_NOT_ENABLED: _CodeSpec(403, False),
    ErrorCode.GEO_BLOCKED: _CodeSpec(451, False),
    ErrorCode.POLICY_REJECTED: _CodeSpec(422, False),
    ErrorCode.CAP_EXCEEDED: _CodeSpec(422, False),
    ErrorCode.SLIPPAGE_EXCEEDED: _CodeSpec(422, False),  # §1.6: "no (re-quote)"
    ErrorCode.SIMULATION_REVERT: _CodeSpec(422, False),  # §1.6: "maybe" — conservative default
    ErrorCode.SIMULATION_UNAVAILABLE: _CodeSpec(503, True),
    ErrorCode.DATA_STALE: _CodeSpec(409, True),
    ErrorCode.KILL_SWITCH_PAUSED: _CodeSpec(409, False),
    ErrorCode.UPSTREAM_UNAVAILABLE: _CodeSpec(503, True),  # §1.6: 502/503 — default 503
    ErrorCode.REFUSAL: _CodeSpec(422, False),
    ErrorCode.RATE_LIMITED: _CodeSpec(429, True),
    ErrorCode.INTERNAL: _CodeSpec(500, True),
}


@dataclass(frozen=True)
class ErrorReason:
    """One structured reason in ``error.reasons[]`` (§1.5). ``code`` is a ReasonCode
    string (policy) or a sub-code; ``message`` is surfaced in chat/UI."""

    code: str
    message: str


class ApiError(Exception):
    """A typed, envelope-ready error. Raise anywhere; handlers render the §1.5 shape.

    Never carries a signable artifact — only the human message + structured reasons.
    """

    def __init__(
        self,
        code: ErrorCode,
        message: str,
        *,
        reasons: Iterable[ErrorReason] | None = None,
        http_status: int | None = None,
        retryable: bool | None = None,
        simulation: Any | None = None,
        headers: Mapping[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        spec = ERROR_SPEC[code]
        self.code = code
        self.message = message
        self.reasons: tuple[ErrorReason, ...] = tuple(reasons or ())
        self.http_status = http_status if http_status is not None else spec.http_status
        self.retryable = retryable if retryable is not None else spec.retryable
        self.simulation = simulation
        self.headers = dict(headers) if headers else None


def new_request_id() -> str:
    """A correlation id for the envelope's ``requestId`` (§1.5). Format is illustrative
    in the spec (``req_01H...``); a ``req_`` + uuid4 hex is unique and log-greppable."""
    return f"req_{uuid.uuid4().hex}"


def error_envelope(
    code: ErrorCode,
    message: str,
    *,
    request_id: str,
    reasons: Iterable[ErrorReason] | None = None,
    retryable: bool | None = None,
    http_status: int | None = None,
    simulation: Any | None = None,
) -> dict[str, Any]:
    """Build the §1.5 error envelope dict (the sole shape for every non-2xx response)."""
    spec = ERROR_SPEC[code]
    return {
        "error": {
            "code": code.value,
            "httpStatus": http_status if http_status is not None else spec.http_status,
            "message": message,
            "reasons": [{"code": r.code, "message": r.message} for r in (reasons or ())],
            "policyVersion": POLICY_VERSION,
            "retryable": spec.retryable if retryable is None else retryable,
            "requestId": request_id,
            "simulation": simulation,
        }
    }


def render_api_error(exc: ApiError, request_id: str) -> JSONResponse:
    """Render an ``ApiError`` into a §1.5 ``JSONResponse`` (shared by handler + middleware)."""
    body = error_envelope(
        exc.code,
        exc.message,
        request_id=request_id,
        reasons=exc.reasons,
        retryable=exc.retryable,
        http_status=exc.http_status,
        simulation=exc.simulation,
    )
    return JSONResponse(status_code=exc.http_status, content=body, headers=exc.headers)


def _request_id(request: Request) -> str:
    """The request's correlation id (set by the middleware), or a fresh one."""
    rid = getattr(request.state, "request_id", None)
    return rid if isinstance(rid, str) else new_request_id()


async def api_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Exception handler for ``ApiError`` raised inside route handlers."""
    assert isinstance(exc, ApiError)  # noqa: S101 — registered only for ApiError
    return render_api_error(exc, _request_id(request))


async def validation_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Map FastAPI/Pydantic request-validation failures to VALIDATION_ERROR (§1.6)."""
    reasons: list[ErrorReason] = []
    errs = getattr(exc, "errors", None)
    if callable(errs):
        for e in errs():
            loc = ".".join(str(p) for p in e.get("loc", ()))
            reasons.append(ErrorReason("VALIDATION_ERROR", f"{loc}: {e.get('msg', '')}"))
    body = error_envelope(
        ErrorCode.VALIDATION_ERROR,
        "Request body fails schema validation.",
        request_id=_request_id(request),
        reasons=reasons,
    )
    status = ERROR_SPEC[ErrorCode.VALIDATION_ERROR].http_status
    return JSONResponse(status_code=status, content=body)


async def internal_error_handler(request: Request, exc: Exception) -> JSONResponse:
    """Catch-all → INTERNAL (500). Never leaks internals into the client message."""
    body = error_envelope(
        ErrorCode.INTERNAL,
        "Unexpected error.",
        request_id=_request_id(request),
    )
    return JSONResponse(status_code=ERROR_SPEC[ErrorCode.INTERNAL].http_status, content=body)
