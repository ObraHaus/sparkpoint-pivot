"""Per-wallet chat conversation history store (B1).

Persists conversations + ordered turns keyed to the user (by owner EOA, upserted into the shared
``users`` table like mandates). OWNERSHIP is enforced on every read/delete: a caller only ever
touches conversations whose ``user_id`` matches their own EOA — an admin does NOT get others' chats.
Recent turns are fed back (bounded) into ``run_chat`` for multi-turn context. Access/product only —
never custody (N2).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from asyncpg.exceptions import UndefinedColumnError

from .pool import Database

logger = logging.getLogger(__name__)

_UPSERT_USER = (
    "INSERT INTO users (eoa_address) VALUES ($1) "
    "ON CONFLICT (eoa_address) DO UPDATE SET updated_at = now() RETURNING id"
)
_CREATE_CONVO = (
    "INSERT INTO conversations (user_id, title) VALUES ($1, $2) RETURNING id"
)
_OWNS_CONVO = (
    "SELECT 1 FROM conversations c JOIN users u ON u.id = c.user_id "
    "WHERE c.id = $1 AND u.eoa_address = $2"
)
_APPEND_TURN = (
    "INSERT INTO conversation_turns (conversation_id, role, content, blocks) "
    "VALUES ($1, $2, $3, $4)"
)
_TOUCH_CONVO = "UPDATE conversations SET updated_at = now() WHERE id = $1"

# ── pre-0028 fallbacks (see `_MISSING_COLUMN_WARNING` below) ────────────────────
_APPEND_TURN_PRE_0028 = (
    "INSERT INTO conversation_turns (conversation_id, role, content) VALUES ($1, $2, $3)"
)
_GET_TURNS_PRE_0028 = (
    "SELECT role, content, created_at FROM conversation_turns "
    "WHERE conversation_id = $1 ORDER BY id ASC"
)
#: 040 — the same query, now pageable and searchable.
#:
#: ⚠️ THE OWNERSHIP JOIN IS THE WHOLE SECURITY MODEL OF THIS READ. `JOIN users u ON u.id =
#: c.user_id` + `WHERE u.eoa_address = $1` is what stops one wallet seeing another's. The
#: search predicate goes INSIDE that scope and is bound as a parameter, never concatenated: a
#: title search is exactly the shape of change that quietly widens a scope. A test asserts both.
#:
#: `$3` is NULL for "no search"; Postgres short-circuits the OR, so an unfiltered list costs what
#: it always did.
_LIST_CONVOS = (
    "SELECT c.id, c.title, c.created_at, c.updated_at, "
    "(SELECT count(*) FROM conversation_turns t WHERE t.conversation_id = c.id) AS turn_count "
    "FROM conversations c JOIN users u ON u.id = c.user_id "
    "WHERE u.eoa_address = $1 AND ($3::text IS NULL OR c.title ILIKE $3) "
    "ORDER BY c.updated_at DESC LIMIT $2 OFFSET $4"
)

#: How many exist in total, under the SAME ownership and search scope — so "Show 60 older" is a fact
#: rather than an estimate, and a search says how many it actually matched.
_COUNT_CONVOS = (
    "SELECT count(*) FROM conversations c JOIN users u ON u.id = c.user_id "
    "WHERE u.eoa_address = $1 AND ($2::text IS NULL OR c.title ILIKE $2)"
)
_GET_TURNS = (
    "SELECT role, content, blocks, created_at FROM conversation_turns "
    "WHERE conversation_id = $1 ORDER BY id ASC"
)
_RECENT_TURNS = (
    "SELECT role, content FROM conversation_turns "
    "WHERE conversation_id = $1 ORDER BY id DESC LIMIT $2"
)
_DELETE_CONVO = "DELETE FROM conversations WHERE id = $1"
_MAX_TITLE = 80

#: Logged ONCE per process when `conversation_turns.blocks` (migration 0028) is absent, so an
#: agent running ahead of its migration says so loudly instead of failing silently.
_MISSING_COLUMN_WARNING = (
    "conversation_turns_blocks_column_missing: migration 0028 is not applied on this database. "
    "Chat history still works, but structured cards are NOT being persisted and a reopened "
    "conversation replays as text. Apply 0028 and this resolves itself."
)
_warned_missing_column = False


def _warn_missing_blocks_column() -> None:
    global _warned_missing_column
    if not _warned_missing_column:
        _warned_missing_column = True
        logger.warning(_MISSING_COLUMN_WARNING)


def _title_from(message: str) -> str:
    t = " ".join(message.split()).strip()
    return (t[: _MAX_TITLE - 1] + "…") if len(t) > _MAX_TITLE else (t or "New chat")


@dataclass
class ConversationStore:
    """asyncpg-backed store for ``conversations`` + ``conversation_turns``."""

    db: Database

    async def ensure_conversation(
        self, *, owner_eoa: str, conversation_id: str | None, first_message: str
    ) -> UUID:
        """Return the conversation to append to — creating one owned by ``owner_eoa`` if the id is
        missing OR is not owned by this caller (never appends into someone else's thread)."""
        async with self.db.acquire() as conn, conn.transaction():
            user_id = await conn.fetchval(_UPSERT_USER, owner_eoa)
            if conversation_id is not None:
                cid = _as_uuid(conversation_id)
                if cid is not None and await conn.fetchval(_OWNS_CONVO, cid, owner_eoa):
                    return cid
            new_id: UUID = await conn.fetchval(_CREATE_CONVO, user_id, _title_from(first_message))
            return new_id

    async def append_turn(
        self,
        conversation_id: UUID,
        role: str,
        content: str,
        blocks: Sequence[Mapping[str, Any]] | None = None,
    ) -> None:
        """Append one turn + bump the conversation's recency.

        ``content`` is already scrubbed of any card internals by the caller (user message, or a
        compact assistant summary) and remains the classifier-history text. ``blocks`` is the
        assistant turn's ordered §2.7 block wire JSON (025) — the structured cards, so a reopened
        conversation replays them instead of the lossy summary. ``None``/empty writes SQL NULL,
        which is exactly what a user turn and every pre-025 row carry.

        DEPLOY-ORDER SAFE: an agent running AHEAD of migration 0028 has no ``blocks`` column, so
        this degrades to the pre-0028 INSERT — history keeps recording and the cards simply are
        not persisted until the migration lands. Without the fallback the raise is swallowed by
        the fail-open sink in ``api/chat.py`` and history stops being written ENTIRELY, in
        silence. The retry needs a FRESH transaction: the first one is already aborted by the
        failed statement.
        """
        # ``ensure_ascii=False`` is LOAD-BEARING, not style. The shared develop Postgres was
        # created with server_encoding SQL_ASCII, and its JSONB parser hard-rejects any
        # ``\uXXXX`` escape above ASCII (``UntranslatableCharacterError``) — while RAW UTF-8
        # bytes pass through unvalidated, exactly like the ``content`` TEXT column always has.
        # With the default ``ensure_ascii=True``, every block containing an em-dash or a curly
        # quote (i.e. virtually every LLM answer) failed this INSERT, the fail-open sink
        # swallowed it, and chat history silently stopped recording (025 hotfix).
        payload = json.dumps(list(blocks), ensure_ascii=False) if blocks else None
        try:
            async with self.db.acquire() as conn, conn.transaction():
                await conn.execute(_APPEND_TURN, conversation_id, role, content, payload)
                await conn.execute(_TOUCH_CONVO, conversation_id)
        except UndefinedColumnError:
            _warn_missing_blocks_column()
            async with self.db.acquire() as conn, conn.transaction():
                await conn.execute(_APPEND_TURN_PRE_0028, conversation_id, role, content)
                await conn.execute(_TOUCH_CONVO, conversation_id)

    async def recent_history(
        self, conversation_id: UUID, *, limit: int = 8
    ) -> list[tuple[str, str]]:
        """The last ``limit`` (role, content) turns, oldest-first — bounded multi-turn context."""
        rows = await self.db.fetch(_RECENT_TURNS, conversation_id, max(1, min(limit, 40)))
        return [(str(r["role"]), str(r["content"])) for r in reversed(rows)]

    async def list_conversations(
        self,
        owner_eoa: str,
        *,
        limit: int = 50,
        offset: int = 0,
        query: str | None = None,
    ) -> list[dict[str, Any]]:
        """One page of this wallet's conversations, newest activity first.

        `query` matches the TITLE only. Searching message bodies is a different feature with
        different privacy questions; the title is what the sidebar shows and what a person
        remembers.
        """
        rows = await self.db.fetch(
            _LIST_CONVOS,
            owner_eoa,
            max(1, min(limit, 200)),
            _like(query),
            max(0, offset),
        )
        return [
            {
                "id": str(r["id"]),
                "title": (str(r["title"]) if r["title"] else "New chat"),
                "turnCount": int(r["turn_count"]),
                "createdAt": r["created_at"].isoformat(),
                "updatedAt": r["updated_at"].isoformat(),
            }
            for r in rows
        ]

    async def count_conversations(self, owner_eoa: str, *, query: str | None = None) -> int:
        """How many exist under the same scope — what makes "Show 60 older" a fact.

        Fail-soft: a count that cannot be taken returns 0, which renders no control at all. Showing
        an unknown remainder as "Show more" would be the vague version this feature exists to
        replace, and inventing a number would be worse.
        """
        try:
            return int(await self.db.fetchval(_COUNT_CONVOS, owner_eoa, _like(query)) or 0)
        except Exception:  # noqa: BLE001 — a missing count must never cost the list itself
            logger.warning("conversation_count_failed; the sidebar will not offer older pages")
            return 0

    async def get_conversation(self, owner_eoa: str, conversation_id: str) -> dict[str, Any] | None:
        """The conversation + its turns — ONLY if owned by ``owner_eoa`` (else ``None`` → 404)."""
        cid = _as_uuid(conversation_id)
        if cid is None or not await self.db.fetchval(_OWNS_CONVO, cid, owner_eoa):
            return None
        # DEPLOY-ORDER SAFE: without the fallback, an agent running ahead of migration 0028 would
        # raise here — and this read has no exception handling above it, so EVERY conversation
        # open would 500. Degrading to the pre-0028 projection replays turns as text instead.
        try:
            rows = await self.db.fetch(_GET_TURNS, cid)
        except UndefinedColumnError:
            _warn_missing_blocks_column()
            rows = await self.db.fetch(_GET_TURNS_PRE_0028, cid)
        return {"id": str(cid), "turns": [_turn_wire(r) for r in rows]}

    async def delete_conversation(self, owner_eoa: str, conversation_id: str) -> bool:
        """Delete a conversation ONLY if owned by ``owner_eoa``. Returns True iff it was deleted."""
        cid = _as_uuid(conversation_id)
        if cid is None or not await self.db.fetchval(_OWNS_CONVO, cid, owner_eoa):
            return False
        await self.db.execute(_DELETE_CONVO, cid)
        return True


def _as_blocks(raw: Any) -> list[dict[str, Any]]:
    """Decode a ``blocks`` jsonb value into the block list, defensively (025).

    asyncpg hands jsonb back as a ``str`` unless a codec is registered (the same reason
    ``db/recommendations._as_dict`` exists), so tolerate a str, an already-decoded list, or the
    ``NULL`` that every user turn and every pre-025 row carries. Anything unparseable or
    non-list degrades to ``[]`` — the caller then replays that turn as its text summary, exactly
    like a legacy turn. Corrupt history must never break loading a conversation.
    """
    if raw is None:
        return []
    parsed: Any = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return []
    if not isinstance(parsed, list):
        return []
    return [b for b in parsed if isinstance(b, dict)]


def _turn_wire(row: Any) -> dict[str, Any]:
    """One persisted turn on the §B1 wire. ``blocks`` is always present (``[]`` when the turn has
    none) so the client needs no per-element narrowing; an empty list means "replay the text".

    The row may come from the pre-0028 projection (no ``blocks`` key at all) when the agent is
    running ahead of its migration — that reads as ``[]``, identical to a legacy NULL.
    """
    try:
        raw = row["blocks"]
    except (KeyError, IndexError):
        raw = None
    return {
        "role": str(row["role"]),
        "content": str(row["content"]),
        "blocks": _as_blocks(raw),
        "at": row["created_at"].isoformat(),
    }


#: How long a search term may be. A title is short; anything longer is not a search, and an
#: unbounded LIKE pattern is a cheap way to make the database work hard on someone else's behalf.
MAX_QUERY_CHARS = 80


def _like(query: str | None) -> str | None:
    """A search term as a bound ILIKE pattern, or None for "no search".

    `%` and `_` are ESCAPED: a user typing "50%" is looking for the characters "50%", not for
    "anything starting with 50". Left unescaped, one wildcard in a term would quietly match
    everything and the search would look broken in the least explicable way.
    """
    term = (query or "").strip()
    if not term:
        return None
    escaped = term[:MAX_QUERY_CHARS].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def _as_uuid(value: str) -> UUID | None:
    try:
        return UUID(value)
    except (ValueError, AttributeError, TypeError):
        return None
