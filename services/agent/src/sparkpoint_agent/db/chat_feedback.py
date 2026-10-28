"""Durable thumbs up/down on chat answers (061 A9).

One row per ``(wallet, message)``; a repeat tap (or a replayed request) updates that same row.
Advisory telemetry only — no key, no signature, no prompt, and no reader on any custody path.
Writes are called through the chat API's fail-open sink: a missing migration or DB outage logs a
warning and never fails the feedback request.
"""

from __future__ import annotations

from typing import Any

from .pool import Database

_UPSERT = (
    "INSERT INTO chat_feedback (user_eoa, conversation_id, message_id, rating, reason) "
    "VALUES ($1, $2, $3, $4, $5) "
    "ON CONFLICT (user_eoa, message_id) DO UPDATE SET "
    "conversation_id = EXCLUDED.conversation_id, rating = EXCLUDED.rating, "
    "reason = EXCLUDED.reason, updated_at = now() "
    "RETURNING id, rating, reason"
)


class ChatFeedbackStore:
    """asyncpg-backed store for ``chat_feedback`` (migration 0043)."""

    def __init__(self, db: Database) -> None:
        self.db = db

    async def record(
        self,
        *,
        owner_eoa: str,
        conversation_id: str,
        message_id: str,
        rating: str,
        reason: str | None = None,
    ) -> dict[str, Any]:
        """Upsert one rating; idempotent on ``(owner_eoa, message_id)``."""
        row = await self.db.fetchrow(
            _UPSERT,
            owner_eoa.lower(),
            conversation_id[:200],
            message_id[:200],
            rating,
            (reason or "")[:1000] or None,
        )
        return {
            "id": str(row["id"]) if row else None,
            "rating": str(row["rating"]) if row else rating,
            "reason": row["reason"] if row else None,
        }
