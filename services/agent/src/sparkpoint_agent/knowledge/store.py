"""T122/T123 — the pgvector persistence seam for the Obsidian knowledge tier.

The knowledge tier upserts advisory note-chunks into ``memory_chunks`` (the
pgvector RAG store from migration ``0001_foundation.sql``, data-model.md §17) and
reads them back by cosine similarity. All SQL lives behind the :class:`ChunkStore`
Protocol so ingestion/search depend on an *interface*, and both a real
:class:`PgChunkStore` and an in-memory test double satisfy it — no live DB or
embedding API is needed to exercise the tier.

NON-CUSTODY / boundary (T126): this module imports only the stdlib +
``..wire``-free leaf types. It never imports ``policy``/``agents``/``coordinator``
— knowledge is advisory context that must never feed the deterministic decision
path (research.md §7 "Memory never feeds the policy layer").
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable
from uuid import UUID

# The ``memory_source`` enum (migration 0001) has no dedicated "obsidian" member;
# advisory educational notes map to ``literacy_tip`` — the enum value whose intent
# ("advisory tip context") matches the Obsidian tier. Real provenance (note slug,
# section, tags, wikilinks) rides in the ``metadata`` JSONB, so no enum/migration
# change is required.
KNOWLEDGE_SOURCE_KIND = "literacy_tip"


@dataclass(frozen=True)
class ChunkRow:
    """One row destined for ``memory_chunks`` — the upsert shape.

    ``id`` and ``source_id`` are deterministic UUID5s (see ``ingestion``) so a
    re-ingest of the same note updates the same rows in place (idempotent).
    ``user_id`` is always NULL for this tier: the corpus is global/shared, not
    per-user (migration 0001: "null = global/shared corpus").
    """

    id: UUID
    source_id: UUID
    content: str
    embedding: tuple[float, ...]
    embedding_model: str
    metadata: dict[str, Any] = field(default_factory=dict)
    source_kind: str = KNOWLEDGE_SOURCE_KIND


@dataclass(frozen=True)
class ChunkHit:
    """One retrieved chunk: its text, provenance metadata, and cosine score.

    ``score`` is cosine similarity in ``[-1, 1]`` (``1 - cosine_distance``); higher
    is nearer. ``search`` returns hits already ordered nearest-first.
    """

    content: str
    metadata: dict[str, Any]
    score: float


@runtime_checkable
class ChunkStore(Protocol):
    """The persistence seam for the knowledge tier (Postgres in prod, fake in tests)."""

    async def upsert_chunks(self, rows: Sequence[ChunkRow]) -> int:
        """Insert-or-update ``rows`` by primary key; return the number written."""
        ...

    async def prune_source(self, source_id: UUID, keep_ids: Sequence[UUID]) -> int:
        """Delete chunks of ``source_id`` whose id is NOT in ``keep_ids`` (drop stale
        chunks from a prior ingest of the same note); return the number removed."""
        ...

    async def search(self, embedding: Sequence[float], k: int) -> list[ChunkHit]:
        """Return the top-``k`` knowledge chunks nearest ``embedding`` (cosine)."""
        ...


@runtime_checkable
class SqlExecutor(Protocol):
    """The narrow asyncpg surface :class:`PgChunkStore` needs (``db.Database`` satisfies
    it structurally, so knowledge/ need not import the ``db`` package)."""

    async def execute(self, query: str, *args: Any) -> Any: ...

    async def fetch(self, query: str, *args: Any) -> list[Any]: ...


def to_vector_literal(embedding: Sequence[float]) -> str:
    """Format a vector as a pgvector text literal (``[0.1,0.2,...]``) for ``$n::vector``."""
    return "[" + ",".join(repr(float(x)) for x in embedding) + "]"


# The upsert shape — INSERT ... ON CONFLICT (id) DO UPDATE keyed on the deterministic
# primary key, so a re-ingest overwrites in place rather than duplicating.
_UPSERT_SQL = """
INSERT INTO memory_chunks
    (id, user_id, source_kind, source_id, content, embedding, embedding_model, metadata)
VALUES ($1, NULL, $2::memory_source, $3, $4, $5::vector, $6, $7::jsonb)
ON CONFLICT (id) DO UPDATE SET
    content         = EXCLUDED.content,
    embedding       = EXCLUDED.embedding,
    embedding_model = EXCLUDED.embedding_model,
    metadata        = EXCLUDED.metadata,
    source_kind     = EXCLUDED.source_kind,
    source_id       = EXCLUDED.source_id
""".strip()

_PRUNE_SQL = """
DELETE FROM memory_chunks
WHERE source_id = $1 AND source_kind = $2::memory_source AND id <> ALL($3::uuid[])
""".strip()

# Cosine search: ``<=>`` is pgvector cosine DISTANCE; ``1 - distance`` is similarity.
# Order by distance ascending (nearest first). Scoped to the knowledge source_kind so
# operational-memory chunks never leak into an advisory citation.
_SEARCH_SQL = """
SELECT content,
       metadata,
       1 - (embedding <=> $1::vector) AS score
FROM memory_chunks
WHERE source_kind = $2::memory_source
ORDER BY embedding <=> $1::vector
LIMIT $3
""".strip()


class PgChunkStore:
    """A :class:`ChunkStore` backed by ``memory_chunks`` via an asyncpg executor.

    Parameterized throughout (asyncpg binds server-side; no string interpolation of
    content). Holds no custody logic — this tier is a derived index only (N2).
    """

    def __init__(self, db: SqlExecutor, *, source_kind: str = KNOWLEDGE_SOURCE_KIND) -> None:
        self._db = db
        self._source_kind = source_kind

    async def upsert_chunks(self, rows: Sequence[ChunkRow]) -> int:
        written = 0
        for row in rows:
            await self._db.execute(
                _UPSERT_SQL,
                row.id,
                row.source_kind,
                row.source_id,
                row.content,
                to_vector_literal(row.embedding),
                row.embedding_model,
                json.dumps(row.metadata, sort_keys=True),
            )
            written += 1
        return written

    async def prune_source(self, source_id: UUID, keep_ids: Sequence[UUID]) -> int:
        status = await self._db.execute(
            _PRUNE_SQL, source_id, self._source_kind, list(keep_ids)
        )
        return _rows_affected(status)

    async def search(self, embedding: Sequence[float], k: int) -> list[ChunkHit]:
        if k <= 0:
            return []
        records = await self._db.fetch(
            _SEARCH_SQL, to_vector_literal(embedding), self._source_kind, k
        )
        return [
            ChunkHit(
                content=str(rec["content"]),
                metadata=_as_dict(rec["metadata"]),
                score=float(rec["score"]),
            )
            for rec in records
        ]


def _as_dict(value: Any) -> dict[str, Any]:
    """asyncpg returns JSONB as text by default; accept either a str or a dict."""
    if isinstance(value, str):
        parsed: Any = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    if isinstance(value, dict):
        return dict(value)
    return {}


def _rows_affected(status: Any) -> int:
    """Parse asyncpg's ``DELETE <n>`` command tag into an int (0 if unparseable)."""
    if not isinstance(status, str):
        return 0
    parts = status.split()
    if not parts:
        return 0
    try:
        return int(parts[-1])
    except ValueError:
        return 0
