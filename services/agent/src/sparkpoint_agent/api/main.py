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
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
from fastapi import FastAPI, Header
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from starlette.exceptions import HTTPException as StarletteHTTPException

from ..chain import VaultUnavailable
from ..db import get_database
from ..db.allowlist import AllowlistStore, parse_allowlist_env
from ..db.limits import LimitsStore
from ..db.persona_notes import PersonaNoteStore
from ..persona import warm_persona
from ..policy import POLICY_VERSION
from .admin_knowledge import router as admin_knowledge_router
from .admin_limits import router as admin_limits_router
from .admin_llm import router as admin_llm_router
from .admin_persona import router as admin_persona_router
from .admin_revenue import router as admin_revenue_router
from .admin_uptime import router as admin_uptime_router
from .admin_usage import router as admin_usage_router
from .admin_vaults import router as admin_vaults_router
from .allowlist import router as allowlist_router
from .chat import router as chat_router
from .content import router as content_router
from .conversations import router as conversations_router
from .errors import (
    ApiError,
    api_error_handler,
    http_exception_handler,
    internal_error_handler,
    validation_error_handler,
)
from .idempotency import IdempotencyStore
from .mandate import router as mandate_router
from .middleware import RequestContextMiddleware
from .portfolio import router as portfolio_router
from .recommendations import router as recommendations_router
from .security import has_valid_s2s
from .subscription import router as subscription_router
from .tips import router as tips_router
from .usage import router as usage_router
from .vault import router as vault_router
from .vault import vault_unavailable_handler

logger = logging.getLogger("sparkpoint_agent.api")

# readyz LLM check — a REAL gateway liveness probe (not key-presence), cached so /readyz stays
# cheap. When the LiteLLM gateway is configured this GETs its /health/liveliness (a genuine
# reachability check of the exact path the assistant uses); otherwise it falls back to
# Anthropic-credential presence. Closes the "green while chat is down" gap: a down/unreachable
# gateway now flips the check to false.
_LLM_PROBE_TTL_S = 60.0
_LLM_PROBE_TIMEOUT_S = 2.5
_llm_probe: dict[str, float | bool] = {"ts": -1e9, "ok": False}


async def _llm_ready() -> bool:
    base = os.getenv("LITELLM_BASE_URL")
    if not base:
        # Anthropic fallback path: credential presence is the best signal available.
        return bool(
            os.getenv("NEW_ANTHROPIC_OAUTH_TOKEN")
            or os.getenv("ANTHROPIC_OAUTH_TOKEN")
            or os.getenv("ANTHROPIC_API_KEY")
        )
    now = time.monotonic()
    if now - float(_llm_probe["ts"]) < _LLM_PROBE_TTL_S:
        return bool(_llm_probe["ok"])
    root = base.rstrip("/")
    if root.endswith("/v1"):
        root = root[:-3].rstrip("/")
    ok = False
    try:
        async with httpx.AsyncClient(timeout=_LLM_PROBE_TIMEOUT_S) as c:
            resp = await c.get(f"{root}/health/liveliness")
            ok = resp.status_code == 200
    except Exception:
        ok = False
    _llm_probe.update(ts=now, ok=ok)
    return ok

# Startup must NEVER block on the DB: asyncpg.create_pool can hang for its full connect
# timeout (~tens of seconds) if the DB is unreachable at boot, which stalls uvicorn startup
# past the orchestrator's readiness deadline and gets the container killed. Bounding the
# connect keeps the process coming up fast; a slow/unreachable DB just degrades to
# postgres=false (fail-open for serving — the data layer is never on the withdraw/exit path).
_DB_CONNECT_TIMEOUT_S = 10.0
_DB_DISCONNECT_TIMEOUT_S = 5.0


async def _seed_allowlists(db: object) -> None:
    """Idempotently seed the beta/admin allowlists from ``BETA_ALLOWLIST`` / ``ADMIN_ALLOWLIST``
    (comma-separated) on boot (Phase B, item #9).

    Best-effort: a seed failure (e.g. the 0005 migration not yet applied) is logged and swallowed
    so it never blocks startup — the tables are the access gate, never the withdraw/exit path.
    """
    try:
        beta = parse_allowlist_env(os.getenv("BETA_ALLOWLIST"))
        admin = parse_allowlist_env(os.getenv("ADMIN_ALLOWLIST"))
        if not beta and not admin:
            return
        added = await AllowlistStore(db).seed(beta=beta, admin=admin)  # type: ignore[arg-type]
        logger.info("allowlist_seeded added=%d", added)
    except Exception:
        # Never interpolate env values; a seed failure must not crash boot.
        logger.warning("allowlist_seed_skipped (table missing or DB error)")


async def _seed_tier_limits(db: object) -> None:
    """Idempotently seed premium wallets from ``PREMIUM_ALLOWLIST`` (comma-separated) on boot
    (feature 008). The two tiers themselves ship seeded by migration 0015; this only assigns the
    launch premium wallets.

    Best-effort like the allowlist seed: a failure (0015 not yet applied, DB error) is logged and
    swallowed so it never blocks startup. Tier limits are an advisory-compute gate, never the
    withdraw/exit path (N2); if the table is missing, enforcement simply has no premium grants.
    """
    try:
        premium = parse_allowlist_env(os.getenv("PREMIUM_ALLOWLIST"))
        if not premium:
            return
        added = await LimitsStore(db).seed_premium(premium)  # type: ignore[arg-type]
        logger.info("tier_limits_seeded premium_added=%d", added)
    except Exception:
        # Never interpolate env values; a seed failure must not crash boot.
        logger.warning("tier_limits_seed_skipped (table missing or DB error)")


async def _warm_persona(db: object) -> None:
    """Warm Sparky's persona system block at boot: seed files + any admin overrides (fail-open).

    Best-effort like the allowlist seed — a failure (0013 migration not yet applied, DB error, a
    bad seed file) is logged and swallowed so it never blocks startup. Persona is VOICE only (never
    custody, N2); chat still serves with a seed-only/empty persona if the override read can't run.
    """
    try:
        overrides = await PersonaNoteStore(db).overrides()  # type: ignore[arg-type]
    except Exception:
        overrides = {}
        logger.warning("persona_overrides_skipped (table missing or DB error)")
    warm_persona(overrides)
    logger.info("persona_warmed overrides=%d", len(overrides))


async def _seed_changelog(db: object) -> None:
    """Ingest ``content_seed/whats-new.json`` into ``content_entries`` at boot (feature 006). One
    repo file feeds the in-app changelog. Best-effort like the persona/allowlist seeds: a missing
    file, bad JSON, an un-applied 0014 migration, or a DB error is logged and swallowed so it never
    blocks startup. Content only, never custody (N2)."""
    try:
        from ..content_seed import seed_changelog
        from ..db.content_entries import ContentEntryStore

        await seed_changelog(ContentEntryStore(db))  # type: ignore[arg-type]
    except Exception:
        logger.warning("whats_new_seed_skipped (table missing or DB error)")


_INDEX_INTERVAL_S = 300.0  # re-index vault flows every ~5 min (bounded catch-up each tick)


async def _index_vault_flows_loop() -> None:
    """§B2 background indexer: catch up the vault's Deposit/Withdraw into ``onchain_events`` so
    ``GET /portfolio`` can derive a real cost basis + PnL. Off the request path, fail-open, and
    never on the withdraw/exit path (N2). No-op when the vault/RPC isn't configured.
    """
    from ..config import AgentConfig
    from ..data.log_source import HttpxLogsRpc, VaultFlowIndexer
    from ..db.vault_flows import PgVaultFlowStore

    try:
        config = AgentConfig.from_env()
    except Exception:
        return
    # eth_getLogs range caps differ by provider/tier (Alchemy Free = 10 blocks) — allow a dedicated
    # getLogs-friendly RPC (e.g. https://sepolia.base.org, 2000-block cap) separate from the
    # eth_call RPC. Falls back to the main RPC (the adaptive window still copes with a tight cap).
    log_rpc = os.getenv("VAULT_INDEX_RPC_URL") or config.rpc_url
    if not (config.vault_address and log_rpc):
        return
    start_block = 0
    try:
        start_block = int(os.getenv("VAULT_INDEX_FROM_BLOCK", "0") or "0")
    except ValueError:
        start_block = 0
    kwargs: dict[str, int] = {}
    try:
        raw_window = os.getenv("VAULT_INDEX_WINDOW")
        if raw_window:
            kwargs["window"] = int(raw_window)
    except ValueError:
        pass
    indexer = VaultFlowIndexer(
        transport=HttpxLogsRpc(log_rpc),
        store=PgVaultFlowStore(get_database(), config.vault_address),
        vault_address=config.vault_address,
        network_id="base",  # both Base chains map to the 'base' networks mirror id
        start_block=start_block,
        **kwargs,
    )
    while True:
        try:
            written = await indexer.run_once()
            if written:
                logger.info("vault_flows_indexed added=%d", written)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("vault_flow_index_error (degrading; PnL stays stale)")
        try:
            await asyncio.sleep(_INDEX_INTERVAL_S)
        except asyncio.CancelledError:
            raise


# Feature 013 per-network DISPLAY constants — read outside AgentConfig (like PREMIUM_ALLOWLIST),
# overridable by env. The fee-recipient SET unions the pre-014 deployer EOA + the post-014
# fee-treasury Safe so the cumulative honestly counts fees to BOTH from inception (D14).
_DEFAULT_SWAP_ROUTER_84532 = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"
_DEFAULT_FEE_RECIPIENTS_84532 = (
    "0xA71e24359A6cb7A939aae2d62dD12b6256365c30,0xCB135893C84876aab9E10792b56e5bEa91dc578f"
)


async def _index_swap_fees_loop() -> None:
    """Feature 013 background indexer: record the swap router's fee ``Transfer``s (from == router,
    to ∈ the fee-recipient set) into ``swap_fee_events`` so ``/admin/revenue`` shows the REAL
    0.20% routing-fee take. Off the request path, fail-open, never withdraw (N2).
    No-op when the RPC isn't configured.
    """
    from ..config import AgentConfig
    from ..data.log_source import HttpxLogsRpc
    from ..data.swap_fee_indexer import SwapFeeIndexer
    from ..db.swap_fees import PgSwapFeeEventStore

    try:
        config = AgentConfig.from_env()
    except Exception:
        return
    log_rpc = os.getenv("VAULT_INDEX_RPC_URL") or config.rpc_url
    if not log_rpc:
        return
    router = (os.getenv("SWAP_ROUTER_84532") or _DEFAULT_SWAP_ROUTER_84532).lower()
    recipients_raw = os.getenv("SWAP_FEE_RECIPIENTS_84532") or _DEFAULT_FEE_RECIPIENTS_84532
    recipients = frozenset(a.strip().lower() for a in recipients_raw.split(",") if a.strip())
    if not router or not recipients:
        return
    try:
        start_block = int(
            os.getenv("SWAP_FEE_FROM_BLOCK") or os.getenv("VAULT_INDEX_FROM_BLOCK", "0") or "0"
        )
    except ValueError:
        start_block = 0
    kwargs: dict[str, int] = {}
    try:
        raw_window = os.getenv("VAULT_INDEX_WINDOW")
        if raw_window:
            kwargs["window"] = int(raw_window)
    except ValueError:
        pass
    indexer = SwapFeeIndexer(
        transport=HttpxLogsRpc(log_rpc),
        store=PgSwapFeeEventStore(get_database()),
        router=router,
        recipients=recipients,
        network_id="base",
        start_block=start_block,
        **kwargs,
    )
    while True:
        try:
            result = await indexer.index_once()
            if result.inserted:
                logger.info("swap_fees_indexed added=%d", result.inserted)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("swap_fee_index_error (degrading; revenue stays incomplete)")
        try:
            await asyncio.sleep(_INDEX_INTERVAL_S)
        except asyncio.CancelledError:
            raise


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
    index_task: asyncio.Task[None] | None = None
    swap_fee_task: asyncio.Task[None] | None = None
    try:
        db = get_database()
        await asyncio.wait_for(db.connect(), timeout=_DB_CONNECT_TIMEOUT_S)
        logger.info("db_pool_connected")
        await _seed_allowlists(db)
        # Feature 008: seed any PREMIUM_ALLOWLIST wallets to the premium tier (best-effort).
        await _seed_tier_limits(db)
        # Sparky persona: compose the literacy SYSTEM persona from persona_seed/ + any admin
        # overrides, once, at boot. Trusted voice-only content; never on the withdraw/exit path.
        await _warm_persona(db)
        # Feature 006: ingest content_seed/whats-new.json into content_entries so one repo file
        # feeds the in-app changelog. Best-effort; content only (N2).
        await _seed_changelog(db)
        # §B2: background vault-flows indexer (Deposit/Withdraw → onchain_events → PnL).
        # Best-effort, off the request path; never on the withdraw/exit path (N2). No-op if unset.
        index_task = asyncio.create_task(_index_vault_flows_loop())
        # Feature 013: background swap-fee indexer (router fee Transfers → swap_fee_events → the
        # real /admin/revenue swap stream). Best-effort, off the request path; never withdraw (N2).
        swap_fee_task = asyncio.create_task(_index_swap_fees_loop())
    except Exception:
        # Covers connect errors AND the wait_for timeout — never interpolate the exception/DSN
        # (a connect error can carry the credential). Startup proceeds regardless.
        logger.warning("db_pool_connect_unavailable; DB-backed reads will degrade (fail-closed)")
    try:
        yield
    finally:
        if index_task is not None:
            index_task.cancel()
        if swap_fee_task is not None:
            swap_fee_task.cancel()
        if db is not None:
            try:
                await asyncio.wait_for(db.disconnect(), timeout=_DB_DISCONNECT_TIMEOUT_S)
            except Exception:
                logger.warning("db_pool_disconnect_error")


# The agent is deployed behind a PUBLIC FQDN (Coolify/Traefik routes by domain), so the
# interactive API docs + the OpenAPI schema are DISABLED by default — they would hand an
# anonymous caller the full route/param map of a service whose functional routes are all
# behind the fail-closed S2S bearer. Set AGENT_ENABLE_DOCS=true only for a trusted/private
# deployment. (The browser never calls this service directly; it goes through the web BFF.)
_DOCS_ENABLED = os.getenv("AGENT_ENABLE_DOCS", "").lower() in {"1", "true", "yes"}

app = FastAPI(
    title="SparkPoint Hermes Agent",
    version="0.0.0",
    lifespan=lifespan,
    docs_url="/docs" if _DOCS_ENABLED else None,
    redoc_url="/redoc" if _DOCS_ENABLED else None,
    openapi_url="/openapi.json" if _DOCS_ENABLED else None,
)

# One process-local idempotency store shared by every request (§1.3). Production
# swaps this for a Postgres/Redis-backed store so replays span workers/restarts.
idempotency_store = IdempotencyStore()
app.add_middleware(RequestContextMiddleware, store=idempotency_store)

# CORS — the browser (web tier) calls this service cross-origin (§1.2 headers + the
# /chat SSE fetch). Allowed origins are an explicit allowlist (never `*`), overridable
# via CORS_ALLOW_ORIGINS (csv). No credentials are used (the web tier passes bearer/scoping
# headers explicitly, not cookies), so this never widens auth. Added AFTER the context
# middleware so it is the OUTERMOST layer and also decorates error responses.
# NOTE: with the same-origin BFF the browser never calls this service cross-origin, so CORS is
# defense-in-depth only. The committed default lists the REAL web origins (http+https of the
# current develop slug) + localhost + the marketing domain; deployments override via
# CORS_ALLOW_ORIGINS. (Prior default pointed at a stale/typo'd slug — corrected.)
_CORS_ORIGINS = [
    o.strip()
    for o in os.getenv(
        "CORS_ALLOW_ORIGINS",
        "https://71zxh8ed1ejf8132l46joodp17.aldrickb.app,"
        "http://71zxh8ed1ejf8132l46joodp17.aldrickb.app,"
        "http://localhost:3000,https://sparkpoint.io",
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
# Unmatched-route 404s share the gated-route NOT_FOUND envelope (invisible-admin posture).
app.add_exception_handler(StarletteHTTPException, http_exception_handler)
# A fail-closed chain outage (vault undeployed / RPC unreachable) → clean §1.5 envelope
# (SIMULATION_UNAVAILABLE / UPSTREAM_UNAVAILABLE), never a fabricated quote (§3.7).
app.add_exception_handler(VaultUnavailable, vault_unavailable_handler)
app.add_exception_handler(Exception, internal_error_handler)

# §3.7 vault deposit/withdraw quote endpoints (READ/PREVIEW only; withdraw never gated, N2).
app.include_router(vault_router)
app.include_router(subscription_router)
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
# §B beta/admin allowlist — the SIWE login status check (/allowlist/status) + admin-gated
# management (/admin/allowlist*). ACCESS gate only; never gates /exit, /trust, or withdraw (N2).
app.include_router(allowlist_router)
# §B admin LLM-gateway view (/admin/llm/status) — admin-gated, read-only gateway telemetry.
app.include_router(admin_llm_router)
# §R2 admin Obsidian console (/admin/knowledge/*) — admin-gated corpus view/edit/reingest.
app.include_router(admin_knowledge_router)
# Sparky persona console (/admin/persona*) — admin-gated view/edit/revert of Sparky's character.
# Trusted SYSTEM content, isolated from the RAG corpus; never on the policy/action path (N2).
app.include_router(admin_persona_router)
# §B1 per-wallet chat conversation history (/conversations*) — session-scoped, no admin override.
app.include_router(conversations_router)
# §B4 admin uptime view (/admin/uptime) — admin-gated Kuma status-page telemetry (LAN-only source).
app.include_router(admin_uptime_router)
# Feature 008 admin tier-limits config (/admin/limits/*) — admin-gated, audited, POST-only writes.
# Advisory-compute config only; never a signable artifact, never the withdraw path (N2).
app.include_router(admin_limits_router)
# Feature 008 admin usage/limits monitoring (/admin/usage/*) — admin-gated, masked, honest-degrade.
app.include_router(admin_usage_router)
app.include_router(admin_revenue_router)
# Feature 008 self-scoped usage read (/usage/self) — a wallet reads its OWN allowance (not admin).
app.include_router(usage_router)
# Feature 011 admin MANAGE half (/admin/vaults*) — admin-gated READ + PREPARE-CALLDATA for the
# branded Morpho wrapper factory. Every mutating route returns calldata the operator signs off-app;
# NO server key, NO fund path, and NO move-funds guardian verb exists (N1/N2/US4).
app.include_router(admin_vaults_router)
# Alpha content — public changelog/announcement reads (any beta wallet) + admin authoring
# (/admin/content*). ACCESS/content only; never a signable artifact (N2).
app.include_router(content_router)
# Alpha sidebar tip widget — keyless GET /tips over the Obsidian 'tip' databank (no LLM/embed).
app.include_router(tips_router)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    """Liveness — the process is up. Deep dependency checks live in /readyz."""
    return {"status": "ok", "service": "sparkpoint-agent", "version": "0.0.0"}


@app.get("/readyz")
async def readyz(
    authorization: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Readiness. PUBLIC callers get only a bare ``{"ready": bool}``; the per-dependency
    breakdown + policy version are returned ONLY to the web tier (valid S2S bearer).

    This endpoint is unauthenticated on purpose (infra/uptime probes need it), so it must not
    leak the internal dependency topology (which of Postgres/RPC/model/sim is down, the policy
    version) to anonymous callers on the public FQDN. ``postgres`` is a REAL ``SELECT 1``
    round-trip, so a configured-but-unreachable DB reports ``false`` honestly.
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
        # Real LLM-gateway liveness (cached ~60s), not mere key-presence.
        "llm": await _llm_ready(),
        "postgres": postgres_ok,
    }
    ready = all(checks.values())
    if not has_valid_s2s(authorization):
        # Anonymous: boolean only — no dependency detail, no policy version.
        return {"ready": ready}
    return {
        "ready": ready,
        "checks": checks,
        # Default to the mirrored constant so the reported version is always accurate.
        "policy_version": os.getenv("POLICY_VERSION", POLICY_VERSION),
    }
