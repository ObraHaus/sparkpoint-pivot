"""034 — the wiring that actually runs a self-authoring job, and the daily loop that schedules it.

Separated from the router so the HTTP surface and the job have no circular import, and so the loop
can be started from `lifespan` the same way 033's changelog index is.

THE LOCK IS NOT OPTIONAL. `main.py` already warns when `WEB_CONCURRENCY > 1`, because the LLM
concurrency limiter is per-process. Without `pg_try_advisory_lock`, every extra worker and every
restart would run this job again — and unlike a search index, this one calls a model and an
embedding provider on every run. The notification poller and the APY poller use exactly this
pattern; this is the third.

CADENCE. Check every 30 minutes whether a run is due; run at most once a day. A tight loop would
hammer the lock for nothing, and a flat 24-hour sleep would mean a restart resets the clock — on a
service that redeploys a few times a week, the job might never run at all.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

from ..db import get_database
from ..db.self_authoring import SelfAuthoringStore
from ..selfauthor.run import OUTCOME_DISABLED, OUTCOME_LOCKED, RUN_LOCK_KEY, RunResult, execute_run

logger = logging.getLogger(__name__)

#: How often to ask "is a run due?" — not how often a run happens.
_TICK_S = 1800.0
#: A run is due this long after the last one STARTED.
_PERIOD_S = 24 * 3600.0
#: Give the first tick time for boot to settle; a run during startup competes with warm-up traffic.
_FIRST_TICK_DELAY_S = 300.0

SELF_AUTHORED_KIND = "self_authored"

#: The gateway alias this job uses, so its model traffic is separable from users' chat.
#:
#: WHY ITS OWN ALIAS. Before this, the job ran on `sparkpoint-chat` — which points at two `:free`
#: OpenRouter deployments shared with every user's chat. So a six-document run competed with real
#: conversations for the same free pool and the same virtual-key rate limit, and there was no way to
#: tell from the gateway which spend was whose. A dedicated alias separates the traffic, gives the
#: job a model chosen for THIS task, and makes its usage legible in the gateway's Activity view.
#:
#: DELIBERATELY NO FALLBACK TO THE CHAT ALIASES. `sparkpoint-chat-premium` falls back to
#: `sparkpoint-chat`, and copying that here would reintroduce exactly the coupling this removes: a
#: self-authoring run failing over onto the users' pool. Letting it fail is better — a failed run
#: writes nothing and leaves the published documents untouched, which is already the safe outcome.
SELF_AUTHORING_ALIAS_ENV = "SELF_AUTHORING_MODEL_ALIAS"
DEFAULT_SELF_AUTHORING_ALIAS = "sparkpoint-selfauthor"


def self_authoring_alias() -> str:
    """Which gateway alias the job asks for. Overridable so a rollback is an env change."""
    import os

    return (os.getenv(SELF_AUTHORING_ALIAS_ENV) or "").strip() or DEFAULT_SELF_AUTHORING_ALIAS


def _chunk_store() -> Any:
    from ..knowledge import PgChunkStore

    return PgChunkStore(get_database(), source_kind=SELF_AUTHORED_KIND)


async def publish_document(slug: str, title: str, markdown: str) -> None:
    """Make a document retrievable — or, with empty markdown, prune it back out.

    Reuses `ingest_note`, whose chunk ids are UUID5 over (source, index) with orphans pruned. That
    is what makes rewriting a document in place free: re-ingesting `slug` replaces exactly this
    document's chunks and touches nothing else, so the corpus stays the size it is.
    """
    from ..knowledge import ingest_note, openai_embedder

    embedder = openai_embedder()
    if embedder is None:
        logger.info("self_authoring_publish_skipped (no embedder configured) slug=%s", slug)
        return
    text = markdown.strip()
    if not text:
        await unpublish_document(slug)
        return
    body = text if text.startswith("#") else f"# {title}\n\n{text}"
    try:
        await ingest_note(
            body,
            source=slug,
            store=_chunk_store(),
            embedder=embedder,
            source_ref="self-authored",
            source_kind=SELF_AUTHORED_KIND,
        )
    except Exception as exc:  # noqa: BLE001 — a publish failure must not abort a run
        logger.warning(
            "self_authoring_publish_failed slug=%s (%s: %s)", slug, type(exc).__name__, exc
        )


async def unpublish_document(slug: str) -> None:
    """Remove a document's chunks. Idempotent — pruning something already gone is not an error."""
    from ..knowledge import source_uuid

    try:
        await _chunk_store().prune_source(source_uuid(slug), [])
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "self_authoring_unpublish_failed slug=%s (%s: %s)", slug, type(exc).__name__, exc
        )


async def _search(question: str, k: int) -> list[Any]:
    """Retrieval as the assistant sees it — the same store and embedder an answer would use.

    Anything else would prove nothing: a self-check against a different index could pass while the
    real one had regressed.
    """
    from ..knowledge import PgChunkStore, openai_embedder
    from ..knowledge.search import knowledge_search_hits

    embedder = openai_embedder()
    if embedder is None:
        raise RuntimeError("no embedder configured — the self-check cannot run")
    store = PgChunkStore(get_database(), source_kind=SELF_AUTHORED_KIND)
    return await knowledge_search_hits(question, k, store=store, embedder=embedder)


def _llm() -> Any:
    """The model client for this job, bound to its OWN alias.

    ⚠️ `AsyncClaudeClient.from_env(model=...)` CANNOT be used here: on the gateway path it discards
    the `model` argument entirely and uses `gateway_from_env()`'s alias (`LITELLM_MODEL`). Passing
    an alias to `from_env` looks like it works and silently does nothing — so the gateway client is
    constructed explicitly instead.

    Off the gateway (local dev, or an Anthropic credential) there are no aliases, so the ordinary
    resolution applies and this job shares whatever chat uses. That is correct: the separation being
    bought here is a gateway concept.
    """
    from ..llm import AsyncClaudeClient
    from ..llm.claude import gateway_from_env

    gateway = gateway_from_env()
    if gateway is None:
        return AsyncClaudeClient.from_env()
    base_url, api_key, _chat_alias = gateway
    alias = self_authoring_alias()
    logger.info("self_authoring_model alias=%s", alias)
    return AsyncClaudeClient.for_gateway(base_url, api_key, model=alias)


async def run_once(*, trigger: str = "schedule") -> RunResult:
    """Take the lock and run. Never raises; the caller is a background task."""
    from ..config import AgentConfig

    db = get_database()
    store = SelfAuthoringStore(db)

    settings = await store.get_settings()
    if not settings.enabled:
        return RunResult(OUTCOME_DISABLED, "the feature is disabled")

    try:
        config = AgentConfig.from_env()
    except Exception:  # noqa: BLE001
        return RunResult(OUTCOME_DISABLED, "no agent configuration")

    try:
        async with db.acquire() as conn:
            got = await conn.fetchval("SELECT pg_try_advisory_lock($1)", RUN_LOCK_KEY)
            if not got:
                # FR-002: a concurrent attempt declines AND RECORDS that it declined. Found by the
                # first live verification — the decline was real (the lock held) but invisible, so
                # an admin who pressed the button twice saw one run and no explanation for the
                # other. "It silently did nothing" and "it declined because one was already
                # running" look identical from the console, and only one of them is fine.
                logger.info("self_authoring_skipped (another run holds the lock)")
                detail = "another run was already in flight"
                try:
                    declined = await store.open_run(trigger=trigger)
                    await store.close_run(declined, outcome=OUTCOME_LOCKED, detail=detail)
                except Exception:  # noqa: BLE001 — failing to record a decline is not worth raising
                    logger.warning("self_authoring_decline_unrecorded")
                return RunResult(OUTCOME_LOCKED, detail)
            try:
                return await execute_run(
                    store=store,
                    settings=settings,
                    config=config,
                    db=db,
                    llm=_llm(),
                    publish=publish_document,
                    search=_search,
                    trigger=trigger,
                    now_epoch=time.time(),
                )
            finally:
                await conn.execute("SELECT pg_advisory_unlock($1)", RUN_LOCK_KEY)
    except Exception as exc:  # noqa: BLE001 — a degraded pool skips this run, nothing more
        logger.warning("self_authoring_run_skipped (%s: %s)", type(exc).__name__, exc)
        return RunResult("error", f"{type(exc).__name__}: {exc}")


async def daily_loop() -> None:
    """Ask every half hour whether a run is due. Background, fail-open, cancelled on shutdown."""
    # Housekeeping first: a run interrupted by the deploy that started THIS process is still sitting
    # open, and the console renders an open run as "Running…" indefinitely. Sweeping at boot is the
    # natural place — by definition nothing is in flight here yet.
    try:
        await SelfAuthoringStore(get_database()).close_orphaned_runs()
    except Exception as exc:  # noqa: BLE001 — housekeeping must never cost the loop its start
        logger.warning("self_authoring_orphan_sweep_skipped (%s)", type(exc).__name__)
    await asyncio.sleep(_FIRST_TICK_DELAY_S)
    while True:
        try:
            store = SelfAuthoringStore(get_database())
            settings = await store.get_settings()
            if settings.enabled:
                last = await store.last_successful_start()
                due = last is None or (time.time() - last.timestamp()) >= _PERIOD_S
                if due:
                    result = await run_once(trigger="schedule")
                    logger.info(
                        "self_authoring_tick outcome=%s detail=%s", result.outcome, result.detail
                    )
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 — a bad tick must never end the loop
            logger.warning("self_authoring_tick_failed (%s: %s)", type(exc).__name__, exc)
        await asyncio.sleep(_TICK_S)
