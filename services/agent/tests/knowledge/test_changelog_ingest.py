# ruff: noqa: S101
"""031 — the assistant can finally read what the team publishes.

Asked *"what shipped this week?"* on alpha, the assistant answered:

    "I'm not sure what shipped this week — that's not something I can check on the fly. You can
     find the latest updates on the /changelog page inside the app."

Honest, and the best it could do: the changelog lives in a table it never read. Feature 029 could
only work around this by teaching it that the page exists. These tests pin the actual fix.
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.knowledge.changelog_ingest import (
    CHANGELOG_SOURCE_KIND,
    entry_slug,
    ingest_changelog,
    render_entry,
)

ENTRY = {
    "slug": "strategies-that-actually-compare",
    "title": "Strategies you can actually compare",
    "tag": "Improved",
    "body": "Two screens that looked finished were quietly doing very little. Both are fixed.",
    "published_at": "2026-08-03T14:00:00Z",
}

#: The shape `ContentEntryStore.list_changelog` ACTUALLY returns: camelCase, and no slug. The first
#: version of this module read `published_at` and `slug`, so every date silently vanished from the
#: indexed text — the one field the module's own docstring argues is essential.
DB_ROW = {
    "id": 100,
    "title": "Strategies you can actually compare",
    "tag": "Improved",
    "body": "Two screens that looked finished were quietly doing very little.",
    "publishedAt": "2026-08-03T14:00:00+00:00",
}


# ── rendering: what actually gets embedded ────────────────────────────────────


def test_the_rendered_entry_reads_like_prose_not_a_database_row() -> None:
    text = render_entry(ENTRY)
    assert "Strategies you can actually compare" in text
    assert "Two screens that looked finished" in text


def test_the_date_is_in_the_text_because_a_vector_search_has_no_clock() -> None:
    """"What shipped THIS WEEK" is a question about time. If the date is not in the chunk, the
    answer cannot be specific about when — which is most of the question."""
    assert "2026-08-03" in render_entry(ENTRY)


def test_the_date_survives_the_shape_the_DATABASE_actually_returns() -> None:
    """Caught against the live database, not in review: the store returns camelCase and the first
    version of this module read snake_case, so the date silently vanished from every chunk."""
    assert "2026-08-03" in render_entry(DB_ROW)
    assert "Strategies you can actually compare" in render_entry(DB_ROW)


def test_a_row_without_a_slug_still_gets_a_stable_id() -> None:
    """`list_changelog` does not project a slug; the bigserial id is stable and unique."""
    assert entry_slug(DB_ROW) == "changelog-100"


def test_the_entry_identifies_itself_as_a_sparkpoint_release_note() -> None:
    """A retrieved chunk must not be mistakable for third-party documentation."""
    text = render_entry(ENTRY).lower()
    assert "sparkpoint" in text
    assert "changelog" in text or "release note" in text


def test_the_tag_survives_so_new_vs_fixed_is_answerable() -> None:
    assert "Improved" in render_entry(ENTRY)


def test_a_sparse_entry_still_renders_something_usable() -> None:
    text = render_entry({"title": "", "body": "", "slug": "x"})
    assert text, "never an empty chunk"
    assert "SparkPoint" in text


def test_the_source_id_is_the_slug_so_re_ingest_replaces_rather_than_duplicates() -> None:
    assert entry_slug(ENTRY) == "changelog-strategies-that-actually-compare"
    # A slugless row still gets a stable id rather than colliding with every other slugless row.
    assert entry_slug({"id": 42}) == "changelog-42"


# ── ingestion ─────────────────────────────────────────────────────────────────


class _Source:
    def __init__(self, entries: list[dict[str, Any]]) -> None:
        self._entries = entries
        self.limit: int | None = None

    async def list_changelog(self, limit: int = 40) -> list[dict[str, Any]]:
        self.limit = limit
        return self._entries


class _Store:
    """Matches the real ChunkStore surface: `upsert_chunks` + `prune_source`."""

    def __init__(self) -> None:
        self.written: list[tuple[str, str]] = []

    async def upsert_chunks(self, rows: Any) -> int:
        rows = list(rows)
        for r in rows:
            self.written.append((r.metadata.get("source", ""), r.source_kind))
        return len(rows)

    async def prune_source(self, *_a: Any, **_k: Any) -> int:
        return 0


class _Vec:
    def __init__(self) -> None:
        self.vector = [0.1] * 8
        self.model_version = "test-embed-v1"


class _Embedder:
    """`embed` is SYNCHRONOUS — ingestion runs it via `asyncio.to_thread` so a network call never
    blocks the event loop. A test double that made it async would pass while the real one hung."""

    dimensions = 8

    def embed(self, texts: Any) -> list[_Vec]:
        return [_Vec() for _ in texts]


@pytest.mark.asyncio
async def test_published_entries_are_indexed_under_their_own_kind() -> None:
    store = _Store()
    results = await ingest_changelog(_Source([ENTRY]), store=store, embedder=_Embedder())
    assert results, "the entry must be indexed"
    assert all(kind == CHANGELOG_SOURCE_KIND for _, kind in store.written)
    assert all(src == "changelog-strategies-that-actually-compare" for src, _ in store.written)


@pytest.mark.asyncio
async def test_one_bad_entry_never_costs_the_rest() -> None:
    """A partially indexed changelog is strictly better than none, and this never runs on a user's
    path — so a single unembeddable entry is skipped, not fatal."""

    class _FlakyEmbedder(_Embedder):
        calls = 0

        def embed(self, texts: Any) -> list[_Vec]:
            _FlakyEmbedder.calls += 1
            if _FlakyEmbedder.calls == 1:
                raise RuntimeError("boom")
            return [_Vec() for _ in texts]

    entries = [dict(ENTRY, slug="a"), dict(ENTRY, slug="b")]
    results = await ingest_changelog(_Source(entries), store=_Store(), embedder=_FlakyEmbedder())
    assert len(results) == 1, "the second entry still indexed"


@pytest.mark.asyncio
async def test_an_empty_changelog_is_not_an_error() -> None:
    assert await ingest_changelog(_Source([]), store=_Store(), embedder=_Embedder()) == []


@pytest.mark.asyncio
async def test_the_feed_is_bounded_because_recent_is_what_was_asked() -> None:
    source = _Source([ENTRY])
    await ingest_changelog(source, store=_Store(), embedder=_Embedder(), limit=5)
    assert source.limit == 5
