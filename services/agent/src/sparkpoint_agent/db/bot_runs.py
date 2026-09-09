"""Feature 047 — the testnet activity bots' account of what they did (DISPLAY-ONLY).

The bots run off the deployed stack, holding their own keys, because the agent is **provably
keyless** and that property is load-bearing (N2). The cost of that separation is that the panel
cannot tell, from chain state alone, whether the fleet is healthy-and-idle, stopped, or failing on
every attempt — all three look like a quiet chain.

So the runner reports each run here. Nothing in this module grants authority, decides anything, or
is read on a withdraw/exit path: a row is a claim about the past, and the worst a corrupted or
absent one can do is make an operator view honest-but-uninformative.

⚠️ The health verdict lives in :func:`derive_state`, deliberately as a pure function over the row
plus "now" — so the rule that decides `overdue` is unit-testable without a database, a clock, or a
running bot.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from asyncpg.exceptions import UndefinedTableError

logger = logging.getLogger(__name__)

#: How late a declared `next_run_at` may be before the stream is called overdue. Generous, because
#: a runner that ticks hourly can legitimately drift by a minute or two, and an alarm that cries
#: wolf gets ignored — which is worse than no alarm.
OVERDUE_GRACE = timedelta(minutes=10)

#: With no `next_run_at` to go on, a stream that has not reported in this long is stale. It is the
#: fallback, not the rule: a runner that declares its intent gets judged against its own promise.
SILENT_AFTER = timedelta(hours=6)


@dataclass(frozen=True, slots=True)
class BotRun:
    """One reported run of one bot command on one network."""

    run_key: str
    network_id: str
    command: str
    started_at: datetime
    finished_at: datetime
    ok: bool
    attempted: int
    succeeded: int
    schedule: str | None = None
    next_run_at: datetime | None = None
    runner_commit: str | None = None
    detail: dict[str, Any] | None = None


def derive_state(run: BotRun | None, *, now: datetime) -> str:
    """The one health rule, pure and testable.

    * ``never-run``  — nothing has ever reported for this stream.
    * ``failing``    — the run completed but did no useful work: it either reported failure, or
                       attempted actions and landed none of them. ⚠️ A run that attempts 10 swaps
                       and succeeds at 0 "completed" perfectly well; calling that healthy is how a
                       stopped fleet goes unnoticed for a week.
    * ``overdue``    — the runner said it would be back by ``next_run_at`` and was not (past the
                       grace), or it declared no intent and has been silent past ``SILENT_AFTER``.
    * ``healthy``    — reported recently, and did work.

    ``failing`` outranks ``overdue`` on purpose: a fleet that is running on time and achieving
    nothing is the more urgent of the two, and reporting it as merely "late" would understate it.
    """
    if run is None:
        return "never-run"
    if not run.ok or (run.attempted > 0 and run.succeeded == 0):
        return "failing"
    if run.next_run_at is not None:
        return "overdue" if now > run.next_run_at + OVERDUE_GRACE else "healthy"
    return "overdue" if now - run.finished_at > SILENT_AFTER else "healthy"


class BotRunStore(Protocol):
    """Persistence port (mockable; nothing deterministic ever sees it)."""

    async def record(self, run: BotRun) -> bool: ...
    async def latest_per_stream(self) -> list[BotRun]: ...
    async def recent(self, limit: int = 20) -> list[BotRun]: ...


class PgBotRunStore:
    """Postgres-backed :class:`BotRunStore` (migration 0037).

    Every method degrades to empty/False when the table is absent, so an agent deployed ahead of
    the migration serves an honest ``configured:false`` instead of 500-ing the admin panel.
    """

    def __init__(self, db: Any) -> None:
        self._db = db

    async def record(self, run: BotRun) -> bool:
        """Insert idempotently on ``run_key``; True iff a new row was written."""
        try:
            status = await self._db.execute(
                """
                INSERT INTO bot_runs (
                    run_key, network_id, command, started_at, finished_at, ok,
                    attempted, succeeded, schedule, next_run_at, runner_commit, detail
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CAST($12 AS jsonb))
                ON CONFLICT (run_key) DO NOTHING
                """,
                run.run_key,
                run.network_id,
                run.command,
                run.started_at,
                run.finished_at,
                run.ok,
                run.attempted,
                run.succeeded,
                run.schedule,
                run.next_run_at,
                run.runner_commit,
                # ⚠️ ensure_ascii=False — the develop database is SQL_ASCII and default escaping
                # has corrupted jsonb here before. Same rule as every other writer in this package.
                json.dumps(run.detail or {}, ensure_ascii=False),
            )
            # asyncpg returns the command tag: "INSERT 0 1" wrote, "INSERT 0 0" was a duplicate.
            return str(status).strip().endswith("1")
        except UndefinedTableError:
            logger.warning("bot_runs table absent (migration 0037 unapplied); run not recorded")
            return False

    async def latest_per_stream(self) -> list[BotRun]:
        """The newest run for each (network_id, command) — what the status view is built from."""
        try:
            rows = await self._db.fetch(
                """
                SELECT DISTINCT ON (network_id, command)
                       run_key, network_id, command, started_at, finished_at, ok,
                       attempted, succeeded, schedule, next_run_at, runner_commit, detail
                  FROM bot_runs
                 ORDER BY network_id, command, started_at DESC
                """
            )
        except UndefinedTableError:
            return []
        return [_to_run(r) for r in rows]

    async def recent(self, limit: int = 20) -> list[BotRun]:
        """Most recent runs across every stream, newest first."""
        try:
            rows = await self._db.fetch(
                """
                SELECT run_key, network_id, command, started_at, finished_at, ok,
                       attempted, succeeded, schedule, next_run_at, runner_commit, detail
                  FROM bot_runs
                 ORDER BY started_at DESC
                 LIMIT $1
                """,
                max(1, min(200, limit)),
            )
        except UndefinedTableError:
            return []
        return [_to_run(r) for r in rows]


def _to_run(row: Any) -> BotRun:
    raw = row["detail"]
    detail = json.loads(raw) if isinstance(raw, str) else (raw or {})
    return BotRun(
        run_key=row["run_key"],
        network_id=row["network_id"],
        command=row["command"],
        started_at=_utc(row["started_at"]),
        finished_at=_utc(row["finished_at"]),
        ok=bool(row["ok"]),
        attempted=int(row["attempted"]),
        succeeded=int(row["succeeded"]),
        schedule=row["schedule"],
        next_run_at=_utc(row["next_run_at"]) if row["next_run_at"] else None,
        runner_commit=row["runner_commit"],
        detail=detail,
    )


def _utc(value: datetime) -> datetime:
    """Postgres can hand back a naive datetime; comparing one to an aware `now` raises."""
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)
