# ruff: noqa: S101
"""T122 — parse/chunk/ingest: provenance is extracted and upserts are idempotent.

Asserts the Obsidian parser pulls frontmatter/title/wikilinks/sections; that ingest
embeds + upserts one row per chunk with the right ``memory_chunks`` metadata; that a
re-ingest updates in place (no duplicates); and that a shortened note prunes its stale
chunks. DB + embedder are MOCKED (in-memory store + deterministic stub embedder).
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.knowledge import (
    KNOWLEDGE_SOURCE_KIND,
    Embedder,
    chunk_note,
    chunk_uuid,
    ingest_note,
    parse_note,
    source_uuid,
)

# The ``store`` (InMemoryChunkStore) and ``embedder`` (stub) come from conftest fixtures;
# typed loosely here because the test dir is not an importable package.

NOTE = """---
title: Aave v3 Supply Mechanics
tags: [aave, supply, yield]
risk_tier: conservative
updated: 2026-07-10
---

# Aave v3 Supply Mechanics

Supplying USDC to Aave v3 mints an interest-bearing aToken. See [[risk-profiles]].

## Where the yield comes from

Supply APY floats with pool utilization; it is a spot reading, never a promise.

## How SparkPoint uses it

The [[profit-only-vault|vault]] routes conservative USDC into Aave supply.
"""


# ── parse ────────────────────────────────────────────────────────────────────


def test_parse_note_extracts_frontmatter_title_links_sections() -> None:
    note = parse_note(NOTE, source="aave-v3-supply")
    assert note.title == "Aave v3 Supply Mechanics"
    assert note.tags == ("aave", "supply", "yield")
    assert note.frontmatter["risk_tier"] == "conservative"
    assert note.frontmatter["updated"] == "2026-07-10"
    # Wikilinks de-aliased and de-duped, order preserved.
    assert note.wikilinks == ("risk-profiles", "profit-only-vault")
    headings = [s.heading for s in note.sections]
    # Lead paragraph (heading="") + the two H2 sections.
    assert headings == ["", "Where the yield comes from", "How SparkPoint uses it"]


def test_parse_note_without_frontmatter_uses_h1_then_source() -> None:
    note = parse_note("# Just A Title\n\nBody text.", source="slug")
    assert note.title == "Just A Title"
    assert note.frontmatter == {}
    bare = parse_note("Body only, no headings.", source="slug")
    assert bare.title == "slug"


def test_chunk_note_carries_provenance_and_dense_indexes() -> None:
    chunks = chunk_note(parse_note(NOTE, source="aave-v3-supply"))
    assert [c.index for c in chunks] == list(range(len(chunks)))
    assert all(c.source == "aave-v3-supply" for c in chunks)
    assert all(c.risk_tier == "conservative" for c in chunks)
    # Section heading becomes the note title for the lead chunk.
    assert chunks[0].section == "Aave v3 Supply Mechanics"
    md = chunks[1].metadata()
    assert md["section"] == "Where the yield comes from"
    assert md["source"] == "aave-v3-supply"
    assert md["tier"] == "obsidian"
    assert md["wikilinks"] == ["risk-profiles", "profit-only-vault"]


# ── ingest ─────────────────────────────────────────────────────────────────


async def test_ingest_upserts_one_row_per_chunk(
    store: Any, embedder: Embedder
) -> None:
    result = await ingest_note(NOTE, source="aave-v3-supply", store=store, embedder=embedder)
    chunks = chunk_note(parse_note(NOTE, source="aave-v3-supply"))
    assert result.written == len(chunks)
    assert len(store.rows) == len(chunks)
    row = next(iter(store.rows.values()))
    assert row.source_kind == KNOWLEDGE_SOURCE_KIND
    assert row.source_id == source_uuid("aave-v3-supply")
    # Every chunk was embedded in the pinned space and stamped with the model version.
    assert len(row.embedding) == 32
    assert row.embedding_model  # non-empty stamp
    # Primary keys are the deterministic per-(source,index) UUID5.
    assert chunk_uuid("aave-v3-supply", 0) in store.rows


async def test_ingest_is_idempotent(
    store: Any, embedder: Embedder
) -> None:
    first = await ingest_note(NOTE, source="aave-v3-supply", store=store, embedder=embedder)
    count_after_first = len(store.rows)
    second = await ingest_note(NOTE, source="aave-v3-supply", store=store, embedder=embedder)
    # Re-ingest overwrites in place: same row count, nothing pruned or duplicated.
    assert len(store.rows) == count_after_first
    assert second.written == first.written
    assert second.pruned == 0


async def test_ingest_prunes_stale_chunks_when_note_shrinks(
    store: Any, embedder: Embedder
) -> None:
    await ingest_note(NOTE, source="aave-v3-supply", store=store, embedder=embedder)
    full = len(store.rows)
    shorter = (
        "---\ntitle: Aave v3 Supply Mechanics\n---\n\n"
        "# Aave v3 Supply Mechanics\n\nOnly a lead paragraph now.\n"
    )
    result = await ingest_note(shorter, source="aave-v3-supply", store=store, embedder=embedder)
    assert result.written == 1
    assert result.pruned == full - 1
    assert len(store.rows) == 1


async def test_ingest_empty_note_writes_nothing(
    store: Any, embedder: Embedder
) -> None:
    result = await ingest_note("", source="empty", store=store, embedder=embedder)
    assert result.written == 0
    assert store.rows == {}
