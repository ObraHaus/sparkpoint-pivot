"""Authoritative store for admin-authored content: the live changelog + the announcement (Alpha).

One table (``content_entries``) with a ``type`` discriminator serves both surfaces — type
``'changelog'`` rows are the What's-New feed, and the newest active ``'announcement'`` row is the
sidebar banner. Reads for the changelog feed + active announcement are public (any beta wallet);
writes are admin-gated at the API layer. Every mutation writes a ``content_audit`` row in the SAME
transaction (mirrors :mod:`db.knowledge_notes`). ACCESS/content only — never custody (N2).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from .pool import Database


def _parse_ts(value: str | None) -> datetime | None:
    """Parse an ISO date/datetime backdating string into a tz-aware datetime (UTC), or ``None``.

    Passing a real ``datetime`` (not a str) lets asyncpg bind it directly to ``timestamptz`` — a
    ``$n::timestamptz`` cast on a str parameter confuses asyncpg's type inference. Assumed already
    validated by the API layer; a bad value raises ``ValueError`` (caller has validated)."""
    if value is None or not value.strip():
        return None
    dt = datetime.fromisoformat(value.strip())
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)

# Full column lists spelled out in each query (no f-string interpolation — keeps the SQL static so
# ruff's S608 never fires; matches db/knowledge_notes.py style).
_CHANGELOG_SQL = (
    "SELECT id, type, title, body, tag, cta_label, cta_href, is_active, published_at, updated_at "
    "FROM content_entries "
    # ``id DESC`` is a STABLE tiebreak (id = bigserial = insertion order). Same-day entries share a
    # ``published_at`` (a date-only value ties a whole day at midnight), so the tiebreak makes the
    # newest-added lead within a date; without it a fresh entry lands mid-list, not on top.
    "WHERE type = 'changelog' AND is_active = true ORDER BY published_at DESC, id DESC LIMIT $1"
)
_ANNOUNCEMENT_SQL = (
    "SELECT id, type, title, body, tag, cta_label, cta_href, is_active, published_at, updated_at "
    "FROM content_entries "
    "WHERE type = 'announcement' AND is_active = true ORDER BY published_at DESC, id DESC LIMIT 1"
)
_LIST_SQL = (
    "SELECT id, type, title, body, tag, cta_label, cta_href, is_active, published_at, updated_at, "
    "author FROM content_entries ORDER BY published_at DESC, id DESC LIMIT $1"
)
_GET_SQL = (
    "SELECT id, type, title, body, tag, cta_label, cta_href, is_active, published_at, updated_at, "
    "author FROM content_entries WHERE id = $1"
)
_INSERT_SQL = (
    "INSERT INTO content_entries "
    "(type, title, body, tag, cta_label, cta_href, is_active, author, published_at) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, COALESCE($9, now())) RETURNING id"
)
_UPDATE_SQL = (
    "UPDATE content_entries SET type = $2, title = $3, body = $4, tag = $5, cta_label = $6, "
    "cta_href = $7, is_active = $8, published_at = COALESCE($9, published_at), "
    # Feature 006: stamp the editing admin as author so a hand-edited seed row flips OFF 'seed';
    # upsert_seed then skips it, so the operator's live edit wins over the repo re-seed on redeploy.
    "author = COALESCE($10, author), updated_at = now() WHERE id = $1"
)
_DELETE_SQL = "DELETE FROM content_entries WHERE id = $1"
_AUDIT_SQL = (
    "INSERT INTO content_audit (action, subject, actor, detail) VALUES ($1, $2, $3, $4::jsonb)"
)
_AUDIT_READ_SQL = (
    "SELECT action, subject, actor, detail, at FROM content_audit ORDER BY at DESC LIMIT $1"
)

# Feature 006 — repo-file changelog seed (content_seed/whats-new.json). Upsert by `slug` so one repo
# edit feeds the in-app changelog idempotently; a same-title legacy row (slug NULL) is adopted
# rather than duplicated, and an operator's live edit (author set, != 'seed') is never overwritten.
_FIND_BY_SLUG_SQL = "SELECT id, author FROM content_entries WHERE slug = $1"
_FIND_LEGACY_SQL = (
    "SELECT id, author FROM content_entries "
    "WHERE type = $1 AND slug IS NULL AND title = $2 ORDER BY id LIMIT 1"
)
_INSERT_SEED_SQL = (
    "INSERT INTO content_entries "
    "(slug, type, title, body, tag, cta_label, cta_href, is_active, author, published_at) "
    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'seed', COALESCE($9, now())) RETURNING id"
)
_UPDATE_SEED_SQL = (
    "UPDATE content_entries SET slug = $2, type = $3, title = $4, body = $5, tag = $6, "
    "cta_label = $7, cta_href = $8, is_active = $9, "
    "published_at = COALESCE($10, published_at), author = 'seed', updated_at = now() WHERE id = $1"
)
_ADOPT_SLUG_SQL = "UPDATE content_entries SET slug = $2, updated_at = now() WHERE id = $1"


@dataclass
class ContentEntryStore:
    """asyncpg-backed store for ``content_entries`` + append-only ``content_audit``."""

    db: Database

    async def list_changelog(self, limit: int = 50) -> list[dict[str, Any]]:
        """Active changelog entries, newest first (the public What's-New feed)."""
        rows = await self.db.fetch(_CHANGELOG_SQL, max(1, min(limit, 200)))
        return [_row(r) for r in rows]

    async def active_announcement(self) -> dict[str, Any] | None:
        """The single newest active announcement, or ``None`` (the sidebar banner)."""
        r = await self.db.fetchrow(_ANNOUNCEMENT_SQL)
        return _row(r) if r is not None else None

    async def list_all(self, limit: int = 200) -> list[dict[str, Any]]:
        """Every entry (both types, active or not) for the admin editor, newest first."""
        rows = await self.db.fetch(_LIST_SQL, max(1, min(limit, 500)))
        return [_row(r, with_author=True) for r in rows]

    async def get(self, entry_id: int) -> dict[str, Any] | None:
        r = await self.db.fetchrow(_GET_SQL, entry_id)
        return _row(r, with_author=True) if r is not None else None

    async def create(
        self,
        *,
        type_: str,
        title: str,
        body: str,
        tag: str | None,
        cta_label: str | None,
        cta_href: str | None,
        is_active: bool,
        actor: str | None,
        published_at: str | None = None,
    ) -> int:
        """Insert one entry + a ``create`` audit row in the SAME transaction; return the new id.

        ``published_at`` (ISO date/datetime) lets an admin backdate an entry so the changelog reads
        as a real timeline; ``None`` defaults to now()."""
        act = (actor or "").lower() or None
        async with self.db.acquire() as conn, conn.transaction():
            new_id = await conn.fetchval(
                _INSERT_SQL, type_, title, body, tag, cta_label, cta_href, is_active, act,
                _parse_ts(published_at),
            )
            await conn.execute(_AUDIT_SQL, "create", str(new_id), act, json.dumps(
                {"type": type_},
                ensure_ascii=False),
            )
        return int(new_id)

    async def update(
        self,
        entry_id: int,
        *,
        type_: str,
        title: str,
        body: str,
        tag: str | None,
        cta_label: str | None,
        cta_href: str | None,
        is_active: bool,
        actor: str | None,
        published_at: str | None = None,
    ) -> None:
        """Update one entry + an ``update`` audit row in the SAME transaction.

        ``published_at`` (ISO) re-dates the entry if provided; ``None`` keeps the current date."""
        act = (actor or "").lower() or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(
                _UPDATE_SQL, entry_id, type_, title, body, tag, cta_label, cta_href, is_active,
                _parse_ts(published_at), act,
            )
            await conn.execute(
                _AUDIT_SQL, "update", str(entry_id), act, json.dumps(
                    {"type": type_},
                    ensure_ascii=False,
                )
            )

    async def delete(self, entry_id: int, *, actor: str | None) -> None:
        """Delete one entry + a ``delete`` audit row in the SAME transaction."""
        act = (actor or "").lower() or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_DELETE_SQL, entry_id)
            await conn.execute(_AUDIT_SQL, "delete", str(entry_id), act, json.dumps(
                {},
                ensure_ascii=False),
            )

    async def upsert_seed(
        self,
        *,
        slug: str,
        type_: str,
        title: str,
        body: str,
        tag: str | None,
        cta_label: str | None,
        cta_href: str | None,
        is_active: bool,
        published_at: str | None = None,
    ) -> str:
        """Idempotently upsert a repo-seeded (feature 006) entry keyed by ``slug``.

        Returns ``'inserted'`` | ``'updated'`` | ``'adopted'`` | ``'skipped'``. Never overwrites an
        operator's live edit (a row whose ``author`` is set and not ``'seed'``): a matching slug is
        skipped; a same-title legacy row (slug NULL) has only its slug adopted. Content only."""
        pub = _parse_ts(published_at)
        async with self.db.acquire() as conn, conn.transaction():
            existing = await conn.fetchrow(_FIND_BY_SLUG_SQL, slug)
            if existing is not None:
                if existing["author"] not in (None, "seed"):
                    return "skipped"  # operator owns this slug — their edit wins
                await conn.execute(
                    _UPDATE_SEED_SQL, existing["id"], slug, type_, title, body, tag,
                    cta_label, cta_href, is_active, pub,
                )
                await conn.execute(
                    _AUDIT_SQL, "update", str(existing["id"]), "seed",
                    json.dumps({"slug": slug, "src": "whats-new"}, ensure_ascii=False),
                )
                return "updated"
            legacy = await conn.fetchrow(_FIND_LEGACY_SQL, type_, title)
            if legacy is not None:
                if legacy["author"] not in (None, "seed"):
                    # operator-authored legacy row with the same title — adopt the slug only.
                    await conn.execute(_ADOPT_SLUG_SQL, legacy["id"], slug)
                    return "adopted"
                await conn.execute(
                    _UPDATE_SEED_SQL, legacy["id"], slug, type_, title, body, tag,
                    cta_label, cta_href, is_active, pub,
                )
                await conn.execute(
                    _AUDIT_SQL, "update", str(legacy["id"]), "seed",
                    json.dumps(
                        {"slug": slug, "src": "whats-new", "adopted": True},
                        ensure_ascii=False,
                    ),
                )
                return "adopted"
            new_id = await conn.fetchval(
                _INSERT_SEED_SQL, slug, type_, title, body, tag, cta_label, cta_href,
                is_active, pub,
            )
            await conn.execute(
                _AUDIT_SQL, "create", str(new_id), "seed",
                json.dumps({"slug": slug, "src": "whats-new"}, ensure_ascii=False),
            )
            return "inserted"

    async def recent_audit(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_AUDIT_READ_SQL, max(1, min(limit, 500)))
        return [
            {
                "action": str(r["action"]),
                "subject": str(r["subject"]),
                "actor": (str(r["actor"]) if r["actor"] else None),
                "detail": _as_detail(r["detail"]),
                "at": r["at"].isoformat(),
            }
            for r in rows
        ]


def _row(r: Any, *, with_author: bool = False) -> dict[str, Any]:
    """Normalise a ``content_entries`` row into the JSON shape the web hooks consume (camelCase)."""
    out: dict[str, Any] = {
        "id": int(r["id"]),
        "type": str(r["type"]),
        "title": str(r["title"]),
        "body": str(r["body"]),
        "tag": (str(r["tag"]) if r["tag"] else None),
        "ctaLabel": (str(r["cta_label"]) if r["cta_label"] else None),
        "ctaHref": (str(r["cta_href"]) if r["cta_href"] else None),
        "isActive": bool(r["is_active"]),
        "publishedAt": r["published_at"].isoformat(),
        "updatedAt": r["updated_at"].isoformat(),
    }
    if with_author:
        out["author"] = str(r["author"]) if r["author"] else None
    return out


def _as_detail(raw: Any) -> dict[str, Any]:
    """asyncpg may hand back JSONB as a dict or a JSON string — normalise to a dict either way."""
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else {}
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}
