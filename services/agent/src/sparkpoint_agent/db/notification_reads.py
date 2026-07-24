"""Store for the per-user notification READ CURSOR (migration 0023, feature 021 notifications).

The notification FEED is derived live from real data (vault flows / executions / recommendations) —
this store persists ONLY a per-wallet cursor so the unread badge can be computed. The cursor has TWO
parts so unread is STABLE across re-reads: ``last_read_block`` keys the on-chain (flow/outcome)
notifications by block height (an event at block <= the cursor is read; height never changes for an
event, so a re-read can't re-flag it), while ``last_read_at`` keys the execution rows (which
carry a real wall-clock time). ``mark_read`` never regresses the block cursor (``GREATEST``).

NON-CUSTODY (N1/N2/N3/N5): no key, no signature, no fund authority — an advisory read-state cursor
only, never on the withdraw/exit path (N2). A store outage is fail-open (the feed still renders; the
unread count just falls back to "everything shown"), never a hard error.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from .pool import Database

# Upsert forward; GREATEST keeps last_read_block monotonic (a stale head read of 0 can't un-read).
_MARK_READ_SQL = (
    "INSERT INTO notification_reads (wallet, last_read_at, last_read_block, updated_at)"
    " VALUES ($1, $2, $3, now())"
    " ON CONFLICT (wallet) DO UPDATE SET"
    "   last_read_at = EXCLUDED.last_read_at,"
    "   last_read_block = GREATEST(notification_reads.last_read_block, EXCLUDED.last_read_block),"
    "   updated_at = now()"
)

_GET_SQL = "SELECT last_read_at, last_read_block FROM notification_reads WHERE wallet = $1"


@dataclass(frozen=True, slots=True)
class ReadCursor:
    """The read cursor: a wall-clock time (execution rows) + a block height (chain events)."""

    last_read_at: datetime
    last_read_block: int


@dataclass
class NotificationReadStore:
    """asyncpg-backed store over ``notification_reads`` (migration 0023)."""

    db: Database

    async def get(self, wallet: str) -> ReadCursor | None:
        """The wallet's read cursor, or None if it has never opened notifications."""
        row = await self.db.fetchrow(_GET_SQL, wallet.lower())
        if row is None:
            return None
        return ReadCursor(
            last_read_at=row["last_read_at"], last_read_block=int(row["last_read_block"])
        )

    async def mark_read(self, wallet: str, at: datetime, block: int) -> None:
        """Advance the cursor: mark exec rows up to ``at`` + chain events up to ``block`` read."""
        await self.db.execute(_MARK_READ_SQL, wallet.lower(), at, max(0, block))


__all__: Sequence[str] = ("NotificationReadStore", "ReadCursor")
