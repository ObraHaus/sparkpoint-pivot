"""Store for edge-triggered notification EVENTS + poller state (migration 0024, feature 021 ph.2).

The background poller (``api/notification_poller.py``) writes one row per genuine change — a vault
"near capacity" crossing, an "Aave rate moved" delta, a proactive "new recommendation" — deduped
by a content ``dedupe_key`` so it never re-notifies. ``notification_poller_state`` holds the
last-seen value per signal so the poller can edge-trigger. ``list_for`` serves the merged feed
(``GET /notifications``).

NON-CUSTODY (N1/N2/N3/N5): advisory only — no key, no signature, no fund authority, never on the
withdraw/exit path (N2). Every write is fail-open at the call site; losing these rows only hides an
alert, never traps funds.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from .pool import Database

_EMIT_SQL = (
    "INSERT INTO notification_events (wallet, category, type, title, body, icon, href, dedupe_key)"
    " VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
    " ON CONFLICT (dedupe_key) DO NOTHING RETURNING id"
)

# Protocol-wide rows (wallet IS NULL) show to everyone; per-user rows only to that wallet.
_LIST_FOR_SQL = (
    "SELECT id, wallet, category, type, title, body, icon, href, created_at"
    " FROM notification_events WHERE wallet IS NULL OR wallet = $1"
    " ORDER BY created_at DESC LIMIT $2"
)

_GET_STATE_SQL = "SELECT num, txt FROM notification_poller_state WHERE key = $1"
_SET_STATE_SQL = (
    "INSERT INTO notification_poller_state (key, num, txt, updated_at) VALUES ($1, $2, $3, now())"
    " ON CONFLICT (key) DO UPDATE SET num = EXCLUDED.num, txt = EXCLUDED.txt, updated_at = now()"
)


@dataclass(frozen=True, slots=True)
class NotificationEventRow:
    """One fetched edge-triggered event (read model)."""

    id: str
    wallet: str | None
    category: str
    type: str
    title: str
    body: str
    icon: str
    href: str | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class PollerState:
    """The last-seen value for one poller signal (edge detection)."""

    num: int | None
    txt: str | None


@dataclass
class NotificationEventStore:
    """asyncpg-backed store over ``notification_events`` + ``notification_poller_state`` (0024)."""

    db: Database

    async def emit(
        self,
        *,
        category: str,
        type: str,  # noqa: A002 — the wire field name is `type`
        title: str,
        body: str,
        dedupe_key: str,
        icon: str = "bell",
        href: str | None = None,
        wallet: str | None = None,
    ) -> bool:
        """Emit an event (idempotent by ``dedupe_key``); return True iff a NEW row was inserted."""
        new_id = await self.db.fetchval(
            _EMIT_SQL, (wallet.lower() if wallet else None), category, type, title, body, icon,
            href, dedupe_key,
        )
        return new_id is not None

    async def list_for(self, wallet: str, *, limit: int = 50) -> list[NotificationEventRow]:
        """The protocol-wide + this-wallet events, newest first (drives the merged feed)."""
        rows = await self.db.fetch(_LIST_FOR_SQL, wallet.lower(), max(1, min(limit, 200)))
        return [
            NotificationEventRow(
                id=str(r["id"]), wallet=(str(r["wallet"]) if r["wallet"] is not None else None),
                category=str(r["category"]), type=str(r["type"]), title=str(r["title"]),
                body=str(r["body"]), icon=str(r["icon"]),
                href=(str(r["href"]) if r["href"] is not None else None),
                created_at=r["created_at"],
            )
            for r in rows
        ]

    async def get_state(self, key: str) -> PollerState | None:
        """The last-seen value for a poller signal, or None if never recorded."""
        row = await self.db.fetchrow(_GET_STATE_SQL, key)
        if row is None:
            return None
        return PollerState(
            num=(int(row["num"]) if row["num"] is not None else None),
            txt=(str(row["txt"]) if row["txt"] is not None else None),
        )

    async def set_state(self, key: str, *, num: int | None = None, txt: str | None = None) -> None:
        """Record the last-seen value for a poller signal (edge detection)."""
        await self.db.execute(_SET_STATE_SQL, key, num, txt)


__all__: Sequence[str] = ("NotificationEventRow", "NotificationEventStore", "PollerState")
