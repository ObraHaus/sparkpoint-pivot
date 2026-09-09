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
import logging
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable
from uuid import UUID

from asyncpg.exceptions import InvalidTextRepresentationError

# The dedicated ``memory_source`` member for the Obsidian knowledge corpus. Migration 0006 adds
# ``'knowledge'`` and 0007 backfills the prior ``'literacy_tip'`` shim rows to it (T123). Real
# provenance (note slug, section, tags, wikilinks, git sha) rides in the ``metadata`` JSONB.
KNOWLEDGE_SOURCE_KIND = "knowledge"

#: 031 — every source kind an ADVISORY answer may draw on.
#:
#: Retrieval used to be scoped to `knowledge` alone, so two bodies of writing the team publishes
#: were invisible to the assistant: the in-app changelog (which is why "what shipped this week?"
#: could only point at a page) and the tip databank. Indexing them is the point — every future
#: release then teaches the assistant with no separate step to forget.
#:
#: ⚠️ PERSONA IS DELIBERATELY ABSENT and must stay absent. It has no source kind, no embedding and
#: no chunks: it is trusted SYSTEM instruction text, not retrievable content. Adding it here would
#: let it be quoted back and cited — a trust-boundary break, not a feature.
#:
#: Operational memory (`memory_chunks` rows with a `user_id`) is excluded structurally, not by this
#: list: every search also requires `user_id IS NULL`.
RETRIEVABLE_SOURCE_KINDS: tuple[str, ...] = ("knowledge", "changelog", "tip", "self_authored")

#: The kinds that exist before migration 0034. Used only as the degraded fallback.
_PRE_031_KINDS: tuple[str, ...] = ("knowledge", "tip")

_logger = logging.getLogger(__name__)
_warned_pre_031 = False


def _warn_pre_031_enum() -> None:
    """Warn once that 0034 is unapplied, then keep serving with the kinds that exist."""
    global _warned_pre_031
    if not _warned_pre_031:
        _warned_pre_031 = True
        _logger.warning(
            "knowledge_pre_031_enum: migration 0034 is not applied, so published updates and "
            "self-authored notes are not searchable yet. Retrieval continues over the existing "
            "kinds. Logged once per process."
        )

# The dedicated ``memory_source`` member for the sidebar TIP databank (migration 0012). Kept
# SEPARATE from ``'knowledge'`` so a curated UI tip can NEVER surface in an assistant RAG citation
# (the advisory ``_SEARCH_SQL`` is scoped to ``'knowledge'``). Tips are read WITHOUT an embedding
# via :meth:`PgChunkStore.list_tips`, so the widget never spends an embed/LLM call.
TIP_SOURCE_KIND = "tip"


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
    #: 031 — which body of writing this came from ("knowledge" | "changelog" | "tip" |
    #: "self_authored"). Carried through to the citation so a reader can tell documentation a
    #: person wrote from a note the assistant wrote about itself. Defaults to the pre-031 value so
    #: every existing construction stays valid.
    source_kind: str = "knowledge"


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
# Order by distance ascending (nearest first).
#
# 031 — searches a SET of kinds rather than one, so published updates and tips reach an answer.
# `user_id IS NULL` is the structural guarantee that operational memory can never leak into an
# advisory citation, and it is unchanged: it does not depend on which kinds are listed.
_SEARCH_SQL = """
SELECT content,
       metadata,
       source_kind::text AS source_kind,
       1 - (embedding <=> $1::vector) AS score
FROM memory_chunks
WHERE source_kind = ANY($2::memory_source[])
  AND user_id IS NULL
ORDER BY embedding <=> $1::vector
LIMIT $3
""".strip()

# Admin console reads: one row per source (note), with provenance + chunk count.
_LIST_SOURCES_SQL = """
SELECT metadata->>'source'      AS source,
       max(metadata->>'title')  AS title,
       count(*)                 AS chunk_count,
       max(metadata->>'git_sha')     AS git_sha,
       max(metadata->>'ingested_at') AS ingested_at
FROM memory_chunks
WHERE source_kind = $1::memory_source AND user_id IS NULL
GROUP BY metadata->>'source'
ORDER BY 1
""".strip()

_SOURCE_CHUNKS_SQL = """
SELECT content, metadata
FROM memory_chunks
WHERE source_kind = $1::memory_source AND user_id IS NULL AND metadata->>'source' = $2
ORDER BY (metadata->>'chunk_index')::int
""".strip()

# Keyless tip read for the sidebar widget: random ACTIVE tips, no embedding. A tip is active unless
# its metadata explicitly says ``active: 'false'`` (absent ⇒ active). Never touches _SEARCH_SQL.
_LIST_TIPS_SQL = """
SELECT content, metadata
FROM memory_chunks
WHERE source_kind = $1::memory_source
  AND user_id IS NULL
  AND coalesce(metadata->>'active', 'true') <> 'false'
ORDER BY random()
LIMIT $2
""".strip()

# Admin tip manager: ONE row per tip source (its lead chunk, index 0), active or not, ordered by
# source. Reconstructs the editable tip (title/body/cta/active) from the chunk + metadata.
_LIST_ALL_TIPS_SQL = """
SELECT DISTINCT ON (metadata->>'source')
       metadata->>'source' AS source, content, metadata
FROM memory_chunks
WHERE source_kind = $1::memory_source AND user_id IS NULL
ORDER BY metadata->>'source', (metadata->>'chunk_index')::int
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
                # SQL_ASCII (standing since 025/#125): this database's jsonb parser HARD-REJECTS
                # \uXXXX escapes above ASCII, and `json.dumps` escapes by default. Chunk metadata
                # carries the note TITLE — so any document whose title contains an em-dash or a
                # curly quote failed to index, silently. Found while indexing the changelog: the
                # entries that failed were precisely the well-written ones.
                json.dumps(row.metadata, sort_keys=True, ensure_ascii=False),
            )
            written += 1
        return written

    async def prune_source(self, source_id: UUID, keep_ids: Sequence[UUID]) -> int:
        status = await self._db.execute(
            _PRUNE_SQL, source_id, self._source_kind, list(keep_ids)
        )
        return _rows_affected(status)

    async def search(self, embedding: Sequence[float], k: int) -> list[ChunkHit]:
        """Nearest chunks across every RETRIEVABLE kind (031), not just this store's own kind.

        A store is constructed for one kind because that is what it WRITES; what an advisory answer
        may READ is a wider, separate question. Conflating the two is what kept published updates
        and tips out of every answer.

        Degrades honestly on an un-migrated database: the new enum values do not exist yet, the
        cast raises, and the search falls back to the kinds that do exist. Retrieval then behaves
        exactly as it did before 031 rather than failing.
        """
        if k <= 0:
            return []
        try:
            records = await self._db.fetch(
                _SEARCH_SQL, to_vector_literal(embedding), list(RETRIEVABLE_SOURCE_KINDS), k
            )
        except InvalidTextRepresentationError:
            _warn_pre_031_enum()
            records = await self._db.fetch(
                _SEARCH_SQL, to_vector_literal(embedding), list(_PRE_031_KINDS), k
            )
        return [
            ChunkHit(
                content=str(rec["content"]),
                metadata=_as_dict(rec["metadata"]),
                score=float(rec["score"]),
                source_kind=str(rec["source_kind"]) if "source_kind" in rec else "knowledge",
            )
            for rec in records
        ]

    async def list_sources(self) -> list[dict[str, Any]]:
        """One summary row per ingested note (source, title, chunk_count, git_sha, ingested_at)."""
        records = await self._db.fetch(_LIST_SOURCES_SQL, self._source_kind)
        return [
            {
                "source": str(rec["source"]),
                "title": str(rec["title"] or rec["source"]),
                "chunk_count": int(rec["chunk_count"]),
                "git_sha": (str(rec["git_sha"]) if rec["git_sha"] else None),
                "ingested_at": (str(rec["ingested_at"]) if rec["ingested_at"] else None),
            }
            for rec in records
        ]

    async def get_source_chunks(self, source: str) -> list[ChunkHit]:
        """All chunks for one note, ordered by chunk index (score 0 — not a search)."""
        records = await self._db.fetch(_SOURCE_CHUNKS_SQL, self._source_kind, source)
        return [
            ChunkHit(content=str(rec["content"]), metadata=_as_dict(rec["metadata"]), score=0.0)
            for rec in records
        ]

    async def list_tips(self, limit: int) -> list[ChunkHit]:
        """Up to ``limit`` (capped 20) random ACTIVE tips for this store's ``source_kind`` — a
        KEYLESS read (no embedding), for the sidebar tip widget. Never runs the RAG search path."""
        if limit <= 0:
            return []
        records = await self._db.fetch(_LIST_TIPS_SQL, self._source_kind, min(limit, 20))
        return [
            ChunkHit(content=str(rec["content"]), metadata=_as_dict(rec["metadata"]), score=0.0)
            for rec in records
        ]

    async def list_all_tips(self) -> list[ChunkHit]:
        """One lead chunk per tip source (active or not), for the admin tip manager. The endpoint
        reconstructs the editable {title, body, cta, active} from the chunk content + metadata."""
        records = await self._db.fetch(_LIST_ALL_TIPS_SQL, self._source_kind)
        return [
            ChunkHit(content=str(rec["content"]), metadata=_as_dict(rec["metadata"]), score=0.0)
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
