# ruff: noqa: S101
"""Real-vector retrieval-relevance test (P2 claim) — replayable, NO live embedding call.

Uses committed `qwen3-embedding-8b-mrl1024` vectors (fixtures/relevance_vectors.json, generated once
from the operator's provider) fed through the same cosine search the Postgres store uses. Proves,
deterministically in CI, that a concentrated-liquidity query retrieves the Aerodrome note and an
Aave query retrieves the Aave note — the P2 "semantic retrieval is RELEVANT" claim, now replayable
instead of asserted only against a hash stub (which cannot separate meaning).
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from sparkpoint_agent.knowledge import ChunkRow

_FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "relevance_vectors.json").read_text())
_V = _FIXTURE["vectors"]


def _row(name: str) -> ChunkRow:
    return ChunkRow(
        id=uuid5(NAMESPACE_URL, name),
        source_id=uuid5(NAMESPACE_URL, f"{name}-src"),
        content=name,
        embedding=tuple(_V[f"chunk_{name}"]),
        embedding_model=_FIXTURE["model_version"],
        metadata={"source": name},
    )


def test_fixture_is_the_pinned_space() -> None:
    # Guards against a stale fixture from a different embedding space.
    assert _FIXTURE["dim"] == 1024
    assert _FIXTURE["model_version"].startswith("qwen3-embedding-8b-mrl1024")


async def test_concentrated_liquidity_query_retrieves_aerodrome(store: object) -> None:
    await store.upsert_chunks([_row("aerodrome"), _row("aave")])  # type: ignore[attr-defined]
    hits = await store.search(_V["query_cl"], k=2)  # type: ignore[attr-defined]
    assert hits[0].content == "aerodrome", "a CL query must retrieve the Aerodrome note first"
    assert hits[0].score > hits[1].score


async def test_aave_query_retrieves_aave(store: object) -> None:
    await store.upsert_chunks([_row("aerodrome"), _row("aave")])  # type: ignore[attr-defined]
    hits = await store.search(_V["query_aave"], k=2)  # type: ignore[attr-defined]
    assert hits[0].content == "aave", "an Aave lending query must retrieve the Aave note first"
    assert hits[0].score > hits[1].score
