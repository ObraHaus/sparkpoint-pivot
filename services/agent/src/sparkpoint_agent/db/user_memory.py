"""Cross-conversation user memory store — the persistence half of feature 027 (migration 0030).

One row per user (``user_memory.lines`` jsonb, newest LAST, hard-capped at
:data:`~sparkpoint_agent.memory.MAX_MEMORY_LINES`), so a BRAND-NEW conversation can still tell the
model what Sparky and this user have done together. The lines themselves are derived
deterministically in :mod:`sparkpoint_agent.memory` from the blocks a turn already streamed — this
module only folds, caps, and stores them.

OWNERSHIP is total: every method is keyed by the caller's own ``owner_eoa`` (the SIWE-verified
wallet the BFF injects), and there is deliberately NO admin read path — an operator does not get to
browse what the assistant remembers about a user. The user inspects it (``GET /memory/self``) and
erases it (``POST /memory/clear``).

FAIL-OPEN, INCLUDING AGAINST ITS OWN MIGRATION. Every method swallows database errors and degrades
to "no memory": a missing table (an agent deployed ahead of 0030), an unreachable database, or a
brand-new user are all indistinguishable to callers and all behave exactly as the pre-027 code did.
A missing table additionally logs ``user_memory_table_missing`` ONCE per process, so a systematic
"nobody is ever remembered" failure is visible in the logs instead of looking like an idle app —
the lesson from the 025 hotfix, where a fail-open sink hid a 100%-reproducible write failure.

NON-CUSTODY (N1/N2/N3): no key material, no signature, no amount, no address — short human-readable
strings only, advisory context for NL understanding and prose, never on the withdraw/exit path (N2).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from asyncpg.exceptions import UndefinedTableError

from ..memory import MAX_MEMORY_LINES, MemoryEntry, UserMemory
from .pool import Database

logger = logging.getLogger(__name__)

_UPSERT_USER = (
    "INSERT INTO users (eoa_address) VALUES ($1) "
    "ON CONFLICT (eoa_address) DO UPDATE SET updated_at = now() RETURNING id"
)
#: Row lock for the read-modify-write fold. A no-op when the row does not exist yet — see the
#: concurrency note on :meth:`MemoryStore.append`.
_SELECT_FOR_UPDATE = "SELECT lines FROM user_memory WHERE user_id = $1 FOR UPDATE"
_UPSERT_MEMORY = (
    "INSERT INTO user_memory (user_id, lines, updated_at) VALUES ($1, $2, now()) "
    "ON CONFLICT (user_id) DO UPDATE SET lines = EXCLUDED.lines, updated_at = now()"
)
#: Reads join through ``users`` so the caller's wallet is the only key (``eoa_address`` is CITEXT,
#: so the comparison is case-insensitive without normalising here).
_GET_MEMORY = (
    "SELECT m.lines, m.updated_at FROM user_memory m JOIN users u ON u.id = m.user_id "
    "WHERE u.eoa_address = $1"
)
#: Clear does NOT upsert the user — erasing memory for a wallet that has none must not create a row.
_CLEAR_MEMORY = (
    "DELETE FROM user_memory WHERE user_id = (SELECT id FROM users WHERE eoa_address = $1)"
)

#: Logged ONCE per process when ``user_memory`` (migration 0030) is absent.
_MISSING_TABLE_WARNING = (
    "user_memory_table_missing: migration 0030 is not applied on this database. Chat works "
    "normally, but NOTHING is being remembered across conversations and GET /memory/self is "
    "always empty. Apply 0030 and this resolves itself."
)
_warned_missing_table = False


def _warn_missing_table() -> None:
    global _warned_missing_table
    if not _warned_missing_table:
        _warned_missing_table = True
        logger.warning(_MISSING_TABLE_WARNING)


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _decode_entries(raw: Any) -> tuple[MemoryEntry, ...]:
    """Decode a ``lines`` jsonb value defensively.

    asyncpg hands jsonb back as a ``str`` unless a codec is registered (the same reason
    ``db/conversations._as_blocks`` exists), so tolerate a str, an already-decoded list, or NULL.
    Anything unparseable, non-list, or shaped wrong degrades to ``()`` — a corrupt digest must
    cost context, never break a chat turn or a settings page.
    """
    if raw is None:
        return ()
    parsed: Any = raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return ()
    if not isinstance(parsed, list):
        return ()
    entries: list[MemoryEntry] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        line = item.get("line")
        if not isinstance(line, str) or not line.strip():
            continue
        at = item.get("at")
        entries.append(MemoryEntry(at=at if isinstance(at, str) else "", line=line))
    return tuple(entries)


@dataclass
class MemoryStore:
    """asyncpg-backed store for ``user_memory`` (migration 0030). Fail-open on every path."""

    db: Database
    #: Injected so tests get deterministic timestamps; production reads the wall clock.
    now: Callable[[], datetime] = field(default=_utc_now)

    async def get(self, owner_eoa: str) -> UserMemory:
        """This wallet's digest, oldest entry first. Empty on a missing row, a missing table
        (pre-0030), or any database failure — the fail-open default every caller is built for."""
        try:
            row = await self.db.fetchrow(_GET_MEMORY, owner_eoa)
        except UndefinedTableError:
            _warn_missing_table()
            return UserMemory()
        except Exception:
            return UserMemory()
        if row is None:
            return UserMemory()
        updated = row["updated_at"]
        return UserMemory(
            entries=_decode_entries(row["lines"]),
            updated_at=updated.isoformat() if updated is not None else None,
        )

    async def append(self, owner_eoa: str, lines: Sequence[str]) -> None:
        """Fold ``lines`` onto this wallet's digest, cap it, and upsert — one transaction.

        Newest go LAST; anything over :data:`MAX_MEMORY_LINES` drops off the FRONT, so the row is
        bounded by construction rather than by a sweep. A line identical to the immediately
        preceding one is skipped, so asking the same question twice in a row does not consume two
        of the forty slots.

        RAISES on failure — deliberately. The caller (``api/chat.py``'s memory sink) owns the
        fail-open decision and the once-per-process warning, exactly like the conversation sink, so
        that a systematic write failure is logged once instead of silently swallowed here.

        CONCURRENCY: the fold takes a row lock, so two turns racing on an EXISTING digest serialize.
        Two turns racing on the very FIRST write (no row to lock yet) can have one clobber the
        other's lines — advisory context, so the cost is one forgotten line, never a broken turn or
        a lost transaction. Not worth an advisory lock on the chat path.
        """
        fresh = [line for line in (str(x).strip() for x in lines) if line]
        if not fresh:
            return
        stamp = self.now().isoformat()
        async with self.db.acquire() as conn, conn.transaction():
            user_id = await conn.fetchval(_UPSERT_USER, owner_eoa)
            current = list(_decode_entries(await conn.fetchval(_SELECT_FOR_UPDATE, user_id)))
            for line in fresh:
                if current and current[-1].line == line:
                    continue
                current.append(MemoryEntry(at=stamp, line=line))
            capped = current[-MAX_MEMORY_LINES:]
            # ``ensure_ascii=False`` is LOAD-BEARING, not style. The shared develop Postgres was
            # created with server_encoding SQL_ASCII, whose JSONB parser hard-rejects any
            # ``\uXXXX`` escape above ASCII (``UntranslatableCharacterError``) while RAW UTF-8
            # bytes pass through unvalidated. Memory lines quote the user's own words, so an
            # em-dash or curly quote is routine — with default escaping this INSERT would fail on
            # most turns and the fail-open sink would drop every one, which is exactly how the 025
            # card-persistence bug reached production (hotfix #125).
            payload = json.dumps([e.to_wire() for e in capped], ensure_ascii=False)
            await conn.execute(_UPSERT_MEMORY, user_id, payload)

    async def clear(self, owner_eoa: str) -> None:
        """Erase this wallet's whole digest (the user's own "Clear memory"). Idempotent: clearing
        a wallet that has no memory is a successful no-op. RAISES on failure so the endpoint can
        tell the user honestly that it did not work — unlike the write path, this one is a direct,
        user-initiated action and must never claim success it did not achieve."""
        try:
            await self.db.execute(_CLEAR_MEMORY, owner_eoa)
        except UndefinedTableError:
            # Pre-0030: there is provably nothing stored, so "cleared" is the truth.
            _warn_missing_table()
