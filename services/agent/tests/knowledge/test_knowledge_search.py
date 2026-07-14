# ruff: noqa: S101
"""T123/T125 — search returns ranked Citations; the retriever facade is fail-closed;
the recommender attaches advisory citations. DB + embedder MOCKED.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sparkpoint_agent.agents.planner import Intent, IntentKind
from sparkpoint_agent.agents.recommender import ProposalContext, Recommender
from sparkpoint_agent.knowledge import (
    ChunkHit,
    Embedder,
    KnowledgeRetriever,
    default_seed_dir,
    hit_to_citation,
    ingest_directory,
    ingest_note,
    knowledge_search,
)
from sparkpoint_agent.llm import StructuredResult
from sparkpoint_agent.policy import RiskProfile
from sparkpoint_agent.wire import Citation

# ``store`` (InMemoryChunkStore) + ``embedder`` (stub) are provided by conftest fixtures.

NOTE_A = """---
title: Aave v3 Supply Mechanics
source: aave-v3-supply
updated: 2026-07-10
---

# Aave v3 Supply Mechanics

Supplying USDC to Aave v3 earns a floating supply APY driven by pool utilization.

## Liquidity

Supplied USDC is withdrawable on demand while the pool holds free liquidity.
"""

NOTE_B = """---
title: The Profit-Only Vault
source: profit-only-vault
updated: 2026-07-11
---

# The Profit-Only Vault

The vault charges a performance fee on profit only; 0% on principal.
"""


async def _seed(store: Any, embedder: Embedder) -> None:
    await ingest_note(NOTE_A, source="aave-v3-supply", store=store, embedder=embedder)
    await ingest_note(NOTE_B, source="profit-only-vault", store=store, embedder=embedder)


# ── knowledge_search ─────────────────────────────────────────────────────────


async def test_search_returns_citation_list_respecting_k(
    store: Any, embedder: Embedder
) -> None:
    await _seed(store, embedder)
    cites = await knowledge_search("aave supply apy", 2, store=store, embedder=embedder)
    assert len(cites) == 2
    assert all(isinstance(c, Citation) for c in cites)
    # Advisory knowledge is never flagged as stale market data; snippet + source present.
    assert all(c.stale is False for c in cites)
    assert all(c.value for c in cites)
    assert all(c.endpoint.startswith("obsidian://") for c in cites)


async def test_search_blank_query_or_zero_k_short_circuits(
    store: Any, embedder: Embedder
) -> None:
    await _seed(store, embedder)
    assert await knowledge_search("   ", 3, store=store, embedder=embedder) == []
    assert await knowledge_search("aave", 0, store=store, embedder=embedder) == []


async def test_search_ranks_by_cosine_nearest_first(
    store: Any, embedder: Embedder
) -> None:
    await _seed(store, embedder)
    # A query identical to a stored chunk's text embeds to that chunk's vector → rank 1.
    stored = next(
        r.content for r in store.rows.values() if "performance fee on profit" in r.content
    )
    cites = await knowledge_search(stored, 2, store=store, embedder=embedder)
    assert cites[0].provider == "The Profit-Only Vault"


def test_hit_to_citation_maps_source_and_snippet() -> None:
    hit = ChunkHit(
        content="  Aave   supply\n\nyield  ",
        metadata={"source": "aave-v3-supply", "title": "Aave v3", "section": "Yield",
                  "updated": "2026-07-10"},
        score=0.9,
    )
    cite = hit_to_citation(hit)
    assert cite.provider == "Aave v3"
    assert cite.endpoint == "obsidian://aave-v3-supply"
    assert cite.field == "Yield"
    assert cite.as_of == "2026-07-10"
    assert cite.value == "Aave supply yield"  # whitespace collapsed


# ── the shipped seed corpus ingests + is searchable ──────────────────────────


async def test_seed_corpus_ingests_and_is_searchable(
    store: Any, embedder: Embedder
) -> None:
    report = await ingest_directory(default_seed_dir(), store=store, embedder=embedder)
    assert report.total_written > 0
    assert len(report.results) >= 3  # aave, vault, risk-profiles
    cites = await knowledge_search(
        "conservative USDC yield vault", 3, store=store, embedder=embedder
    )
    assert cites and all(isinstance(c, Citation) for c in cites)


# ── KnowledgeRetriever (T125) — fail-closed advisory facade ──────────────────


async def test_retriever_returns_tuple_of_citations(
    store: Any, embedder: Embedder
) -> None:
    await _seed(store, embedder)
    retriever = KnowledgeRetriever(store=store, embedder=embedder, default_k=2)
    cites = await retriever.retrieve_citations("aave supply")
    assert isinstance(cites, tuple)
    assert len(cites) == 2


async def test_retriever_fail_closed_on_store_error(embedder: Embedder) -> None:
    class _BoomStore:
        async def upsert_chunks(self, rows: Any) -> int: ...
        async def prune_source(self, source_id: Any, keep_ids: Any) -> int: ...
        async def search(self, embedding: Sequence[float], k: int) -> list[ChunkHit]:
            raise RuntimeError("db down")

    retriever = KnowledgeRetriever(store=_BoomStore(), embedder=embedder)
    # Advisory retrieval must never raise into the recommender.
    assert await retriever.retrieve_citations("anything") == ()


# ── recommender wiring (T125) — advisory citations attached, never authoritative ──


class _FakeLlm:
    async def structured(self, *, messages: Any, **_: Any) -> StructuredResult[Any]:
        return StructuredResult(ok=False)  # force deterministic degraded ranking


def _ctx() -> ProposalContext:
    return ProposalContext(
        chain_id=8453,
        user_account="0x2222222222222222222222222222222222222222",
        resolved_targets={"sparkpoint_vault": "0x1111111111111111111111111111111111111111"},
        risk_profile=RiskProfile.CONSERVATIVE,
        gross_apy_bps=421,
        projected_apy_bps=379,
    )


async def test_recommender_attaches_knowledge_citations(
    store: Any, embedder: Embedder
) -> None:
    await _seed(store, embedder)
    retriever = KnowledgeRetriever(store=store, embedder=embedder, default_k=2)
    rec = Recommender(llm=_FakeLlm(), knowledge=retriever)
    result = await rec.propose(Intent(kind=IntentKind.RECOMMEND), _ctx())
    assert result.candidates
    # Every candidate now carries advisory Obsidian citations sourced from knowledge.
    for cand in result.candidates:
        assert cand.citations
        assert any(c.endpoint.startswith("obsidian://") for c in cand.citations)


async def test_recommender_without_knowledge_has_no_citations(
    store: Any, embedder: Embedder
) -> None:
    rec = Recommender(llm=_FakeLlm())  # knowledge unwired (default None)
    result = await rec.propose(Intent(kind=IntentKind.RECOMMEND), _ctx())
    assert result.candidates
    assert all(cand.citations == () for cand in result.candidates)
