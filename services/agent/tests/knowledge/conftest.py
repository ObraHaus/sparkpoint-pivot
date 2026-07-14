# ruff: noqa: S101
"""Shared fakes for the knowledge-tier tests — NO live DB, NO real embedding API.

``InMemoryChunkStore`` is a structural :class:`~sparkpoint_agent.knowledge.ChunkStore`
that keeps rows in a dict keyed by primary key, so idempotency (upsert-in-place) and
pruning are exercised exactly as the Postgres store would behave. Vectors come from the
deterministic ``stub_embedder`` (network-free).
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from uuid import UUID

import pytest

from sparkpoint_agent.knowledge import ChunkHit, ChunkRow, Embedder, stub_embedder

_STUB_DIM = 32


class InMemoryChunkStore:
    """A fake ``ChunkStore``: dict-backed upsert + prune + brute-force cosine search."""

    def __init__(self) -> None:
        self.rows: dict[UUID, ChunkRow] = {}

    async def upsert_chunks(self, rows: Sequence[ChunkRow]) -> int:
        for row in rows:
            self.rows[row.id] = row
        return len(rows)

    async def prune_source(self, source_id: UUID, keep_ids: Sequence[UUID]) -> int:
        keep = set(keep_ids)
        stale = [
            rid
            for rid, row in self.rows.items()
            if row.source_id == source_id and rid not in keep
        ]
        for rid in stale:
            del self.rows[rid]
        return len(stale)

    async def search(self, embedding: Sequence[float], k: int) -> list[ChunkHit]:
        if k <= 0:
            return []
        scored = [
            (_cosine(embedding, row.embedding), row) for row in self.rows.values()
        ]
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [
            ChunkHit(content=row.content, metadata=dict(row.metadata), score=score)
            for score, row in scored[:k]
        ]


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=False))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)


@pytest.fixture
def store() -> InMemoryChunkStore:
    return InMemoryChunkStore()


@pytest.fixture
def embedder() -> Embedder:
    return stub_embedder(dimension=_STUB_DIM)
