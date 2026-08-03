"""Mandate persistence — versioned, immutable-per-version rows (data-model.md sec.5).

Backs the §3.1 ``POST/GET/PUT /mandate`` endpoints. A mandate is OFFCHAIN product data:
it holds no key, gates no signature, and never sits on the withdrawal path (N2). It only
ever NARROWS what the onchain allowlist already permits (VR-M5); the deterministic policy
layer re-checks every action regardless, so nothing here can authorize an out-of-policy
move. Losing all of Postgres degrades personalization but cannot move or trap funds.

Persistence invariants (data-model.md sec.5 VR-M1/M2/M4):
  - Editing goals/risk FORKS a new ``version`` (never mutates a confirmed row), preserving
    the exact ruleset that scored any historical recommendation (provability).
  - At most one ``confirmed`` (active) mandate per user; the write supersedes the prior
    confirmed row and repoints ``users.active_mandate_id`` atomically in one transaction.

The store is an injected :class:`MandateStore` Protocol so tests mock it (no live DB is
touched); production uses :class:`PgMandateStore` over the asyncpg pool.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Any, Protocol
from uuid import UUID

from asyncpg import Record

from .pool import Database


def _iso(value: datetime | None) -> str | None:
    """Render a TIMESTAMPTZ as an ISO-8601 ``...Z`` string (§1.4), or ``None``."""
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class MandateWrite:
    """The validated, mapped values a confirmed mandate version is persisted from.

    Assembled by the API layer from the §3.1 request body; the store assigns ``version``,
    ``status='confirmed'``, and ``confirmed_at`` itself (the client never sets those).
    """

    risk_tier: str
    risk_score: int
    max_slippage_bps: int
    time_horizon: str | None
    horizon_months: int | None
    drawdown_tolerance: str | None
    allowed_assets: list[str]
    goals: list[dict[str, Any]]
    risk_params: dict[str, Any]
    summary_text: str
    # 030 — the four things the mandate could not previously express, plus the display tier.
    # ALL OPTIONAL: None means "the user never said", which is a different fact from zero. A zero
    # exposure limit would silently forbid every proposal for every pre-030 user.
    exposure_limit_usdc: int | None = None
    exposure_limit_pct_bps: int | None = None
    goal_target_usdc: int | None = None
    goal_target_date: date | None = None
    allowed_protocols: list[str] | None = None
    contribution: dict[str, Any] | None = None
    risk_tier_display: int | None = None


@dataclass(frozen=True)
class MandateRecord:
    """A persisted mandate version, rendered to the §3.1 wire shape by :meth:`to_wire`."""

    id: UUID
    version: int
    status: str
    confirmed_at: datetime | None
    risk_tier: str
    max_slippage_bps: int
    horizon_months: int | None
    drawdown_tolerance: str | None
    goals: list[dict[str, Any]]
    risk_params: dict[str, Any]
    summary_text: str
    exposure_limit_usdc: int | None = None
    exposure_limit_pct_bps: int | None = None
    goal_target_usdc: int | None = None
    goal_target_date: date | None = None
    allowed_protocols: list[str] | None = None
    contribution: dict[str, Any] | None = None
    risk_tier_display: int | None = None

    def to_wire(self) -> dict[str, Any]:
        """The §3.1 mandate object: ``active`` ⟺ this is the user's confirmed version.

        Carries NO signable artifact — no ``proposedAction``, no calldata, no signature.
        """
        wire: dict[str, Any] = {
            "id": f"mnd_{self.id.hex}",
            "version": self.version,
            "active": self.status == "confirmed",
            "confirmedAt": _iso(self.confirmed_at),
            "riskProfile": self.risk_tier,
            "riskParams": self.risk_params,
            "goals": self.goals,
            "summaryText": self.summary_text,
        }
        # 030 — OMITTED when not stated, never emitted as null or zero. The web treats an absent
        # key as "the user never said" and falls back to pre-030 behaviour (FR-021); a zero would
        # read as a real limit of nothing.
        if self.exposure_limit_usdc is not None:
            wire["exposureLimitUsdc"] = str(self.exposure_limit_usdc)
        if self.exposure_limit_pct_bps is not None:
            wire["exposureLimitPctBps"] = self.exposure_limit_pct_bps
        if self.goal_target_usdc is not None:
            wire["goalTargetUsdc"] = str(self.goal_target_usdc)
        if self.goal_target_date is not None:
            wire["goalTargetDate"] = self.goal_target_date.isoformat()
        if self.allowed_protocols is not None:
            wire["allowedProtocols"] = self.allowed_protocols
        if self.contribution is not None:
            wire["contribution"] = self.contribution
        if self.risk_tier_display is not None:
            wire["riskTier"] = self.risk_tier_display
        return wire


_logger = logging.getLogger(__name__)
_warned_pre_030 = False

#: Tri-state cache of "does this database have the 0033 columns?" — `None` until first probed.
#:
#: ⚠️ WHY A PROBE AND NOT A try/except AROUND THE INSERT. The obvious implementation — attempt the
#: 030 INSERT, catch `UndefinedColumnError`, retry the pre-030 one — CANNOT WORK, and unit tests
#: with fakes will happily say it does. The insert runs inside a transaction, and Postgres aborts
#: the entire transaction on any statement error: every subsequent command in it fails with
#: `InFailedSQLTransactionError`, including the retry. Verified against the real un-migrated
#: database, which is the only place this shows up.
#:
#: So the capability is resolved BEFORE the transaction opens, once per process, and the choice of
#: statement is made from the answer. A failed probe resolves to False, because the pre-030
#: statement works against both schemas and losing four new fields beats losing the user's plan.
_has_030_schema: bool | None = None


async def _probe_030_schema(conn: Any) -> bool:
    """Does this database have the 0033 columns? Cached per process, fail-safe to ``False``."""
    global _has_030_schema
    if _has_030_schema is None:
        try:
            _has_030_schema = bool(
                await conn.fetchval(
                    "SELECT true FROM information_schema.columns "
                    "WHERE table_name = 'mandates' AND column_name = 'exposure_limit_usdc'"
                )
            )
        except Exception:  # noqa: BLE001 — a probe that cannot run means "assume not migrated"
            _has_030_schema = False
        if not _has_030_schema:
            _warn_pre_030_schema()
    return _has_030_schema


def _warn_pre_030_schema() -> None:
    """Warn once that migration 0033 has not been applied, then keep serving.

    The mandate still saves and loads; it simply cannot carry the exposure limit, the goal target,
    the protocol comfort list or the contribution intent until the migration lands.
    """
    global _warned_pre_030
    if not _warned_pre_030:
        _warned_pre_030 = True
        _logger.warning(
            "mandate_pre_030_schema: migration 0033 is not applied, so exposure limits and goal "
            "targets cannot be stored. Mandates still save and load with their pre-030 fields. "
            "Logged once per process."
        )


def _as_json(value: Any) -> Any:
    """Decode a JSONB column (asyncpg returns it as ``str`` without a codec)."""
    return json.loads(value) if isinstance(value, str) else value


def _opt(row: Record, key: str) -> Any:
    """A column that may not exist yet (pre-0033 schema) — absent reads as ``None``.

    030: this is what makes the migration order-insensitive in the direction that matters. A 030
    agent against a pre-0033 database returns rows without these keys; reading them positionally
    would raise, and the user would lose their mandate entirely rather than lose four new fields.
    """
    try:
        return row[key]
    except (KeyError, IndexError):
        return None


def _opt_int(row: Record, key: str) -> int | None:
    value = _opt(row, key)
    return None if value is None else int(value)


def row_to_record(row: Record) -> MandateRecord:
    """Map a ``mandates`` row (the shared column projection) to a :class:`MandateRecord`."""
    return MandateRecord(
        id=row["id"],
        version=row["version"],
        status=str(row["status"]),
        confirmed_at=row["confirmed_at"],
        risk_tier=str(row["risk_tier"]),
        max_slippage_bps=row["max_slippage_bps"],
        horizon_months=row["horizon_months"],
        drawdown_tolerance=row["drawdown_tolerance"],
        goals=_as_json(row["goals"]),
        risk_params=_as_json(row["risk_params"]),
        summary_text=row["summary_text"],
        # 030 — a pre-0033 schema simply does not return these keys, so the mapper reads them
        # defensively and the record degrades to pre-030 behaviour rather than raising.
        exposure_limit_usdc=_opt_int(row, "exposure_limit_usdc"),
        exposure_limit_pct_bps=_opt_int(row, "exposure_limit_pct_bps"),
        goal_target_usdc=_opt_int(row, "goal_target_usdc"),
        goal_target_date=_opt(row, "goal_target_date"),
        allowed_protocols=_as_json(_opt(row, "allowed_protocols")),
        contribution=_as_json(_opt(row, "contribution")),
        risk_tier_display=_opt_int(row, "risk_tier_display"),
    )


class MandateStore(Protocol):
    """The mandate persistence boundary the §3.1 endpoints depend on (mocked in tests)."""

    async def persist(
        self, *, owner_eoa: str, network_id: str, write: MandateWrite
    ) -> MandateRecord: ...

    async def get_active(
        self, *, owner_eoa: str, network_id: str
    ) -> MandateRecord | None: ...


# Static SQL literals (no interpolation of any caller value — asyncpg binds every
# argument server-side via $-placeholders, so there is no injection surface).
#: The columns 0033 added. Named once here, and asserted against the SQL below by
#: `tests/db/test_mandates.py` so the two projections cannot silently drift apart. Written as
#: plain literals rather than interpolated, so the SQL stays greppable and no query is built by
#: string formatting.
_030_COLUMNS: tuple[str, ...] = (
    "exposure_limit_usdc",
    "exposure_limit_pct_bps",
    "goal_target_usdc",
    "goal_target_date",
    "allowed_protocols",
    "contribution",
    "risk_tier_display",
)

_INSERT_SQL = """
INSERT INTO mandates (
    user_id, network_id, version, status, risk_tier, risk_score,
    max_slippage_bps, time_horizon, horizon_months, drawdown_tolerance,
    allowed_assets, goals, risk_params, summary_text, confirmed_at,
    exposure_limit_usdc, exposure_limit_pct_bps, goal_target_usdc, goal_target_date,
    allowed_protocols, contribution, risk_tier_display
) VALUES (
    $1, $2, $3, 'confirmed', $4, $5,
    $6, $7, $8, $9,
    $10, $11::jsonb, $12::jsonb, $13, now(),
    $14, $15, $16, $17,
    $18::jsonb, $19::jsonb, $20
)
RETURNING id, version, status, confirmed_at, risk_tier, max_slippage_bps,
          horizon_months, drawdown_tolerance, goals, risk_params, summary_text,
          exposure_limit_usdc, exposure_limit_pct_bps, goal_target_usdc, goal_target_date,
          allowed_protocols, contribution, risk_tier_display
"""

#: Pre-0033 fallback. A 030 agent against an un-migrated database must still be able to SAVE a
#: mandate — losing the four new fields is acceptable, losing the user's whole plan is not.
_INSERT_SQL_PRE_030 = """
INSERT INTO mandates (
    user_id, network_id, version, status, risk_tier, risk_score,
    max_slippage_bps, time_horizon, horizon_months, drawdown_tolerance,
    allowed_assets, goals, risk_params, summary_text, confirmed_at
) VALUES (
    $1, $2, $3, 'confirmed', $4, $5,
    $6, $7, $8, $9,
    $10, $11::jsonb, $12::jsonb, $13, now()
)
RETURNING id, version, status, confirmed_at, risk_tier, max_slippage_bps,
          horizon_months, drawdown_tolerance, goals, risk_params, summary_text
"""

_SELECT_ACTIVE_SQL = """
SELECT m.id, m.version, m.status, m.confirmed_at, m.risk_tier, m.max_slippage_bps,
       m.horizon_months, m.drawdown_tolerance, m.goals, m.risk_params, m.summary_text,
       m.exposure_limit_usdc, m.exposure_limit_pct_bps, m.goal_target_usdc, m.goal_target_date,
       m.allowed_protocols, m.contribution, m.risk_tier_display
FROM mandates m
JOIN users u ON u.id = m.user_id
WHERE u.eoa_address = $1 AND m.network_id = $2 AND m.status = 'confirmed'
ORDER BY m.version DESC
LIMIT 1
"""

_SELECT_ACTIVE_SQL_PRE_030 = """
SELECT m.id, m.version, m.status, m.confirmed_at, m.risk_tier, m.max_slippage_bps,
       m.horizon_months, m.drawdown_tolerance, m.goals, m.risk_params, m.summary_text
FROM mandates m
JOIN users u ON u.id = m.user_id
WHERE u.eoa_address = $1 AND m.network_id = $2 AND m.status = 'confirmed'
ORDER BY m.version DESC
LIMIT 1
"""


@dataclass
class PgMandateStore:
    """The asyncpg-backed :class:`MandateStore` (production). Every write is one atomic
    transaction so the supersede + insert + active-pointer repoint can never half-apply."""

    db: Database

    async def persist(
        self, *, owner_eoa: str, network_id: str, write: MandateWrite
    ) -> MandateRecord:
        """Fork + confirm a new mandate version for ``owner_eoa`` (FR-002/004, VR-M1/M4).

        Upserts the user (by owner EOA), computes the next ``version``, supersedes the
        prior confirmed row, inserts the new confirmed row, and repoints
        ``users.active_mandate_id`` — all in a single transaction.
        """
        # Resolved BEFORE the transaction — see `_has_030_schema`. A failed statement inside a
        # transaction poisons every later statement in it, so this cannot be a try/except.
        async with self.db.acquire() as probe_conn:
            has_030 = await _probe_030_schema(probe_conn)
        async with self.db.acquire() as conn, conn.transaction():
            user_id = await conn.fetchval(
                "INSERT INTO users (eoa_address) VALUES ($1) "
                "ON CONFLICT (eoa_address) DO UPDATE SET updated_at = now() RETURNING id",
                owner_eoa,
            )
            prev_max = await conn.fetchval(
                "SELECT COALESCE(MAX(version), 0) FROM mandates WHERE user_id = $1", user_id
            )
            # Supersede the prior confirmed version BEFORE inserting the new one so the
            # one-confirmed-per-user partial unique index (VR-M1) never trips.
            await conn.execute(
                "UPDATE mandates SET status = 'superseded', updated_at = now() "
                "WHERE user_id = $1 AND status = 'confirmed'",
                user_id,
            )
            base_args = (
                user_id,
                network_id,
                int(prev_max) + 1,
                write.risk_tier,
                write.risk_score,
                write.max_slippage_bps,
                write.time_horizon,
                write.horizon_months,
                write.drawdown_tolerance,
                write.allowed_assets,
                # SQL_ASCII (standing since 025/#125): the dev database's jsonb parser HARD-
                # REJECTS \uXXXX escapes above ASCII, and `json.dumps` escapes by default. A goal
                # label is USER-SUPPLIED text — one curly quote or em-dash and the whole mandate
                # save fails. This was a latent bug before 030; the two new jsonb columns below
                # would have inherited it.
                json.dumps(write.goals, ensure_ascii=False),
                json.dumps(write.risk_params, ensure_ascii=False),
                write.summary_text,
            )
            if has_030:
                row = await conn.fetchrow(
                    _INSERT_SQL,
                    *base_args,
                    write.exposure_limit_usdc,
                    write.exposure_limit_pct_bps,
                    write.goal_target_usdc,
                    write.goal_target_date,
                    None
                    if write.allowed_protocols is None
                    else json.dumps(write.allowed_protocols, ensure_ascii=False),
                    None
                    if write.contribution is None
                    else json.dumps(write.contribution, ensure_ascii=False),
                    write.risk_tier_display,
                )
            else:
                # 0033 not applied. Saving the plan matters more than saving the four new fields
                # (025/0028 lesson: "new agent on old schema" must never cost the user their data).
                row = await conn.fetchrow(_INSERT_SQL_PRE_030, *base_args)
            assert row is not None  # noqa: S101 — INSERT ... RETURNING always yields a row
            await conn.execute(
                "UPDATE users SET active_mandate_id = $1, onboarding_state = 'mandated', "
                "updated_at = now() WHERE id = $2",
                row["id"],
                user_id,
            )
            return row_to_record(row)

    async def get_active(
        self, *, owner_eoa: str, network_id: str
    ) -> MandateRecord | None:
        """The user's active (confirmed, highest-version) mandate, or ``None`` (§3.1)."""
        # Same probe as the write path. This read is NOT in a transaction, so a try/except would
        # work here — but using one mechanism for both keeps the two paths from disagreeing about
        # what the schema supports, and avoids a guaranteed error log on every read.
        async with self.db.acquire() as conn:
            has_030 = await _probe_030_schema(conn)
        sql = _SELECT_ACTIVE_SQL if has_030 else _SELECT_ACTIVE_SQL_PRE_030
        row = await self.db.fetchrow(sql, owner_eoa, network_id)
        return row_to_record(row) if row is not None else None

    async def list_active_owners(
        self, *, network_id: str, limit: int = 100, offset: int = 0
    ) -> list[str]:
        """Distinct EOAs with a confirmed mandate on a network — the wallets the proactive
        new-recommendation poller re-scores (feature 021 ph.2). Newest-mandated first, bounded;
        ``offset`` lets the poller rotate through all wallets across ticks (no starvation past cap).
        The ORDER BY is stable (``latest, eoa_address``) so paging is consistent between calls."""
        rows = await self.db.fetch(
            "SELECT u.eoa_address, MAX(m.confirmed_at) AS latest FROM mandates m"
            " JOIN users u ON u.id = m.user_id"
            " WHERE m.network_id = $1 AND m.status = 'confirmed'"
            " GROUP BY u.eoa_address ORDER BY latest DESC NULLS LAST, u.eoa_address ASC"
            " LIMIT $2 OFFSET $3",
            network_id,
            max(1, min(limit, 500)),
            max(0, offset),
        )
        return [str(r["eoa_address"]) for r in rows]
