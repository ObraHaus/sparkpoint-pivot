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
from typing import Annotated, Any

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
from .admin_analytics import router as admin_analytics_router
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
from .execution import router as execution_router
from .idempotency import IdempotencyStore, LayeredIdempotencyStore, ScopedStore
from .mandate import router as mandate_router
from .middleware import RequestContextMiddleware
from .network_diagnostics import router as network_diagnostics_router
from .notifications import router as notifications_router
from .portfolio import router as portfolio_router
from .recommendations import router as recommendations_router
from .security import has_valid_s2s
from .sessions import router as sessions_router
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


def _warn_if_multi_worker() -> None:
    """023 (FR-023-019) — the one remaining single-process assumption, made loud.

    After the durable idempotency store (Story D), the only mechanism whose CORRECTNESS depends on
    running exactly one worker is the process-global LLM concurrency limiter
    (``llm/resilience.py``): with N workers there are N semaphores, so the effective in-flight cap
    is N x the intended one.

    Deliberately a WARNING, not a refusal to boot. That limiter guards **cost and upstream rate
    limits**, not custody and not the correctness of any signable artifact — and the LiteLLM virtual
    key caps rpm/tpm/daily budget server-side too. Taking a service down over a cost control would
    be disproportionate; leaving the assumption undocumented and invisible would not.
    """
    for name in ("WEB_CONCURRENCY", "UVICORN_WORKERS"):
        raw = os.getenv(name)
        if not raw:
            continue
        try:
            workers = int(raw)
        except ValueError:
            continue
        if workers > 1:
            logger.warning(
                "multi_worker_detected %s=%d — the process-global LLM concurrency limiter is "
                "PER-PROCESS, so the effective in-flight cap is %dx the intended one (cost/rate "
                "limits only; no custody impact). Run ONE worker, or externalize the limiter. "
                "See DEPLOYMENT.md.",
                name,
                workers,
                workers,
            )


def _durable_idempotency_store() -> ScopedStore | None:
    """The Postgres-backed replay cache (migration 0027), or ``None`` if it cannot be constructed.

    Resolved lazily and defensively so module import never depends on a DB. ``None`` degrades to the
    in-process cache alone — replay protection that does not survive a restart, which is exactly the
    pre-023 behavior and is safe (fail-open, N2). The store itself logs a distinct warning when the
    table is absent, so a deploy that landed before 0027 was applied is observable (FR-023-015a).
    """
    try:
        from ..db.idempotency import PgIdempotencyStore

        return PgIdempotencyStore(get_database())
    except Exception:
        logger.warning("idempotency_durable_store_unavailable; replays will not span restarts")
        return None


async def _chain_readiness() -> tuple[int | None, bool, bool, bool]:
    """023 — ``(chain_id, rpc_resolved, chain_identity_verified, chain_allowlists_a_swap)``.

    Derived from the RESOLVED config rather than from raw env-var presence, so readiness describes
    the chain this deployment actually serves. Fail-safe: an unloadable config reports
    ``(None, False, False, False)`` — honestly not ready — rather than raising out of a probe
    endpoint that infra depends on.
    """
    from ..chain.chain_identity import ChainIdentity
    from ..config import AgentConfig
    from ..policy import ActionType, get_policy_constants
    from .vault import _probe_for

    try:
        config = AgentConfig.from_env()
    except Exception:
        return None, False, False, False

    rpc_ok = bool(config.rpc_url)
    identity_ok = False
    if rpc_ok:
        probe = _probe_for(config)
        if probe is not None:
            try:
                identity_ok = (await probe.verdict()) is ChainIdentity.VERIFIED
            except Exception:
                identity_ok = False

    # Does this chain's RESOLVED allowlist actually offer a swap? Only then is the fork simulator a
    # readiness dependency (swaps are the oracle-dependent path that cannot fall back to a dry-run).
    swap_capable = False
    try:
        constants = get_policy_constants(config.chain_id)
        swap_capable = any(e.action is ActionType.AERODROME_SWAP for e in constants.allowlist)
    except Exception:
        swap_capable = False

    return config.chain_id, rpc_ok, identity_ok, swap_capable


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


_NOTIF_POLL_INTERVAL_S = 900.0  # edge-trigger caps/rate/new-recs every ~15 min (bounded LLM cost)


async def _notification_poller_loop() -> None:
    """Feature 021 phase-2 background poller: emit edge-triggered notifications (vault near
    capacity, Aave rate moved, a proactive new recommendation per wallet). Off the request path,
    fail-open, never on the withdraw/exit path (N2). Gated by ``NOTIF_POLLER_ENABLED``."""
    if os.getenv("NOTIF_POLLER_ENABLED", "true").strip().lower() not in {"1", "true", "yes"}:
        return
    from .notification_poller import poll_once

    while True:
        try:
            await poll_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("notification_poll_error (degrading; alerts stay quiet this tick)")
        try:
            await asyncio.sleep(_NOTIF_POLL_INTERVAL_S)
        except asyncio.CancelledError:
            raise


# Feature 013/014 per-network DISPLAY constants — read outside AgentConfig (like PREMIUM_ALLOWLIST),
# overridable by env. Each fee-recipient SET unions the pre-014 deployer EOA + the post-014
# fee-treasury Safe (deployed at the SAME address on both chains) so the cumulative honestly counts
# fees to BOTH from inception (D14).
_DEFAULT_SWAP_ROUTER_84532 = "0x94cC0AaC535CCDB3C01d6787D6413C739ae12bc4"
_DEFAULT_SWAP_ROUTER_46630 = "0x3Ce954107b1A675826B33bF23060Dd655e3758fE"
_DEFAULT_FEE_RECIPIENTS = (
    "0xA71e24359A6cb7A939aae2d62dD12b6256365c30,0xCB135893C84876aab9E10792b56e5bEa91dc578f"
)
_ROBINHOOD_PUBLIC_RPC = "https://rpc.testnet.chain.robinhood.com"
# 46630 has ~0.3s blocks (head ~92M+) and NO vault-flow indexer to borrow a floor from, so the
# swap-fee loop must NOT default to a genesis scan (it would show a false "real zero" for a long
# backfill). Floor to ~when Robinhood swaps went live (2026-07-16, block ~90.5M) unless
# SWAP_FEE_FROM_BLOCK_46630 overrides. Base borrows VAULT_INDEX_FROM_BLOCK (already set for the live
# vault-flows indexer), so its floor default is 0 (the env supplies the real one).
_ROBINHOOD_SWAP_INCEPTION_BLOCK = 90_500_000

# One swap-fee indexer per network. `rpc_env` wins, then `rpc_fallback`, then the agent's main RPC;
# `from_block_envs` are tried in order (first non-empty wins); `from_block_default` is the floor
# when none is set (never genesis for 46630).
_SWAP_FEE_NETWORKS: tuple[dict[str, Any], ...] = (
    {
        "network_id": "base",
        "router_env": "SWAP_ROUTER_84532",
        "router_default": _DEFAULT_SWAP_ROUTER_84532,
        "recipients_env": "SWAP_FEE_RECIPIENTS_84532",
        "recipients_default": _DEFAULT_FEE_RECIPIENTS,
        "rpc_env": "VAULT_INDEX_RPC_URL",
        "rpc_fallback": None,
        "from_block_envs": (
            "SWAP_FEE_FROM_BLOCK_84532",
            "SWAP_FEE_FROM_BLOCK",
            "VAULT_INDEX_FROM_BLOCK",
        ),
        "from_block_default": 0,
    },
    {
        "network_id": "robinhood",
        "router_env": "SWAP_ROUTER_46630",
        "router_default": _DEFAULT_SWAP_ROUTER_46630,
        "recipients_env": "SWAP_FEE_RECIPIENTS_46630",
        "recipients_default": _DEFAULT_FEE_RECIPIENTS,
        "rpc_env": "ROBINHOOD_INDEX_RPC_URL",
        "rpc_fallback": _ROBINHOOD_PUBLIC_RPC,
        "from_block_envs": ("SWAP_FEE_FROM_BLOCK_46630",),
        "from_block_default": _ROBINHOOD_SWAP_INCEPTION_BLOCK,
    },
)


def _resolve_start_block(from_block_envs: tuple[str, ...], default: int) -> int:
    for env_key in from_block_envs:
        raw = os.getenv(env_key)
        if raw:
            try:
                return int(raw)
            except ValueError:
                return default
    return default


async def _index_swap_fees_loop(net: dict[str, Any]) -> None:
    """Feature 013/014 swap-fee indexer for ONE network: record the router's fee ``Transfer``s
    (from == router, to ∈ the recipient set) into ``swap_fee_events`` so ``/admin/revenue`` shows
    the REAL 0.20% routing-fee take per network. Off the request path, fail-open, never withdraw.
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
    log_rpc = os.getenv(net["rpc_env"]) or net.get("rpc_fallback") or config.rpc_url
    if not log_rpc:
        return
    router = (os.getenv(net["router_env"]) or net["router_default"]).lower()
    recipients_raw = os.getenv(net["recipients_env"]) or net["recipients_default"]
    recipients = frozenset(a.strip().lower() for a in recipients_raw.split(",") if a.strip())
    if not router or not recipients:
        return
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
        network_id=net["network_id"],
        start_block=_resolve_start_block(net["from_block_envs"], net["from_block_default"]),
        **kwargs,
    )
    while True:
        try:
            result = await indexer.index_once()
            if result.inserted:
                logger.info(
                    "swap_fees_indexed network=%s added=%d", net["network_id"], result.inserted
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.warning("swap_fee_index_error network=%s (degrading)", net["network_id"])
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
    notif_task: asyncio.Task[None] | None = None
    swap_fee_tasks: list[asyncio.Task[None]] = []
    # A deployment-shape check, independent of every dependency — so it must run BEFORE (and
    # regardless of) the DB connect, which is allowed to fail (023, FR-023-019).
    _warn_if_multi_worker()
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
        # Feature 013/014: one background swap-fee indexer per network (router fee Transfers →
        # swap_fee_events → the real per-network /admin/revenue swap stream). Best-effort, off the
        # request path; never withdraw (N2).
        swap_fee_tasks = [
            asyncio.create_task(_index_swap_fees_loop(net)) for net in _SWAP_FEE_NETWORKS
        ]
        # Feature 021 phase 2: background notifications poller (edge-triggered caps/rate/new-recs →
        # notification_events). Best-effort, off the request path; never withdraw (N2). Env-gated.
        notif_task = asyncio.create_task(_notification_poller_loop())
    except Exception:
        # Covers connect errors AND the wait_for timeout — never interpolate the exception/DSN
        # (a connect error can carry the credential). Startup proceeds regardless.
        logger.warning("db_pool_connect_unavailable; DB-backed reads will degrade (fail-closed)")
    try:
        yield
    finally:
        if index_task is not None:
            index_task.cancel()
        if notif_task is not None:
            notif_task.cancel()
        for task in swap_fee_tasks:
            task.cancel()
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

# The §1.3 idempotency cache: an in-process fast path LAYERED over a Postgres-backed store
# (migration 0027), so a replay is honored after a restart and across workers — the old comment here
# promised exactly this and 023 delivers it (FR-023-015). The durable half is resolved lazily so
# module import never needs a DB, and every durable failure fails OPEN (the request is admitted):
# idempotency guards a double-emit on an ADVISORY build and is never on the withdraw/exit path (N2).
idempotency_store = LayeredIdempotencyStore(IdempotencyStore(), _durable_idempotency_store())
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
# §3.11 notifications (feature 021) — the real in-app feed, DERIVED live from indexed flows/
# executions/outcomes (never fabricated). Advisory read + a per-user read cursor; off the exit path.
app.include_router(notifications_router)
# §3.5/§3.6 execution spine (feature 019 US2) — the SINGLE signing chokepoint. /build-tx
# materializes
# an unsigned IntentBundle (recipient forced to the user, signature always null); /simulate
# refreshes
# it; /submit-signed-tx relays a user-signed payload (byte-matched) + records the execution; GET
# polls
# status. The service signs nothing (N1/N3); the withdraw/exit path is never gated (N2).
app.include_router(execution_router)
app.include_router(sessions_router)
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
# Admin user-analytics (/admin/users/analytics) — REAL cohort metrics (funnel, risk mix, activation,
# DAU/MAU, leaderboard, premium) from our own tables; admin-gated, pseudonymized, honest-degrade.
app.include_router(admin_analytics_router)
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
# SIWE network-gate diagnostics — S2S ingest (POST /diagnostics/ingest, forwarded by the web tier's
# /api/debug/network) + admin-only list (GET /admin/diagnostics). Client-reported, unverified; N2.
app.include_router(network_diagnostics_router)


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

    023 (FR-023-005/006) — the checks now describe **the chain this deployment actually serves**:

    - ``chain_rpc``      : an RPC url RESOLVED for ``CHAIN_ID`` (config, not a raw env name).
    - ``chain_identity`` : that RPC provably reports ``CHAIN_ID`` (the 023 probe).
    - ``sim_fork``       : reported always, but only counted toward ``ready`` when the served chain
                           actually allowlists a swap — the fork simulator is required for the
                           oracle-dependent swap path, not for the vault-only surface.

    Previously ``base_rpc`` keyed off ``BASE_SEPOLIA_RPC_URL``/``ALCHEMY_ACCESS_KEY`` and
    ``sim_fork`` off ``SIM_FORK_RPC_URL``, which was wrong in both directions on mainnet: a
    correctly-configured mainnet deployment reported not-ready forever, while one carrying a stale
    Sepolia url reported ready **while serving mainnet**. The second is the dangerous one, and an
    operator who learns to ignore ``/readyz`` is how a real outage gets missed.

    Chain-id VALUES may appear in this S2S breakdown (they are public facts); the RPC **url** never
    does, here or in any log line, because it can carry a provider key.
    """
    postgres_ok = False
    try:
        postgres_ok = bool(await get_database().healthcheck())
    except Exception:
        # Unconnected pool / unreachable DB / missing DSN → honestly not ready.
        postgres_ok = False
    chain_id, chain_rpc_ok, chain_identity_ok, swap_capable = await _chain_readiness()
    checks = {
        "chain_rpc": chain_rpc_ok,
        "chain_identity": chain_identity_ok,
        "sim_fork": bool(os.getenv("SIM_FORK_RPC_URL")),
        # Real LLM-gateway liveness (cached ~60s), not mere key-presence.
        "llm": await _llm_ready(),
        "postgres": postgres_ok,
    }
    # The fork simulator gates the SWAP path only; a vault-only chain is ready without it.
    required = dict(checks)
    if not swap_capable:
        required.pop("sim_fork")
    ready = all(required.values())
    if not has_valid_s2s(authorization):
        # Anonymous: boolean only — no dependency detail, no policy version.
        return {"ready": ready}
    return {
        "ready": ready,
        "checks": checks,
        # The chain being served, so an operator can tell a mis-pointed deployment apart from a
        # down dependency at a glance. A public fact — unlike the RPC url, which never appears.
        "chain_id": chain_id,
        # Default to the mirrored constant so the reported version is always accurate.
        "policy_version": os.getenv("POLICY_VERSION", POLICY_VERSION),
    }
