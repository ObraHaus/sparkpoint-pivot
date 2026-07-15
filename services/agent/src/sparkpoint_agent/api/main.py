"""FastAPI app entry for the SparkPoint Hermes agent.

W3 wires the real request middleware (service-to-service bearer auth, X-Account/
X-Owner/X-Chain-Id scoping, Idempotency-Key) and the canonical §1.5 error envelope
with the agent-service-api.md §1.6 error codes, on top of the health surface (R17).
The per-endpoint routers (chat, build-tx, portfolio, …) are added in later waves and
run through the deterministic Coordinator DAG + the LLM-free policy gate.

Non-custody: this app holds NO user key and exposes NO endpoint that returns a
signature (IntentBundle.signature is always null). The middleware's headers scope
reads/derivations only — never authority to move funds (agent-service-api.md §0/§1.2).
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from ..chain import VaultUnavailable
from ..policy import POLICY_VERSION
from .chat import router as chat_router
from .errors import (
    ApiError,
    api_error_handler,
    internal_error_handler,
    validation_error_handler,
)
from .idempotency import IdempotencyStore
from .mandate import router as mandate_router
from .middleware import RequestContextMiddleware
from .portfolio import router as portfolio_router
from .recommendations import router as recommendations_router
from .vault import router as vault_router
from .vault import vault_unavailable_handler

app = FastAPI(title="SparkPoint Hermes Agent", version="0.0.0")

# One process-local idempotency store shared by every request (§1.3). Production
# swaps this for a Postgres/Redis-backed store so replays span workers/restarts.
idempotency_store = IdempotencyStore()
app.add_middleware(RequestContextMiddleware, store=idempotency_store)

# CORS — the browser (web tier) calls this service cross-origin (§1.2 headers + the
# /chat SSE fetch). Allowed origins are an explicit allowlist (never `*`), overridable
# via CORS_ALLOW_ORIGINS (csv). No credentials are used (the web tier passes bearer/scoping
# headers explicitly, not cookies), so this never widens auth. Added AFTER the context
# middleware so it is the OUTERMOST layer and also decorates error responses.
_CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "http://i4cw0ogsookkkocsw808gwc3.aldrickb.app,http://localhost:3000,https://sparkpoint.io",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
    allow_headers=["*"],
)

# Every non-2xx response is the canonical §1.5 envelope (§1.6 codes).
app.add_exception_handler(ApiError, api_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)
# A fail-closed chain outage (vault undeployed / RPC unreachable) → clean §1.5 envelope
# (SIMULATION_UNAVAILABLE / UPSTREAM_UNAVAILABLE), never a fabricated quote (§3.7).
app.add_exception_handler(VaultUnavailable, vault_unavailable_handler)
app.add_exception_handler(Exception, internal_error_handler)

# §3.7 vault deposit/withdraw quote endpoints (READ/PREVIEW only; withdraw never gated, N2).
app.include_router(vault_router)
# §3.2 chat surface — SSE stream of policy-stamped ChatBlocks; NEVER returns a signable bundle.
app.include_router(chat_router)
# §3.1 onboarding + mandate — chat onboarding (SSE, terminal mandate_draft) + versioned
# mandate CRUD. Advisory only; NEVER returns a signable bundle (FR-002/004).
app.include_router(mandate_router)
# §3.3 portfolio — enriched/derived, stale-markable reads (custody balances reconciled by
# the frontend via direct RPC, SC-011); degrades to 200+stale, never traps a deposit/exit.
app.include_router(portfolio_router)
# §3.4 recommendations — ranked vs. the mandate; ONLY whitelisted + policy-cleared strategies
# surface (FR-016). Advisory; each rec's proposedAction is signable only later via /build-tx.
app.include_router(recommendations_router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness — the process is up. Deep dependency checks live in /readyz."""
    return {"status": "ok", "service": "sparkpoint-agent", "version": "0.0.0"}


@app.get("/readyz")
def readyz() -> dict[str, object]:
    """Readiness — which dependencies are configured/reachable.

    Later waves replace these presence checks with real reachability probes
    (Postgres / Base RPC / the Anvil sim-fork / Anthropic).
    """
    checks = {
        "sim_fork": bool(os.getenv("SIM_FORK_RPC_URL")),
        "base_rpc": bool(os.getenv("BASE_SEPOLIA_RPC_URL") or os.getenv("ALCHEMY_ACCESS_KEY")),
        "anthropic": bool(os.getenv("ANTHROPIC_OAUTH_TOKEN") or os.getenv("ANTHROPIC_API_KEY")),
        "postgres": bool(os.getenv("DATABASE_URL")),
    }
    return {
        "ready": all(checks.values()),
        "checks": checks,
        # Default to the mirrored constant so the reported version is always accurate.
        "policy_version": os.getenv("POLICY_VERSION", POLICY_VERSION),
    }
