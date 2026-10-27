"""Per-wallet tier limits & priority compute (feature 008) - DB-backed, audit-logged.

An ADVISORY-COMPUTE gate only (chat / recommendations / onboarding). It NEVER gates custody:
/exit, /trust, the vault, and the on-chain withdraw path are never checked against it (N2).
Tier resolution FAILS CLOSED to the default (free) tier. Addresses are stored + compared
LOWERCASE (callers checksum-normalize for display), matching ``wallet_allowlist`` (0005). Every
config mutation writes an append-only ``limits_audit`` row in the same transaction.

Schema: ``../../../migrations/0015_limits.sql`` (tier_definitions, wallet_tier, usage_counters,
limits_event, limits_audit).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from asyncpg import Record

from ..chain.broker_gate import BrokerGate
from .pool import Database

DEFAULT_TIER = "free"
#: The tier an activated Sparky Broker confers (043). Named rather than inlined so the two places
#: that grant it cannot drift apart.
PREMIUM_TIER = "premium"
METRICS = ("chat", "recs", "onboarding")

_TIERS_SQL = (
    "SELECT tier, display_name, chat_daily_limit, recs_daily_limit, onboarding_daily_limit, "
    "concurrency, priority_weight, model_alias, is_default "
    "FROM tier_definitions ORDER BY is_default DESC, tier"
)
_TIER_SQL = (
    "SELECT tier, display_name, chat_daily_limit, recs_daily_limit, onboarding_daily_limit, "
    "concurrency, priority_weight, model_alias, is_default FROM tier_definitions WHERE tier = $1"
)
_DEFAULT_TIER_SQL = "SELECT tier FROM tier_definitions WHERE is_default LIMIT 1"
_IS_DEFAULT_SQL = "SELECT is_default FROM tier_definitions WHERE tier = $1"
_UPDATE_TIER_SQL = (
    "UPDATE tier_definitions SET display_name=$2, chat_daily_limit=$3, recs_daily_limit=$4, "
    "onboarding_daily_limit=$5, concurrency=$6, priority_weight=$7, model_alias=$8, "
    "updated_by=$9, updated_at=now() WHERE tier=$1"
)

_RESOLVE_SQL = (
    "SELECT tier FROM wallet_tier WHERE address = $1 "
    "AND (expires_at IS NULL OR expires_at > now())"
)
_EXPIRY_SQL = (
    "SELECT expires_at FROM wallet_tier WHERE address = $1 "
    "AND (expires_at IS NULL OR expires_at > now())"
)
_ASSIGN_SQL = (
    "INSERT INTO wallet_tier (address, tier, source, assigned_by, expires_at) "
    "VALUES ($1, $2, $3, $4, $5) "
    "ON CONFLICT (address) DO UPDATE SET tier = excluded.tier, source = excluded.source, "
    "assigned_by = excluded.assigned_by, expires_at = excluded.expires_at, assigned_at = now()"
)
_SEED_ASSIGN_SQL = (
    "INSERT INTO wallet_tier (address, tier, source, assigned_by) "
    "VALUES ($1, 'premium', 'env-seed', 'env-seed') ON CONFLICT (address) DO NOTHING"
)
_REVOKE_SQL = "DELETE FROM wallet_tier WHERE address = $1"

_INCR_SQL = (
    "INSERT INTO usage_counters (address, metric, window_start, count, tier_at_use) "
    "VALUES ($1, $2, $3, 1, $4) "
    "ON CONFLICT (address, metric, window_start) DO UPDATE SET count = usage_counters.count + 1 "
    "RETURNING count"
)
_USAGE_SQL = (
    "SELECT count FROM usage_counters WHERE address = $1 AND metric = $2 AND window_start = $3"
)
# Refund one consumed unit for a turn that failed upstream. GREATEST clamps the counter at zero so a
# duplicate/racing refund can never make usage negative; a missing row is a no-op (returns NULL).
_REFUND_SQL = (
    "UPDATE usage_counters SET count = GREATEST(count - 1, 0) "
    "WHERE address = $1 AND metric = $2 AND window_start = $3 RETURNING count"
)

_EVENT_SQL = (
    "INSERT INTO limits_event (verdict, metric, tier, subject, detail) "
    "VALUES ($1, $2, $3, $4, $5::jsonb)"
)
_AUDIT_SQL = (
    "INSERT INTO limits_audit (action, subject, actor, detail) VALUES ($1, $2, $3, $4::jsonb)"
)
_AUDIT_READ_SQL = (
    "SELECT action, subject, actor, detail, at FROM limits_audit ORDER BY at DESC LIMIT $1"
)

# -- monitoring aggregations (US3) --
_USAGE_BY_TIER_SQL = (
    "SELECT COALESCE(tier_at_use, 'unknown') AS tier, count(DISTINCT address) AS wallets, "
    "COALESCE(sum(count), 0) AS turns FROM usage_counters WHERE window_start = $1 "
    "GROUP BY 1 ORDER BY turns DESC"
)
_TOP_CONSUMERS_SQL = (
    "SELECT address, COALESCE(max(tier_at_use), 'free') AS tier, COALESCE(sum(count), 0) AS turns "
    "FROM usage_counters WHERE window_start = $1 GROUP BY address ORDER BY turns DESC LIMIT $2"
)
_EVENT_COUNTS_SQL = (
    "SELECT verdict, count(*) AS n FROM limits_event WHERE at >= $1 GROUP BY verdict"
)
_RECENT_EVENTS_SQL = (
    "SELECT verdict, metric, tier, subject, at FROM limits_event ORDER BY at DESC LIMIT $1"
)


def _norm(address: str | None) -> str:
    return (address or "").strip().lower()


def _row_to_tier(r: Record) -> dict[str, Any]:
    return {
        "tier": str(r["tier"]),
        "displayName": str(r["display_name"]),
        "chatDailyLimit": int(r["chat_daily_limit"]),
        "recsDailyLimit": int(r["recs_daily_limit"]),
        "onboardingDailyLimit": int(r["onboarding_daily_limit"]),
        "concurrency": int(r["concurrency"]),
        "priorityWeight": int(r["priority_weight"]),
        "modelAlias": str(r["model_alias"]),
        "isDefault": bool(r["is_default"]),
    }


@dataclass
class LimitsStore:
    """asyncpg-backed store for tier definitions, assignments, usage counters, and audit."""

    db: Database
    #: 043 — an activated Sparky Broker is a live source of premium. Optional: `None` (the default)
    #: means the agent resolves tiers exactly as it did before the feature existed.
    broker_gate: BrokerGate | None = None

    # -- tier definitions ----------------------------------------------------

    async def get_tiers(self) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_TIERS_SQL)
        return [_row_to_tier(r) for r in rows]

    async def get_tier(self, tier: str) -> dict[str, Any] | None:
        r = await self.db.fetchrow(_TIER_SQL, tier.strip().lower())
        return _row_to_tier(r) if r is not None else None

    async def default_tier(self) -> str:
        d = await self.db.fetchval(_DEFAULT_TIER_SQL)
        return str(d) if d else DEFAULT_TIER

    async def upsert_tier(
        self,
        tier: str,
        *,
        display_name: str,
        chat_daily_limit: int,
        recs_daily_limit: int,
        onboarding_daily_limit: int,
        concurrency: int,
        priority_weight: int,
        model_alias: str,
        actor: str | None,
    ) -> None:
        """Update an existing tier's inclusion values (audited). Raises ``KeyError`` for an unknown
        tier and ``ValueError`` for a negative value or a zero chat allowance on the DEFAULT tier
        (the fail-safe that stops a misconfig from stranding the assistant, FR-008)."""
        t = tier.strip().lower()
        for name, val in (
            ("chat_daily_limit", chat_daily_limit),
            ("recs_daily_limit", recs_daily_limit),
            ("onboarding_daily_limit", onboarding_daily_limit),
            ("concurrency", concurrency),
            ("priority_weight", priority_weight),
        ):
            if val < 0:
                raise ValueError(f"{name} must be >= 0")
        act = _norm(actor) or None
        async with self.db.acquire() as conn, conn.transaction():
            is_default = await conn.fetchval(_IS_DEFAULT_SQL, t)
            if is_default is None:
                raise KeyError(t)  # unknown tier
            if is_default and chat_daily_limit <= 0:
                raise ValueError(
                    "The default tier's chat allowance must be greater than 0 "
                    "(a limit must never strand the assistant)."
                )
            await conn.execute(
                _UPDATE_TIER_SQL,
                t,
                display_name,
                chat_daily_limit,
                recs_daily_limit,
                onboarding_daily_limit,
                concurrency,
                priority_weight,
                model_alias,
                act,
            )
            await conn.execute(
                _AUDIT_SQL,
                "tier_update",
                t,
                act,
                json.dumps(
                    {
                        "chatDailyLimit": chat_daily_limit,
                        "recsDailyLimit": recs_daily_limit,
                        "onboardingDailyLimit": onboarding_daily_limit,
                        "concurrency": concurrency,
                        "priorityWeight": priority_weight,
                        "modelAlias": model_alias,
                    }
                , ensure_ascii=False),
            )

    # -- tier assignment -----------------------------------------------------

    async def _stored_tier(self, address: str) -> str:
        """The tier written in `wallet_tier` — the pre-043 answer, unchanged."""
        tier = await self.db.fetchval(_RESOLVE_SQL, _norm(address))
        if tier:
            return str(tier)
        return await self.default_tier()

    async def resolve_tier(self, address: str) -> str:
        """The wallet's tier: the stored grant, OR premium from an activated Sparky Broker (043).

        ⚠️ The broker half is **derived on every read and never written down**. Persisting it would
        create a grant that outlives the sale that should end it — a holder sells their broker and a
        stranger keeps the access. That is the one bug that makes the collection pointless, so the
        NFT-derived answer deliberately has nowhere to be stored.

        The gate is fail-closed and never raises, so an unreachable chain degrades to the stored
        answer rather than failing the request or inventing a downgrade.
        """
        stored = await self._stored_tier(address)
        if stored == PREMIUM_TIER or self.broker_gate is None:
            return stored
        if (await self.broker_gate.check(address)).qualified:
            return PREMIUM_TIER
        return stored

    async def resolve_tier_source(self, address: str) -> dict[str, Any]:
        """Which source is paying for this wallet's tier — so a surface can name it (FR-005).

        The failure mode this exists to prevent is a holder who cannot tell why their access ended.
        `source` is 'stored' (a purchase or an admin grant), 'broker', or None when the tier is the
        default. When both qualify, 'stored' is reported: it is the one with an expiry the holder
        may want to see, and the broker keeps the tier alive after it lapses either way.
        """
        stored = await self._stored_tier(address)
        if stored == PREMIUM_TIER:
            return {
                "tier": stored,
                "source": "stored",
                "expiresAt": await self.resolve_expiry(address),
                "tokenId": None,
            }
        if self.broker_gate is not None:
            result = await self.broker_gate.check(address)
            if result.qualified:
                # No expiry, deliberately: a broker-sourced tier ends on transfer, not on a date.
                return {
                    "tier": PREMIUM_TIER,
                    "source": "broker",
                    "expiresAt": None,
                    "tokenId": result.token_id,
                }
        return {"tier": stored, "source": None, "expiresAt": None, "tokenId": None}

    async def resolve_expiry(self, address: str) -> datetime | None:
        """The wallet's current (future) STORED tier expiry, or None.

        Unchanged by 043 on purpose: a broker-derived tier has no expiry — it ends when the broker
        is
        transferred — so it must never manufacture a date here.
        """
        expiry: datetime | None = await self.db.fetchval(_EXPIRY_SQL, _norm(address))
        return expiry

    async def assign(
        self,
        address: str,
        tier: str,
        *,
        actor: str | None,
        source: str = "admin",
        expires_at: datetime | None = None,
    ) -> None:
        addr = _norm(address)
        t = tier.strip().lower()
        act = _norm(actor) or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_ASSIGN_SQL, addr, t, source, act, expires_at)
            await conn.execute(
                _AUDIT_SQL,
                "grant",
                addr,
                act,
                json.dumps(
                    {
                        "tier": t,
                        "source": source,
                        "expires_at": expires_at.isoformat() if expires_at else None,
                    }
                , ensure_ascii=False),
            )

    async def revoke(self, address: str, *, actor: str | None) -> None:
        addr = _norm(address)
        act = _norm(actor) or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_REVOKE_SQL, addr)
            await conn.execute(
                _AUDIT_SQL, "revoke", addr, act, json.dumps({}, ensure_ascii=False)
            )

    async def seed_premium(self, addresses: list[str]) -> int:
        """Idempotently seed premium wallets from ``PREMIUM_ALLOWLIST``. Returns NEW rows added."""
        added = 0
        async with self.db.acquire() as conn, conn.transaction():
            for raw in addresses:
                addr = _norm(raw)
                if not addr:
                    continue
                result = await conn.execute(_SEED_ASSIGN_SQL, addr)
                if result.endswith("1"):  # "INSERT 0 1" => a new row (not a conflict no-op)
                    await conn.execute(
                        _AUDIT_SQL,
                        "seed",
                        addr,
                        "env-seed",
                        json.dumps({"tier": "premium"}, ensure_ascii=False),
                    )
                    added += 1
        return added

    # -- usage counters ------------------------------------------------------

    async def increment(
        self, address: str, metric: str, window_start: datetime, *, tier_at_use: str
    ) -> int:
        """Atomically bump the per-wallet/metric/window counter and return the new count."""
        count = await self.db.fetchval(_INCR_SQL, _norm(address), metric, window_start, tier_at_use)
        return int(count or 0)

    async def get_usage(self, address: str, metric: str, window_start: datetime) -> int:
        count = await self.db.fetchval(_USAGE_SQL, _norm(address), metric, window_start)
        return int(count or 0)

    async def refund(self, address: str, metric: str, window_start: datetime) -> int:
        """Return ONE unit to the same per-wallet/metric/window counter (clamped at zero).

        The caller passes the window it captured at consume time, so a failure after Manila
        midnight still refunds the day that was actually charged. Returns the resulting count
        (0 when the row no longer exists). No migration: the counter table is unchanged.
        """
        count = await self.db.fetchval(_REFUND_SQL, _norm(address), metric, window_start)
        return int(count or 0)

    # -- monitoring event feed + audit read ----------------------------------

    async def record_event(
        self,
        verdict: str,
        metric: str,
        tier: str,
        *,
        subject: str | None,
        detail: dict[str, Any] | None = None,
    ) -> None:
        await self.db.execute(
            _EVENT_SQL, verdict, metric, tier, subject, json.dumps(detail or {}, ensure_ascii=False)
        )

    async def usage_by_tier(self, window_start: datetime) -> list[dict[str, Any]]:
        """Per-tier consumption for one window: active wallets + total turns."""
        rows = await self.db.fetch(_USAGE_BY_TIER_SQL, window_start)
        return [
            {"tier": str(r["tier"]), "wallets": int(r["wallets"]), "turns": int(r["turns"])}
            for r in rows
        ]

    async def top_consumers(self, window_start: datetime, limit: int = 10) -> list[dict[str, Any]]:
        """Heaviest wallets for one window (raw address; the API layer masks it)."""
        rows = await self.db.fetch(_TOP_CONSUMERS_SQL, window_start, max(1, min(limit, 100)))
        return [
            {"address": str(r["address"]), "tier": str(r["tier"]), "turns": int(r["turns"])}
            for r in rows
        ]

    async def event_counts(self, since: datetime) -> dict[str, int]:
        """Counts of allow/deny/throttle events since ``since`` (drives the throttle/deny rate)."""
        rows = await self.db.fetch(_EVENT_COUNTS_SQL, since)
        return {str(r["verdict"]): int(r["n"]) for r in rows}

    async def recent_events(self, limit: int = 25) -> list[dict[str, Any]]:
        """The most-recent decision events (masked subject; no content), newest first."""
        rows = await self.db.fetch(_RECENT_EVENTS_SQL, max(1, min(limit, 200)))
        return [
            {
                "verdict": str(r["verdict"]),
                "metric": str(r["metric"]),
                "tier": str(r["tier"]),
                "subject": (str(r["subject"]) if r["subject"] is not None else None),
                "at": r["at"].isoformat(),
            }
            for r in rows
        ]

    async def recent_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_AUDIT_READ_SQL, max(1, min(limit, 500)))
        return [
            {
                "action": str(r["action"]),
                "subject": str(r["subject"]),
                "actor": (str(r["actor"]) if r["actor"] is not None else None),
                "detail": (
                    json.loads(r["detail"]) if isinstance(r["detail"], str) else r["detail"]
                ),
                "at": r["at"].isoformat(),
            }
            for r in rows
        ]
