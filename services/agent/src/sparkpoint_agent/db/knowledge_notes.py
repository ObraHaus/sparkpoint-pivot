"""Authoritative store for admin-console-authored knowledge notes + an append-only audit (R2).

The git-versioned ``knowledge_seed/*.md`` stay the shipped canon; this table is the source of truth
for notes edited via the admin Obsidian console (the container FS is ephemeral; chunks are lossy).
PRECEDENCE: a note with ``origin='admin'`` here wins over a same-slug seed on re-ingest. Every
mutation writes a ``knowledge_audit`` row in the SAME transaction (mirrors :mod:`db.allowlist`).
Access/knowledge only — never custody (N2).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .pool import Database

_LIST_SQL = (
    "SELECT source, title, origin, author, git_sha, created_at, updated_at "
    "FROM knowledge_notes ORDER BY source"
)
_GET_SQL = (
    "SELECT source, title, markdown, origin, author, git_sha, created_at, updated_at "
    "FROM knowledge_notes WHERE source = $1"
)
_ORIGIN_SQL = "SELECT origin FROM knowledge_notes WHERE source = $1"
_ADMIN_SOURCES_SQL = "SELECT source FROM knowledge_notes WHERE origin = 'admin'"
_UPSERT_SQL = """
INSERT INTO knowledge_notes (source, title, markdown, origin, author, git_sha, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, now())
ON CONFLICT (source) DO UPDATE SET
    title = EXCLUDED.title, markdown = EXCLUDED.markdown, origin = EXCLUDED.origin,
    author = EXCLUDED.author, git_sha = EXCLUDED.git_sha, updated_at = now()
""".strip()
_DELETE_SQL = "DELETE FROM knowledge_notes WHERE source = $1"
_AUDIT_SQL = "INSERT INTO knowledge_audit (action, source, actor) VALUES ($1, $2, $3)"
_AUDIT_READ_SQL = "SELECT action, source, actor, at FROM knowledge_audit ORDER BY at DESC LIMIT $1"


@dataclass
class KnowledgeNoteStore:
    """asyncpg-backed store for ``knowledge_notes`` + ``knowledge_audit``."""

    db: Database

    async def list_notes(self) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_LIST_SQL)
        return [
            {
                "source": str(r["source"]),
                "title": str(r["title"]),
                "origin": str(r["origin"]),
                "author": (str(r["author"]) if r["author"] else None),
                "git_sha": (str(r["git_sha"]) if r["git_sha"] else None),
                "created_at": r["created_at"].isoformat(),
                "updated_at": r["updated_at"].isoformat(),
            }
            for r in rows
        ]

    async def get_note(self, source: str) -> dict[str, Any] | None:
        r = await self.db.fetchrow(_GET_SQL, source)
        if r is None:
            return None
        return {
            "source": str(r["source"]),
            "title": str(r["title"]),
            "markdown": str(r["markdown"]),
            "origin": str(r["origin"]),
            "author": (str(r["author"]) if r["author"] else None),
            "git_sha": (str(r["git_sha"]) if r["git_sha"] else None),
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }

    async def admin_owned(self, source: str) -> bool:
        """True iff a same-slug note exists with origin='admin' (a seed must not clobber it)."""
        origin = await self.db.fetchval(_ORIGIN_SQL, source)
        return bool(origin == "admin")

    async def admin_sources(self) -> set[str]:
        """All admin-owned slugs — passed to a seed re-ingest as the skip set (precedence)."""
        rows = await self.db.fetch(_ADMIN_SOURCES_SQL)
        return {str(r["source"]) for r in rows}

    async def put(
        self, *, source: str, title: str, markdown: str, origin: str, author: str | None,
        git_sha: str | None, audit_action: str = "put",
    ) -> None:
        act = (author or "").lower() or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_UPSERT_SQL, source, title, markdown, origin, act, git_sha)
            await conn.execute(_AUDIT_SQL, audit_action, source, act)

    async def delete(self, source: str, *, actor: str | None) -> None:
        act = (actor or "").lower() or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_DELETE_SQL, source)
            await conn.execute(_AUDIT_SQL, "delete", source, act)

    async def record(self, action: str, source: str, actor: str | None) -> None:
        await self.db.execute(_AUDIT_SQL, action, source, (actor or "").lower() or None)

    async def recent_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_AUDIT_READ_SQL, max(1, min(limit, 500)))
        return [
            {
                "action": str(r["action"]),
                "source": str(r["source"]),
                "actor": (str(r["actor"]) if r["actor"] else None),
                "at": r["at"].isoformat(),
            }
            for r in rows
        ]
