"""023 — the durable idempotency store (migration ``0026``), FR-023-015/015a.

Replaces a process-local dict that lost every record on restart and could not span workers.
First-write-wins moves from an in-process lock to a database UNIQUE constraint on
``(account, method, path, key)``, which is what makes the guarantee hold ACROSS workers:
``INSERT … ON CONFLICT DO NOTHING`` then re-read is the exact SQL expression of the previous
``dict.setdefault``, so the semantics are preserved rather than reinterpreted.

NON-CUSTODY (N1/N2): no key material, no signature — only a cached 2xx body for an advisory build.
Never on the withdraw/exit path; a failure FAILS OPEN (the caller admits the request).

⚠️ The cost of fail-open, and the reason for the warning below: a MISSING table looks exactly like
a working store at the request level, so an agent deployed BEFORE ``0026`` is applied would run
with no replay protection, no error, and no failing check. Apply ``0026`` first — it is additive, so
the live agent ignores it. This module logs a DISTINCT ``idempotency_table_missing`` warning, once
rather than per request, so the mis-ordered case is observable instead of silent.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from ..api.idempotency import IdempotencyScope, StoredResponse
from .pool import Database

logger = logging.getLogger(__name__)

#: Bundles are short-lived (the IntentBundle TTL is 180s), so a replay window measured in hours is
#: generous while keeping the table small. This is a CACHE, not a ledger: ``audit_logs`` (0001) and
#: ``intent_bundles`` (0021) remain the durable record of what was decided and issued.
RETENTION = timedelta(hours=24)

_SELECT = (
    "SELECT status_code, media_type, body FROM idempotency_records"
    " WHERE account = $1 AND method = $2 AND path = $3 AND key = $4"
)
#: ON CONFLICT DO NOTHING = first-write-wins, enforced across workers by the UNIQUE constraint.
_INSERT = (
    "INSERT INTO idempotency_records (account, method, path, key, status_code, media_type, body)"
    " VALUES ($1, $2, $3, $4, $5, $6, $7)"
    " ON CONFLICT (account, method, path, key) DO NOTHING"
)
_SWEEP = "DELETE FROM idempotency_records WHERE created_at < $1"


class PgIdempotencyStore:
    """Postgres-backed replay cache. Raises on a DB error; the caller
    (``LayeredIdempotencyStore``) is responsible for failing open, which keeps the swallow in ONE
    place rather than scattered through here."""

    def __init__(self, db: Database) -> None:
        self._db = db
        self._warned_missing = False

    def _note_missing_table(self, exc: Exception) -> None:
        """Log the table-missing case ONCE, distinctly from a generic store error (FR-023-015a)."""
        if self._warned_missing:
            return
        text = str(exc).lower()
        if "idempotency_records" in text and (
            "does not exist" in text or "undefined" in text or "relation" in text
        ):
            self._warned_missing = True
            logger.warning(
                "idempotency_table_missing — migration 0026 is NOT applied on this database, so "
                "replay protection is INACTIVE (requests still serve; fail-open, N2). Apply 0026 "
                "and restart."
            )

    async def get(self, scope: IdempotencyScope) -> StoredResponse | None:
        try:
            row = await self._db.fetchrow(
                _SELECT, scope.account, scope.method, scope.path, scope.key
            )
        except Exception as exc:
            self._note_missing_table(exc)
            raise
        if row is None:
            return None
        return StoredResponse(
            status_code=int(row["status_code"]),
            media_type=str(row["media_type"]),
            body=bytes(row["body"]),
        )

    async def put(self, scope: IdempotencyScope, response: StoredResponse) -> None:
        try:
            await self._db.execute(
                _INSERT,
                scope.account,
                scope.method,
                scope.path,
                scope.key,
                response.status_code,
                response.media_type,
                response.body,
            )
        except Exception as exc:
            self._note_missing_table(exc)
            raise

    async def sweep(self, *, now: datetime | None = None) -> int:
        """Delete records past :data:`RETENTION`. Returns the number removed (0 on any error — a
        sweep failure is never worth surfacing; the table is a cache)."""
        cutoff = (now or datetime.now(UTC)) - RETENTION
        try:
            result = await self._db.execute(_SWEEP, cutoff)
        except Exception:
            return 0
        # asyncpg returns a status string like "DELETE 12".
        try:
            return int(str(result).split()[-1])
        except (ValueError, IndexError):
            return 0
