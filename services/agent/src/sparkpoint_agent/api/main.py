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

import asyncio
import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware

from ..chain import VaultUnavailable
from ..db import get_database
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

logger = logging.getLogger("sparkpoint_agent.api")

# Startup must NEVER block on the DB: asyncpg.create_pool can hang for its full connect
# timeout (~tens of seconds) if the DB is unreachable at boot, which stalls uvicorn startup
# past the orchestrator's readiness deadline and gets the container killed. Bounding the
# connect keeps the process coming up fast; a slow/unreachable DB just degrades to
# postgres=false (fail-open for serving — the data layer is never on the withdraw/exit path).
_DB_CONNECT_TIMEOUT_S = 10.0
_DB_DISCONNECT_TIMEOUT_S = 5.0


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Own the process-wide asyncpg pool lifecycle (connect on startup / close on shutdown).

    Without this, the DB-backed reads (mandate / recommendations / onboarding persistence)
    hit an unconnected pool and 500 — the pool is created lazily but never ``connect()``-ed.

    FAIL-OPEN for serving (never for custody): a connect that errors OR times out is logged
    (NEVER the DSN) and the app still starts, so /healthz + the fail-closed advisory paths keep
    serving and /readyz honestly reports ``postgres=false``. The startup connect is bounded
    (``_DB_CONNECT_TIMEOUT_S``) so a DB blip can't hang boot and get the container killed. The
    data layer is a derived accelerator only — never on the withdraw/exit path (N2), so a DB
    outage cannot trap funds.
    """
    db = None
    try:
        db = get_database()
        await asyncio.wait_for(db.connect(), timeout=_DB_CONNECT_TIMEOUT_S)
        logger.info("db_pool_connected")
    except Exception:
        # Covers connect errors AND the wait_for timeout — never interpolate the exception/DSN
        # (a connect error can carry the credential). Startup proceeds regardless.
        logger.warning("db_pool_connect_unavailable; DB-backed reads will degrade (fail-closed)")
    try:
        yield
    finally:
        if db is not None:
            try:
                await asyncio.wait_for(db.disconnect(), timeout=_DB_DISCONNECT_TIMEOUT_S)
            except Exception:
                logger.warning("db_pool_disconnect_error")


app = FastAPI(title="SparkPoint Hermes Agent", version="0.0.0", lifespan=lifespan)

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
async def readyz() -> dict[str, object]:
    """Readiness — which dependencies are configured/reachable.

    ``postgres`` is a REAL round-trip (``SELECT 1`` over the connected pool), so a
    configured-but-unreachable DB (or an unconnected pool) reports ``false`` honestly rather
    than the old env-presence-only check that masked the pool-not-connected bug. The other
    checks remain presence probes (deeper RPC/model reachability lands in later waves).
    """
    postgres_ok = False
    try:
        postgres_ok = bool(await get_database().healthcheck())
    except Exception:
        # Unconnected pool / unreachable DB / missing DSN → honestly not ready.
        postgres_ok = False
    checks = {
        "sim_fork": bool(os.getenv("SIM_FORK_RPC_URL")),
        "base_rpc": bool(os.getenv("BASE_SEPOLIA_RPC_URL") or os.getenv("ALCHEMY_ACCESS_KEY")),
        "anthropic": bool(
            os.getenv("NEW_ANTHROPIC_OAUTH_TOKEN")
            or os.getenv("ANTHROPIC_OAUTH_TOKEN")
            or os.getenv("ANTHROPIC_API_KEY")
        ),
        "postgres": postgres_ok,
    }
    return {
        "ready": all(checks.values()),
        "checks": checks,
        # Default to the mirrored constant so the reported version is always accurate.
        "policy_version": os.getenv("POLICY_VERSION", POLICY_VERSION),
    }
