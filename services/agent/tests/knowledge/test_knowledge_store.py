# ruff: noqa: S101
"""T122/T123 — the ``memory_chunks`` upsert/search SQL shape (asyncpg executor MOCKED).

Documents the exact parameterized statements ``PgChunkStore`` binds against the pgvector
table from migration 0001: an ``INSERT ... ON CONFLICT (id) DO UPDATE`` upsert, a
prune-by-source delete, and a cosine (``<=>``) top-k search. No live DB.
"""

from __future__ import annotations

import json
from typing import Any
from uuid import uuid4

from sparkpoint_agent.knowledge import ChunkRow, PgChunkStore, to_vector_literal


class _FakeExecutor:
    """Records every ``execute`` call and returns canned rows for ``fetch``."""

    def __init__(self, fetch_rows: list[dict[str, Any]] | None = None) -> None:
        self.executed: list[tuple[str, tuple[Any, ...]]] = []
        self._fetch_rows = fetch_rows or []
        self.fetched: list[tuple[str, tuple[Any, ...]]] = []

    async def execute(self, query: str, *args: Any) -> str:
        self.executed.append((query, args))
        return "DELETE 2"

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        self.fetched.append((query, args))
        return self._fetch_rows


def _row() -> ChunkRow:
    return ChunkRow(
        id=uuid4(),
        source_id=uuid4(),
        content="Aave supply earns floating APY.",
        embedding=(0.1, 0.2, 0.3),
        embedding_model="stub-hash-v0",
        metadata={"source": "aave-v3-supply", "section": "Yield"},
    )


async def test_upsert_binds_insert_on_conflict_shape() -> None:
    fake = _FakeExecutor()
    store = PgChunkStore(fake)  # type: ignore[arg-type]
    row = _row()
    written = await store.upsert_chunks([row])
    assert written == 1
    query, args = fake.executed[0]
    assert "INSERT INTO memory_chunks" in query
    assert "ON CONFLICT (id) DO UPDATE" in query
    assert "$5::vector" in query and "$7::jsonb" in query
    # Params in declared order: id, source_kind, source_id, content, vector, model, metadata.
    assert args[0] == row.id
    assert args[1] == "knowledge"
    assert args[2] == row.source_id
    assert args[3] == row.content
    assert args[4] == to_vector_literal(row.embedding) == "[0.1,0.2,0.3]"
    assert args[5] == "stub-hash-v0"
    assert json.loads(args[6]) == row.metadata


async def test_prune_binds_delete_by_source_keeping_ids() -> None:
    fake = _FakeExecutor()
    store = PgChunkStore(fake)  # type: ignore[arg-type]
    sid = uuid4()
    keep = [uuid4(), uuid4()]
    removed = await store.prune_source(sid, keep)
    assert removed == 2  # parsed from the "DELETE 2" command tag
    query, args = fake.executed[0]
    assert "DELETE FROM memory_chunks" in query
    assert "id <> ALL($3::uuid[])" in query
    assert args[0] == sid
    assert args[1] == "knowledge"
    assert args[2] == keep


async def test_search_binds_cosine_topk_and_maps_hits() -> None:
    rows = [
        {"content": "chunk one", "metadata": json.dumps({"source": "a"}), "score": 0.91},
        {"content": "chunk two", "metadata": {"source": "b"}, "score": 0.42},
    ]
    fake = _FakeExecutor(fetch_rows=rows)
    store = PgChunkStore(fake)  # type: ignore[arg-type]
    hits = await store.search([0.1, 0.2, 0.3], 5)
    query, args = fake.fetched[0]
    assert "embedding <=> $1::vector" in query
    assert "1 - (embedding <=> $1::vector) AS score" in query
    assert args[0] == "[0.1,0.2,0.3]"
    # 031 — a SET of kinds, not one. Retrieval used to be scoped to `knowledge` alone, which is why
    # published updates and tips were invisible to every answer.
    assert args[1] == ["knowledge", "changelog", "tip", "self_authored"]
    assert "persona" not in args[1], "persona is SYSTEM instruction text, never retrievable"
    assert args[2] == 5
    assert "user_id IS NULL" in query, "operational memory can never reach an advisory citation"
    # JSONB metadata parsed whether asyncpg returned text or a dict.
    assert hits[0].metadata == {"source": "a"}
    assert hits[1].metadata == {"source": "b"}
    assert hits[0].score == 0.91


async def test_search_zero_k_short_circuits() -> None:
    fake = _FakeExecutor()
    store = PgChunkStore(fake)  # type: ignore[arg-type]
    assert await store.search([0.1], 0) == []
    assert fake.fetched == []


# ── 031 · what an advisory answer may read ────────────────────────────────────


async def test_search_carries_the_source_kind_through_to_the_hit() -> None:
    """A citation must be able to say WHAT it is citing.

    Without this a note the assistant wrote about itself is indistinguishable from documentation a
    person wrote — which is how a citation stops meaning anything.
    """
    rows = [
        {"content": "c", "metadata": {}, "score": 0.9, "source_kind": "self_authored"},
        {"content": "d", "metadata": {}, "score": 0.8, "source_kind": "changelog"},
    ]
    store = PgChunkStore(_FakeExecutor(fetch_rows=rows))  # type: ignore[arg-type]
    hits = await store.search([0.1], 5)
    assert [h.source_kind for h in hits] == ["self_authored", "changelog"]


async def test_a_hit_without_a_kind_defaults_to_knowledge() -> None:
    """Pre-031 rows (and any caller constructing a hit directly) stay valid."""
    rows = [{"content": "c", "metadata": {}, "score": 0.9}]
    store = PgChunkStore(_FakeExecutor(fetch_rows=rows))  # type: ignore[arg-type]
    assert (await store.search([0.1], 5))[0].source_kind == "knowledge"


def test_persona_is_not_a_retrievable_kind() -> None:
    """Pinned deliberately. The persona is trusted SYSTEM instruction text with no chunks at all;
    making it retrievable would let it be quoted back to a user and cited as a source."""
    from sparkpoint_agent.knowledge.store import RETRIEVABLE_SOURCE_KINDS

    assert "persona" not in RETRIEVABLE_SOURCE_KINDS
    assert set(RETRIEVABLE_SOURCE_KINDS) == {"knowledge", "changelog", "tip", "self_authored"}
