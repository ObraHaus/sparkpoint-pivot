"""T125 — the retrieve_citations contract the recommender imports.

The recommender MAY depend on ``knowledge`` (allowed import direction); ``knowledge``
MUST NOT depend on ``agents``/``coordinator``/``policy`` (T126 boundary). So the
recommender holds a :class:`CitationRetriever` — a tiny, fail-closed facade over
:func:`~sparkpoint_agent.knowledge.search.knowledge_search` — and calls
``retrieve_citations(query)`` to attach advisory provenance to its rationale.

Fail-closed: any error (no DB, embedding failure, malformed row) returns ``()`` so a
retrieval hiccup NEVER breaks a recommendation. Citations are advisory only — they
enrich the rationale and never make a block signable (that is ``policy.status`` alone).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from ..wire import Citation
from .embeddings import Embedder, openai_embedder
from .search import knowledge_search
from .store import ChunkStore, PgChunkStore

# Default number of advisory citations attached to a recommendation.
DEFAULT_K = 3


@runtime_checkable
class CitationRetriever(Protocol):
    """What the recommender depends on: ``retrieve_citations(query) -> Citations``.

    The recommender types its optional ``knowledge`` collaborator against THIS Protocol
    (not the concrete class), so it imports only an interface from ``knowledge`` and any
    fake satisfies it in tests.
    """

    async def retrieve_citations(
        self, query: str, *, k: int | None = None
    ) -> tuple[Citation, ...]:
        ...


@dataclass
class KnowledgeRetriever:
    """Concrete :class:`CitationRetriever` over a :class:`ChunkStore` + shared embedder."""

    store: ChunkStore
    embedder: Embedder
    default_k: int = DEFAULT_K

    async def retrieve_citations(
        self, query: str, *, k: int | None = None
    ) -> tuple[Citation, ...]:
        """Advisory citations for ``query`` — fail-closed to ``()`` on ANY error."""
        limit = self.default_k if k is None else k
        try:
            citations = await knowledge_search(
                query, limit, store=self.store, embedder=self.embedder
            )
        except Exception:
            # Advisory retrieval must never break the recommender (non-custody).
            return ()
        return tuple(citations)


def default_citation_retriever() -> KnowledgeRetriever | None:
    """The production Obsidian retriever, or ``None`` when no real embedder is configured.

    Composes the pgvector-backed :class:`PgChunkStore` over the shared asyncpg pool with the
    real :func:`openai_embedder`. When ``EMBEDDING_OPENAI_*`` is unset (e.g. CI/tests) this
    returns ``None`` so the recommender simply attaches no corpus citations — never a fabricated
    or stub-ranked one. Boundary-safe (T126): imports only ``knowledge`` + the ``db`` data layer,
    never ``policy``/``agents``/``coordinator``.
    """
    embedder = openai_embedder()
    if embedder is None:
        return None
    # Local import keeps the knowledge→db edge lazy (no module-load coupling) and the boundary
    # one-directional (db never imports knowledge).
    from ..db import get_database

    return KnowledgeRetriever(store=PgChunkStore(get_database()), embedder=embedder)
