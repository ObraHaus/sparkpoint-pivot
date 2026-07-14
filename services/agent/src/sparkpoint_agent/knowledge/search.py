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

import re

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
        as_of=str(updated) if updated else "",
        stale=False,  # advisory knowledge is never "stale market data"
    )


async def knowledge_search(
    query: str,
    k: int,
    *,
    store: ChunkStore,
    embedder: Embedder,
) -> list[Citation]:
    """Return the top-``k`` advisory :class:`Citation`s for ``query`` (cosine, nearest-first).

    Empty/blank query or non-positive ``k`` returns ``[]`` without a round-trip. The
    query is embedded in the SAME pinned space as the stored chunks (single shared
    :class:`Embedder`), so distances are comparable.
    """
    if k <= 0 or not query.strip():
        return []
    query_vector = embedder.embed_one(query).vector
    hits = await store.search(query_vector, k)
    return [hit_to_citation(hit) for hit in hits]
