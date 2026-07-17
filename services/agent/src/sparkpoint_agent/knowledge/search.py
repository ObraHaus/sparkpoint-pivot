"""T123 — knowledge_search: cosine top-k over ``memory_chunks`` → advisory Citations.

Embeds the query with the shared T124 :class:`Embedder`, asks the :class:`ChunkStore`
for the nearest chunks, and maps each hit to the shared wire ``Citation``
(agent-service-api.md §2.6) so the recommender can surface it as provenance under a
recommendation's rationale.

NON-CUSTODY / boundary (T126): imports the ``store`` seam, the shared ``embeddings``
embedder, and the ``..wire`` leaf ONLY. Never imports ``policy``/``agents``/``coordinator``.
A citation is advisory context — it never gates a signature.
"""

from __future__ import annotations

import asyncio
import re
from datetime import UTC, date, datetime

from ..wire import Citation
from .embeddings import Embedder
from .store import ChunkHit, ChunkStore

# Snippet length surfaced in a Citation.value (kept short; the full chunk stays in the DB).
_SNIPPET_CHARS = 220

_WS_RE = re.compile(r"\s+")


def _snippet(content: str) -> str:
    """Collapse whitespace and truncate a chunk to a citation-sized snippet."""
    flat = _WS_RE.sub(" ", content).strip()
    if len(flat) <= _SNIPPET_CHARS:
        return flat
    return flat[: _SNIPPET_CHARS - 1].rstrip() + "…"


def _as_of_iso(updated: object) -> str:
    """Normalize an Obsidian ``updated`` frontmatter value to a ``Z``-suffixed
    ISO-8601 UTC datetime — the only shape the shared ``Citation.asOf`` schema
    (``z.string().datetime()``, agent-service-api.md §2.6) accepts. Date-only
    frontmatter (``2026-07-14``) is expanded to midnight UTC; anything absent or
    unparseable falls back to now. ``datetime.isoformat()`` is deliberately avoided
    — it yields a ``+00:00`` offset the strict schema rejects."""
    dt: datetime | None = None
    if isinstance(updated, datetime):  # must precede `date` (datetime subclasses date)
        dt = updated
    elif isinstance(updated, date):
        dt = datetime(updated.year, updated.month, updated.day, tzinfo=UTC)
    elif isinstance(updated, str) and updated.strip():
        try:
            dt = datetime.fromisoformat(updated.strip().replace("Z", "+00:00"))
        except ValueError:
            dt = None
    if dt is None:
        dt = datetime.now(UTC)
    elif dt.tzinfo is not None:
        dt = dt.astimezone(UTC)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def hit_to_citation(hit: ChunkHit) -> Citation:
    """Map one retrieved chunk to the shared wire :class:`Citation` (source + snippet)."""
    md = hit.metadata
    source = str(md.get("source") or "knowledge")
    title = str(md.get("title") or source)
    section = str(md.get("section") or "")
    updated = md.get("updated")
    return Citation(
        provider=title,
        endpoint=f"obsidian://{source}",
        field=section,
        value=_snippet(hit.content),
        as_of=_as_of_iso(updated),
        stale=False,  # advisory knowledge is never "stale market data"
    )


async def knowledge_search_hits(
    query: str,
    k: int,
    *,
    store: ChunkStore,
    embedder: Embedder,
) -> list[ChunkHit]:
    """Return the top-``k`` :class:`ChunkHit`s for ``query`` (cosine, nearest-first).

    Empty/blank query or non-positive ``k`` returns ``[]`` without a round-trip. The query is
    embedded in the SAME pinned space as the stored chunks (single shared :class:`Embedder`), so
    distances are comparable. The backend embed is a synchronous network call — run off the event
    loop so a retrieval never blocks request serving.
    """
    if k <= 0 or not query.strip():
        return []
    query_vector = (await asyncio.to_thread(embedder.embed_one, query)).vector
    return await store.search(query_vector, k)


async def knowledge_search(
    query: str,
    k: int,
    *,
    store: ChunkStore,
    embedder: Embedder,
) -> list[Citation]:
    """Return the top-``k`` advisory :class:`Citation`s for ``query`` (cosine, nearest-first)."""
    hits = await knowledge_search_hits(query, k, store=store, embedder=embedder)
    return [hit_to_citation(hit) for hit in hits]
