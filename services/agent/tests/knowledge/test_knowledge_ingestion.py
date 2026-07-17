# ruff: noqa: S101
"""T122 — parse/chunk/ingest: provenance is extracted and upserts are idempotent.

Asserts the Obsidian parser pulls frontmatter/title/wikilinks/sections; that ingest
embeds + upserts one row per chunk with the right ``memory_chunks`` metadata; that a
re-ingest updates in place (no duplicates); and that a shortened note prunes its stale
chunks. DB + embedder are MOCKED (in-memory store + deterministic stub embedder).
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.knowledge import (
    KNOWLEDGE_SOURCE_KIND,
    Embedder,
    chunk_note,
    chunk_uuid,
    ingest_note,
    parse_note,
    source_uuid,
)
from sparkpoint_agent.knowledge.ingestion import PiiDetectedError, scan_for_pii

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


TIP_NOTE = """---
title: Fund your wallet
cta_url: /bridge
cta_label: Get testnet funds
active: true
---

# Fund your wallet

Grab Base Sepolia ETH + test USDC from the faucets on the Bridge page, then deposit.
"""


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


async def test_ingest_tip_source_kind_and_cta_metadata(store: Any, embedder: Embedder) -> None:
    # A tip note ingested under source_kind='tip' lands on the 'tip' rows (never 'knowledge'),
    # and its CTA + active flag ride in metadata for the sidebar widget.
    result = await ingest_note(
        TIP_NOTE, source="tip-fund-wallet", store=store, embedder=embedder, source_kind="tip"
    )
    assert result.written >= 1
    row = next(iter(store.rows.values()))
    assert row.source_kind == "tip"  # NOT the default 'knowledge'
    assert row.metadata["cta_url"] == "/bridge"
    assert row.metadata["cta_label"] == "Get testnet funds"
    assert row.metadata["active"] == "true"
    assert row.metadata["title"] == "Fund your wallet"


async def test_ingest_default_source_kind_carries_no_cta(store: Any, embedder: Embedder) -> None:
    # A normal knowledge note has null CTA metadata (harmless — the tip widget never reads it).
    await ingest_note(NOTE, source="aave-v3-supply", store=store, embedder=embedder)
    row = next(iter(store.rows.values()))
    assert row.metadata["cta_url"] is None
    assert row.metadata["cta_label"] is None


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


# ── PII denylist + provenance stamp (T123) ────────────────────────────────────


def test_scan_for_pii_flags_secrets_but_not_contract_addresses() -> None:
    assert scan_for_pii("reach me at alice@example.com") == ["email"]
    assert scan_for_pii("leaked key 0x" + "a" * 64) == ["private_key_hex"]
    assert "pem_private_key" in scan_for_pii("-----BEGIN EC PRIVATE KEY-----\nMII...")
    # A 20-byte (40-hex) contract address is LEGITIMATE corpus content — must NOT trip.
    assert scan_for_pii("Aave pool at 0xA238Dd80C259a72e81d7e4664a9801593F98d1c5") == []


async def test_ingest_refuses_pii_and_writes_nothing(store: Any, embedder: Embedder) -> None:
    poisoned = "# Note\n\nprivate key 0x" + "b" * 64 + "\n"
    with pytest.raises(PiiDetectedError):
        await ingest_note(poisoned, source="bad", store=store, embedder=embedder)
    assert len(store.rows) == 0  # nothing embedded or written


async def test_ingest_stamps_git_sha_and_timestamp(store: Any, embedder: Embedder) -> None:
    await ingest_note(
        NOTE, source="aave-v3-supply", store=store, embedder=embedder, source_ref="abc1234"
    )
    row = next(iter(store.rows.values()))
    assert row.metadata["git_sha"] == "abc1234"
    assert row.metadata["ingested_at"].endswith("+00:00")  # UTC iso
    assert row.metadata["source"] == "aave-v3-supply"  # original provenance preserved
