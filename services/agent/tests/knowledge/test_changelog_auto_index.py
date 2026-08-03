# ruff: noqa: S101
"""033 — publishing an update must also TEACH the assistant, with no button to remember.

031 built the changelog indexer and told users, in the changelog itself:

    "every future update teaches it automatically. Nobody has to remember a separate step,
     which means it won't be forgotten."

That sentence was false when it shipped. ``ingest_changelog`` had exactly one caller — the manual
Admin → Re-ingest button — while the boot path seeded each new entry straight into
``content_entries``. So every release since has been published to the page and left invisible to
every answer. It was caught the plain way: 032's own entry reached the live changelog feed, and a
corpus query for its title returned nothing.

Two things are pinned here. That the ingest is wired to boot at all, which is the actual defect;
and that a boot which changes nothing costs nothing, because this now runs on every restart —
including the restarts that follow an unhealthy deploy — and embedding is a paid call to a third
party.
"""

from __future__ import annotations

import inspect
from typing import Any

import pytest

from sparkpoint_agent.api import main as api_main
from sparkpoint_agent.knowledge.changelog_ingest import (
    entry_slug,
    ingest_changelog,
    render_entry,
)
from sparkpoint_agent.knowledge.ingestion import chunk_note, parse_note

ENTRY = {
    "id": 7,
    "slug": "one-place-to-manage-what-sparky-knows",
    "title": "One place to manage what Sparky knows",
    "tag": "Improved",
    "body": "Everything you write for Sparky now lives on a single page — five labelled sections.",
    "publishedAt": "2026-08-03T19:30:00+00:00",
}


class _Source:
    def __init__(self, entries: list[dict[str, Any]]) -> None:
        self._entries = entries

    async def list_changelog(self, limit: int = 40) -> list[dict[str, Any]]:
        return self._entries


class _Vec:
    def __init__(self) -> None:
        self.vector = [0.1] * 8
        self.model_version = "test-embed-v1"


class _Embedder:
    dimensions = 8

    def __init__(self) -> None:
        self.calls = 0

    def embed(self, texts: Any) -> list[_Vec]:
        self.calls += 1
        return [_Vec() for _ in texts]


class _Hit:
    def __init__(self, content: str) -> None:
        self.content = content


class _Store:
    """A chunk store that can also be READ back, like the real ``PgChunkStore``."""

    def __init__(self, existing: dict[str, list[str]] | None = None) -> None:
        self.existing = existing or {}
        self.written: list[str] = []

    async def upsert_chunks(self, rows: Any) -> int:
        rows = list(rows)
        for r in rows:
            self.written.append(r.metadata.get("source", ""))
        return len(rows)

    async def prune_source(self, *_a: Any, **_k: Any) -> int:
        return 0

    async def get_source_chunks(self, source: str) -> list[_Hit]:
        return [_Hit(c) for c in self.existing.get(source, [])]


def _indexed_form(entry: dict[str, Any]) -> list[str]:
    """Exactly what an ingest of this entry would store — the real chunker, not a guess."""
    source = entry_slug(entry)
    return [c.text for c in chunk_note(parse_note(render_entry(entry), source=source))]


# ── the defect: the ingest must actually be wired to boot ─────────────────────


def test_the_boot_path_indexes_the_changelog_it_just_seeded() -> None:
    """The whole bug in one assertion. ``_seed_changelog`` publishes the entry to the page; without
    a boot-time index it never reaches the corpus, and only an admin pressing a button fixes it."""
    src = inspect.getsource(api_main.lifespan)
    assert "_seed_changelog" in src, "the page seed still runs"
    assert "_index_changelog" in src, (
        "boot seeds the changelog into content_entries but never indexes it — this is the 031 "
        "defect: the update is published to the page and invisible to every answer"
    )


def test_the_index_runs_in_the_background_so_boot_never_waits_on_a_third_party() -> None:
    """Embedding is a network call to an embedding provider. Awaited inline, a slow provider would
    stall startup past the container healthcheck and take the agent down over a SEARCH INDEX."""
    src = inspect.getsource(api_main.lifespan)
    assert "asyncio.create_task(_index_changelog(db))" in src, (
        "the changelog index must be a background task, never awaited inline in boot"
    )


@pytest.mark.asyncio
async def test_a_failure_to_index_never_costs_the_agent_its_boot() -> None:
    class _Exploding:
        async def list_changelog(self, limit: int = 40) -> list[dict[str, Any]]:
            raise RuntimeError("embedding provider is down")

    # The real helper swallows everything; calling it with a broken DB handle exercises that.
    await api_main._index_changelog(object())  # must not raise


# ── the cost: an unchanged boot must not re-embed ─────────────────────────────


@pytest.mark.asyncio
async def test_an_entry_already_indexed_unchanged_is_not_re_embedded() -> None:
    store = _Store({entry_slug(ENTRY): _indexed_form(ENTRY)})
    embedder = _Embedder()

    results = await ingest_changelog(_Source([ENTRY]), store=store, embedder=embedder)

    assert results == [], "nothing to write"
    assert embedder.calls == 0, "an unchanged entry must cost zero embedding calls"
    assert store.written == []


@pytest.mark.asyncio
async def test_an_edited_entry_is_re_indexed() -> None:
    """The skip must be driven by the CONTENT, not by mere presence — otherwise correcting a
    published entry would leave the assistant quoting the old wording forever."""
    store = _Store({entry_slug(ENTRY): _indexed_form(ENTRY)})
    edited = dict(ENTRY, body="Everything you write for Sparky now lives on a single page.")

    results = await ingest_changelog(_Source([edited]), store=store, embedder=_Embedder())

    assert len(results) == 1, "an edited entry must be re-indexed"


@pytest.mark.asyncio
async def test_a_new_entry_is_indexed() -> None:
    store = _Store()  # nothing indexed yet
    results = await ingest_changelog(_Source([ENTRY]), store=store, embedder=_Embedder())
    assert [r.source for r in results] == [entry_slug(ENTRY)]


@pytest.mark.asyncio
async def test_an_unreadable_corpus_re_indexes_rather_than_assuming_it_is_current() -> None:
    """The failure mode must be a needless re-embed, never a silently stale corpus."""

    class _BlindStore(_Store):
        async def get_source_chunks(self, source: str) -> list[_Hit]:
            raise RuntimeError("read failed")

    results = await ingest_changelog(_Source([ENTRY]), store=_BlindStore(), embedder=_Embedder())
    assert len(results) == 1


@pytest.mark.asyncio
async def test_a_store_without_the_read_still_ingests() -> None:
    """``ChunkStore`` is a Protocol with three methods; ``get_source_chunks`` is not one of them."""

    class _MinimalStore:
        def __init__(self) -> None:
            self.written: list[str] = []

        async def upsert_chunks(self, rows: Any) -> int:
            rows = list(rows)
            self.written.extend(r.metadata.get("source", "") for r in rows)
            return len(rows)

        async def prune_source(self, *_a: Any, **_k: Any) -> int:
            return 0

    store = _MinimalStore()
    results = await ingest_changelog(_Source([ENTRY]), store=store, embedder=_Embedder())
    assert len(results) == 1
    assert store.written
