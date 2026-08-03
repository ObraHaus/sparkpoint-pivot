"""031 — make what the team publishes readable by the assistant.

WHY THIS EXISTS. The in-app changelog lives in ``content_entries`` and is rendered on a page. The
assistant reads a vector corpus. The two never met, so asked *"what shipped this week?"* the best
it could honestly do was point at a page it cannot read — which is exactly what it did on alpha,
and exactly the gap feature 029 could only work around.

Indexing the changelog is the point of the client's decision: every future release then teaches the
assistant automatically, with no separate step for anyone to remember. The same run also refreshes
the tip databank's visibility, since tips were already embedded but excluded from advisory
retrieval.

DESIGN NOTES, each of which is a decision rather than an accident:

* **Entries are rendered to prose before embedding.** A row is a title, a tag, a date and a body;
  embedding the raw JSON would retrieve punctuation. The rendered form reads like a sentence
  someone wrote, because that is what an answer needs to quote.
* **The date is stated in the text.** "What shipped THIS WEEK" is a question about time, and a
  vector search has no clock. Putting the date in the chunk is what lets the answer be specific.
* **This is idempotent.** Chunk ids are deterministic (UUID5 over source + index) and stale chunks
  are pruned, so re-running after an edit replaces rather than duplicates.
* **It never runs on a request path.** Embedding is a network call to a third party; the agent's
  data layer is a derived index and must never sit between a user and their funds.
"""

from __future__ import annotations

import logging
from typing import Any, Protocol

from .embeddings import Embedder
from .ingestion import IngestResult, chunk_note, ingest_note, parse_note
from .store import ChunkStore

_logger = logging.getLogger(__name__)

#: The source kind published updates are stored under (migration 0034).
CHANGELOG_SOURCE_KIND = "changelog"

#: How many entries to index. The changelog is a feed, not an archive: a user asking what shipped
#: means recently, and older entries dilute the search space without answering anything better.
DEFAULT_LIMIT = 40


class ChangelogSource(Protocol):
    """The read this module needs — satisfied by ``ContentEntryStore``."""

    async def list_changelog(self, limit: int = ...) -> list[dict[str, Any]]: ...


def _field(entry: dict[str, Any], *names: str) -> str:
    """Read the first present key. ``ContentEntryStore`` returns camelCase (``publishedAt``) while
    the seed file uses snake_case (``published_at``) — reading only one shape silently drops the
    value, which is how the date went missing from the first version of this module."""
    for name in names:
        value = entry.get(name)
        if value:
            return str(value)
    return ""


def render_entry(entry: dict[str, Any]) -> str:
    """One published update as prose an answer can quote.

    Deliberately states the date in words the model can reason about, and labels the entry as a
    SparkPoint release note so a retrieved chunk cannot be mistaken for third-party documentation.
    """
    title = _field(entry, "title").strip()
    body = _field(entry, "body").strip()
    tag = _field(entry, "tag").strip()
    published = _field(entry, "publishedAt", "published_at")[:10]

    header = f"# {title}" if title else "# SparkPoint release note"
    lines = [header, ""]
    facts = []
    if published:
        facts.append(f"Published {published}")
    if tag:
        facts.append(f"Type: {tag}")
    facts.append("Source: the SparkPoint in-app changelog (a release note written for users)")
    lines.append(" · ".join(facts))
    if body:
        lines += ["", body]
    return "\n".join(lines).strip()


def entry_slug(entry: dict[str, Any]) -> str:
    """The stable source id for an entry — its slug, which the seed and the admin editor share."""
    slug = _field(entry, "slug").strip()
    # `list_changelog` does not project a slug; the bigserial id is stable and unique, so it is a
    # sound fallback — but prefer the slug where present so the seed and the database agree.
    return f"changelog-{slug}" if slug else f"changelog-{entry.get('id', 'unknown')}"


async def _is_already_indexed(store: ChunkStore, source: str, text: str) -> bool:
    """Whether this entry's chunks are already in the corpus, byte-identical.

    Embedding is a paid network call, and this now runs on every boot — including the restarts
    that follow an unhealthy deploy. Re-embedding forty unchanged release notes each time is pure
    waste, and a crash loop would turn it into repeated waste against a third party.

    The comparison runs the REAL chunker over the rendered text, so what it compares is exactly
    what an ingest would write — not an approximation of it. Anything unexpected (a store without
    the read, a DB error, no existing chunks) answers "not indexed", so the failure mode is a
    needless re-embed rather than a silently stale corpus.
    """
    reader = getattr(store, "get_source_chunks", None)
    if reader is None:
        return False
    try:
        existing = await reader(source)
    except Exception as exc:  # noqa: BLE001 — an unreadable corpus just means "re-index it"
        _logger.warning(
            "changelog_index_check_failed source=%s (%s: %s) — re-indexing",
            source, type(exc).__name__, exc,
        )
        return False
    if not existing:
        return False
    want = [c.text for c in chunk_note(parse_note(text, source=source))]
    return want == [h.content for h in existing]


async def ingest_changelog(
    source: ChangelogSource,
    *,
    store: ChunkStore,
    embedder: Embedder,
    limit: int = DEFAULT_LIMIT,
    source_ref: str | None = None,
) -> list[IngestResult]:
    """Index the published changelog so the assistant can answer from it.

    Best-effort by contract: a single entry that fails to embed is logged and skipped rather than
    aborting the run, because a partially-indexed changelog is strictly better than none and this
    is never on a user's path. Returns whatever was written — entries already indexed unchanged
    are skipped and therefore absent from the result.
    """
    entries = await source.list_changelog(limit)
    results: list[IngestResult] = []
    skipped = 0
    for entry in entries:
        text = render_entry(entry)
        if not text:
            continue
        if await _is_already_indexed(store, entry_slug(entry), text):
            skipped += 1
            continue
        try:
            results.append(
                await ingest_note(
                    text,
                    source=entry_slug(entry),
                    store=store,
                    embedder=embedder,
                    source_ref=source_ref,
                    source_kind=CHANGELOG_SOURCE_KIND,
                )
            )
        except Exception as exc:  # noqa: BLE001 — one bad entry must not cost the rest
            # Log the REASON. The first version logged only the slug, which made a real failure
            # indistinguishable from a shrug and cost a diagnosis round-trip.
            _logger.warning(
                "changelog_ingest_entry_failed id=%s title=%r (%s: %s) — skipped, the rest index",
                entry.get("id"),
                _field(entry, "title")[:60],
                type(exc).__name__,
                exc,
            )
    _logger.info(
        "changelog_ingest complete entries=%d indexed=%d unchanged=%d",
        len(entries), len(results), skipped,
    )
    return results
