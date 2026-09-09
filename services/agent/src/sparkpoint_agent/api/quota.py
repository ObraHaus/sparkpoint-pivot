"""Per-tier quota enforcement for the LLM-bearing endpoints (feature 008, US1).

A FastAPI dependency that ADMITS or DENIES a request BEFORE the route body runs, so a ``/chat``
SSE stream never starts on an over-limit turn (once bytes flow the handler can only degrade to an
inert block, never a 429). Attach it via the route-level ``dependencies=[...]`` on ``/chat``,
``/recommendations`` and ``/onboarding/turn``.

Design invariants:
  * **Whole-turn metering** - the dependency increments the counter ONCE per HTTP request, so a
    chat turn that fans out to several model calls inside the DAG counts as a single turn.
  * **Fail-closed tier** - an unassigned wallet resolves to the default (free) tier (in the store).
  * **Fail-OPEN enforcement** - if the limits subsystem itself is unavailable (0015 not applied, a
    DB error), the request is ADMITTED. A limits outage must never block the assistant; this gate
    is advisory-compute only and is NEVER attached to a vault/withdraw/exit route (Constitution N2).
  * **Idempotency** - a replayed POST with the same ``Idempotency-Key`` is short-circuited by the
    request middleware BEFORE this dependency runs (for cached JSON endpoints), so those are not
    double-charged. ``/chat`` is SSE (never cached), so a same-key retry is a new turn - an
    accepted, generous-cap-mitigated edge; true SSE idempotency is deferred to hardening.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta, timezone
from functools import lru_cache
from typing import Annotated, Any, Literal, cast

from fastapi import Depends

from ..chain.broker_gate import BrokerGate, build_broker_gate_from_env
from ..db import Database, LimitsStore, get_database
from ..llm.client import set_model_alias
from ..llm.resilience import set_priority
from .errors import ApiError, ErrorCode
from .security import AccountContext
from .vault import get_account

logger = logging.getLogger(__name__)

Metric = Literal["chat", "recs", "onboarding"]

# Asia/Manila is a fixed UTC+8 (no DST) - avoids a zoneinfo/tzdata dependency for the window tz.
_MANILA = timezone(timedelta(hours=8))

_LIMIT_FIELD: dict[str, str] = {
    "chat": "chatDailyLimit",
    "recs": "recsDailyLimit",
    "onboarding": "onboardingDailyLimit",
}

_LIMIT_MESSAGE: dict[str, str] = {
    "chat": (
        "You've reached today's free limit for the AI assistant. It resets tomorrow — "
        "or upgrade to premium for higher limits."
    ),
    "recs": (
        "You've reached today's free limit for strategy recommendations. It resets tomorrow — "
        "or upgrade to premium for higher limits."
    ),
    "onboarding": "You've reached today's onboarding limit. It resets tomorrow.",
}


@lru_cache(maxsize=1)
def _broker_gate() -> BrokerGate | None:
    """The 043 broker gate, built once per process (it owns a TTL cache; rebuilding drops it).

    ``None`` when unconfigured, which is the pre-043 behaviour exactly: an activated broker simply
    is not a source of premium until the addresses are set.
    """
    return build_broker_gate_from_env()


def get_limits_store() -> LimitsStore:
    """The limits store, over the shared asyncpg pool (mirrors ``get_conversation_store``).

    Fail-OPEN at resolution: if no DB is configured (e.g. ``DATABASE_URL`` unset in a unit test, or
    limits not provisioned), return a store whose calls raise and are caught by
    ``check_and_consume`` — so the assistant is admitted rather than 500'd on a limits-infra gap.

    043: the store also carries the broker gate, so an activated Sparky Broker resolves premium. The
    gate is derived per request but the object is cached — its 60s TTL is per-process, and a fresh
    gate every request would mean a chain read every request.
    """
    gate = _broker_gate()
    try:
        return LimitsStore(get_database(), gate)
    except Exception:
        return LimitsStore(cast(Database, None), gate)


def window_start(now: datetime | None = None) -> datetime:
    """Start of the current quota window: Asia/Manila midnight, as a UTC timestamp.

    A fixed daily window (the bucketed-counter realization of the rolling-24h allowance; a true
    sliding window is deferred). Operator-tunable later.
    """
    now = now or datetime.now(tz=UTC)
    local = now.astimezone(_MANILA)
    midnight = local.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight.astimezone(UTC)


def _mask(address: str) -> str:
    a = address or ""
    return f"{a[:6]}…{a[-4:]}" if len(a) >= 10 else a


@dataclass(frozen=True)
class LimitDecision:
    """The outcome of a quota check (not persisted)."""

    allowed: bool
    tier: str
    metric: str
    used: int
    limit: int

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


async def check_and_consume(store: LimitsStore, owner: str, metric: Metric) -> LimitDecision:
    """Resolve the caller's tier, check the per-window counter, and (if under cap) increment it.

    On over-cap: records a masked ``deny`` event and returns ``allowed=False`` WITHOUT incrementing.
    On any limits-subsystem error: fails OPEN (``allowed=True``) so a limits outage never blocks
    the assistant.
    """
    try:
        tier = await store.resolve_tier(owner)
        tier_def = await store.get_tier(tier)
        if tier_def is None:
            # No config row for the resolved tier (e.g. 0015 not applied) - fail open.
            return LimitDecision(allowed=True, tier=tier, metric=metric, used=0, limit=0)
        # Tier the LLM-limiter queue budget for this request (US4 priority compute): premium waits
        # the full budget, free degrades first under contention. Read by llm/resilience.slot().
        set_priority(int(tier_def.get("priorityWeight", 1)))
        # Route this request to the tier's gateway model alias (premium may use a better model).
        # Read by the gateway transport; unset/empty falls back to the default alias.
        set_model_alias(str(tier_def.get("modelAlias") or "") or None)
        limit = int(tier_def[_LIMIT_FIELD[metric]])
        ws = window_start()
        used_before = await store.get_usage(owner, metric, ws)
        if used_before >= limit:
            await store.record_event(
                "deny", metric, tier, subject=_mask(owner),
                detail={"used": used_before, "limit": limit},
            )
            return LimitDecision(
                allowed=False, tier=tier, metric=metric, used=used_before, limit=limit
            )
        used = await store.increment(owner, metric, ws, tier_at_use=tier)
        return LimitDecision(allowed=True, tier=tier, metric=metric, used=used, limit=limit)
    except Exception:
        # Advisory gate: a limits failure must never block the assistant (never a funds path, N2).
        logger.warning("quota_check_failed_open metric=%s", metric)
        return LimitDecision(allowed=True, tier="unknown", metric=metric, used=0, limit=0)


def require_within_quota(metric: Metric) -> Callable[..., Any]:
    """A route-level dependency factory: admit or raise ``RATE_LIMITED`` (429) pre-stream."""

    async def _dep(
        account: Annotated[AccountContext, Depends(get_account)],
        store: Annotated[LimitsStore, Depends(get_limits_store)],
    ) -> LimitDecision:
        decision = await check_and_consume(store, account.owner, metric)
        if not decision.allowed:
            raise ApiError(ErrorCode.RATE_LIMITED, _LIMIT_MESSAGE[metric])
        return decision

    return _dep
