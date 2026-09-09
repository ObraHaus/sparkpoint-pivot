"""Authoritative store for admin-authored Sparky persona OVERRIDES + an append-only audit.

The git-versioned ``persona_seed/*.md`` are the shipped canon of Sparky's character; a row here
overrides one section (slug) live, authored via the admin console. A section with a row uses the
row's markdown; deleting the row reverts it to the seed file. Every mutation writes a
``persona_audit`` row in the SAME transaction (mirrors :mod:`db.knowledge_notes`).

ISOLATION: this is deliberately separate from the RAG corpus (``knowledge_notes`` /
``memory_chunks``). Persona is TRUSTED system-prompt content — never embedded, never
vector-searched, never on the policy/action path (N2, access only, never custody).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .pool import Database

_LIST_SQL = (
    "SELECT source, title, author, git_sha, created_at, updated_at "
    "FROM persona_notes ORDER BY source"
)
_GET_SQL = (
    "SELECT source, title, markdown, author, git_sha, created_at, updated_at "
    "FROM persona_notes WHERE source = $1"
)
_OVERRIDES_SQL = "SELECT source, markdown FROM persona_notes"
_UPSERT_SQL = """
INSERT INTO persona_notes (source, title, markdown, author, git_sha, updated_at)
VALUES ($1, $2, $3, $4, $5, now())
ON CONFLICT (source) DO UPDATE SET
    title = EXCLUDED.title, markdown = EXCLUDED.markdown,
    author = EXCLUDED.author, git_sha = EXCLUDED.git_sha, updated_at = now()
""".strip()
_DELETE_SQL = "DELETE FROM persona_notes WHERE source = $1"
_AUDIT_SQL = "INSERT INTO persona_audit (action, source, actor) VALUES ($1, $2, $3)"
_AUDIT_READ_SQL = "SELECT action, source, actor, at FROM persona_audit ORDER BY at DESC LIMIT $1"


@dataclass
class PersonaNoteStore:
    """asyncpg-backed store for ``persona_notes`` + ``persona_audit``."""

    db: Database

    async def overrides(self) -> dict[str, str]:
        """All admin overrides as ``{slug: markdown}`` — layered over the seed at compose time."""
        rows = await self.db.fetch(_OVERRIDES_SQL)
        return {str(r["source"]): str(r["markdown"]) for r in rows}

    async def list_notes(self) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_LIST_SQL)
        return [
            {
                "source": str(r["source"]),
                "title": str(r["title"]),
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
            "author": (str(r["author"]) if r["author"] else None),
            "git_sha": (str(r["git_sha"]) if r["git_sha"] else None),
            "created_at": r["created_at"].isoformat(),
            "updated_at": r["updated_at"].isoformat(),
        }

    async def put(
        self, *, source: str, title: str, markdown: str, author: str | None,
        git_sha: str | None, audit_action: str = "put",
    ) -> None:
        act = (author or "").lower() or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_UPSERT_SQL, source, title, markdown, act, git_sha)
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
