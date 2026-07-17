"""T122 — parse Obsidian markdown → chunk → embed → upsert into ``memory_chunks``.

Pipeline (advisory tier only):
  1. :func:`parse_note` — split YAML-ish frontmatter, the H1 title, ``[[wikilinks]]``
     and the H2 sections out of an Obsidian markdown note.
  2. :func:`chunk_note` — one chunk per section (long sections split on blank lines),
     each carrying the note's provenance (source, title, section, tags, wikilinks).
  3. :func:`ingest_note` — embed the chunk texts via the shared T124 :class:`Embedder`
     and upsert them into ``memory_chunks`` behind the :class:`ChunkStore` seam.

Idempotency: every chunk's primary key is a deterministic UUID5 of ``(source, index)``
so a re-ingest overwrites in place; a trailing :meth:`ChunkStore.prune_source` drops
chunks left over from a shorter prior version of the same note.

NON-CUSTODY / boundary (T126): imports the stdlib + the shared ``embeddings`` embedder
+ the ``store`` seam ONLY. Never imports ``policy``/``agents``/``coordinator``.
"""

from __future__ import annotations

import asyncio
import os
import re
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, UUID, uuid5

from .embeddings import Embedder
from .store import ChunkRow, ChunkStore

# ─────────────────────────────────────────────────────────────────────────────
# T123 — pre-ingest PII/secret denylist + provenance stamp
# ─────────────────────────────────────────────────────────────────────────────


class PiiDetectedError(ValueError):
    """A note contains PII/secret-shaped content and must NOT enter the shared corpus (fail-closed).

    The message names the KIND(s) found, never the matched value, so it can be logged safely.
    """


# Content that must never be ingested. NOTE: 20-byte (40-hex) addresses are LEGITIMATE in notes
# (contract addresses) and are deliberately NOT matched — only unambiguously secret/PII shapes.
_PII_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("email", re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")),
    ("private_key_hex", re.compile(r"\b0x[0-9a-fA-F]{64}\b")),
    ("pem_private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
)


def scan_for_pii(text: str) -> list[str]:
    """Return the sorted KINDS of PII/secret found in ``text`` (never the values). Empty ⇒ clean."""
    return sorted({kind for kind, pat in _PII_PATTERNS if pat.search(text)})


def _provenance(source_ref: str | None) -> dict[str, str]:
    """The git commit + ingest timestamp stamped onto every chunk (T123 provenance). ``source_ref``
    (the git sha) falls back to ``SPARKPOINT_GIT_SHA``/``GIT_SHA`` env, else ``"unknown"``."""
    sha = (
        source_ref
        or os.environ.get("SPARKPOINT_GIT_SHA")
        or os.environ.get("GIT_SHA")
        or "unknown"
    )
    return {"git_sha": sha, "ingested_at": datetime.now(UTC).isoformat()}

# Namespace for the tier's deterministic ids — stable across processes/runs.
_KNOWLEDGE_NS = uuid5(NAMESPACE_URL, "sparkpoint://knowledge")

# Split long sections at blank lines once they exceed this many characters, so a
# single oversized section becomes several retrievable chunks.
_MAX_CHUNK_CHARS = 1200

_FRONTMATTER_RE = re.compile(r"\A---\n(?P<body>.*?)\n---\n?", re.DOTALL)
_WIKILINK_RE = re.compile(r"\[\[([^\]]+)\]\]")
_H1_RE = re.compile(r"^#\s+(?P<title>.+?)\s*$", re.MULTILINE)


def source_uuid(source: str) -> UUID:
    """The stable ``source_id`` for a note (all its chunks share it)."""
    return uuid5(_KNOWLEDGE_NS, source)


def chunk_uuid(source: str, index: int) -> UUID:
    """The stable primary key for chunk ``index`` of ``source`` (idempotent upsert key)."""
    return uuid5(_KNOWLEDGE_NS, f"{source}#{index}")


@dataclass(frozen=True)
class Section:
    """One H2 section of a note (the lead paragraph before any H2 is ``heading=""``)."""

    heading: str
    body: str


@dataclass(frozen=True)
class ParsedNote:
    """The structured form of one Obsidian markdown note."""

    source: str
    title: str
    frontmatter: dict[str, Any]
    wikilinks: tuple[str, ...]
    sections: tuple[Section, ...]
    tags: tuple[str, ...] = ()


@dataclass(frozen=True)
class Chunk:
    """One embeddable unit of a note plus the provenance carried into ``metadata``."""

    source: str
    title: str
    section: str
    text: str
    index: int
    tags: tuple[str, ...] = ()
    wikilinks: tuple[str, ...] = ()
    risk_tier: str | None = None
    updated: str | None = None

    def metadata(self) -> dict[str, Any]:
        """The ``memory_chunks.metadata`` JSONB payload for this chunk."""
        return {
            "source": self.source,
            "title": self.title,
            "section": self.section,
            "chunk_index": self.index,
            "tags": list(self.tags),
            "wikilinks": list(self.wikilinks),
            "risk_tier": self.risk_tier,
            "updated": self.updated,
            "tier": "obsidian",
        }


# ─────────────────────────────────────────────────────────────────────────────
# Parsing
# ─────────────────────────────────────────────────────────────────────────────


def _parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """Split a leading ``--- ... ---`` block into a dict + the remaining body.

    A deliberately minimal YAML subset (``key: scalar`` and ``key: [a, b]``) — enough
    for the seed corpus without pulling in a YAML dependency. Unknown lines are skipped.
    """
    match = _FRONTMATTER_RE.match(text)
    if match is None:
        return {}, text
    front: dict[str, Any] = {}
    for line in match.group("body").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        key, _, raw = stripped.partition(":")
        front[key.strip()] = _parse_scalar(raw.strip())
    return front, text[match.end() :]


def _parse_scalar(raw: str) -> Any:
    """Parse a frontmatter value: a ``[a, b]`` list or a plain (quote-stripped) scalar."""
    if raw.startswith("[") and raw.endswith("]"):
        inner = raw[1:-1].strip()
        if not inner:
            return []
        return [item.strip().strip("'\"") for item in inner.split(",") if item.strip()]
    return raw.strip("'\"")


def _split_sections(body: str) -> list[Section]:
    """Split note body into the lead paragraph + one :class:`Section` per H2 heading."""
    sections: list[Section] = []
    current_heading = ""
    current_lines: list[str] = []

    def flush() -> None:
        text = "\n".join(current_lines).strip()
        if text:
            sections.append(Section(heading=current_heading, body=text))

    for line in body.splitlines():
        h2 = re.match(r"^##\s+(?P<h>.+?)\s*$", line)
        h1 = re.match(r"^#\s+.+$", line)
        if h2 is not None:
            flush()
            current_heading = h2.group("h").strip()
            current_lines = []
        elif h1 is not None:
            # The H1 title line is captured separately; drop it from section bodies.
            continue
        else:
            current_lines.append(line)
    flush()
    return sections


def parse_note(text: str, *, source: str) -> ParsedNote:
    """Parse an Obsidian markdown note into a :class:`ParsedNote`.

    ``source`` is the stable slug (typically the filename stem) used to derive the
    tier's deterministic ids.
    """
    frontmatter, body = _parse_frontmatter(text)
    title_match = _H1_RE.search(body)
    title = (
        str(frontmatter.get("title"))
        if frontmatter.get("title")
        else (title_match.group("title").strip() if title_match else source)
    )
    wikilinks = tuple(
        dict.fromkeys(  # de-dup, preserve order
            link.split("|", 1)[0].strip() for link in _WIKILINK_RE.findall(text)
        )
    )
    raw_tags = frontmatter.get("tags")
    tags: tuple[str, ...]
    if isinstance(raw_tags, list):
        tags = tuple(str(t) for t in raw_tags)
    elif isinstance(raw_tags, str) and raw_tags:
        tags = (raw_tags,)
    else:
        tags = ()
    return ParsedNote(
        source=source,
        title=title,
        frontmatter=frontmatter,
        wikilinks=wikilinks,
        sections=tuple(_split_sections(body)),
        tags=tags,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Chunking
# ─────────────────────────────────────────────────────────────────────────────


def _split_long(body: str) -> list[str]:
    """Split an oversized section body on blank lines into <= _MAX_CHUNK_CHARS pieces."""
    if len(body) <= _MAX_CHUNK_CHARS:
        return [body]
    paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
    pieces: list[str] = []
    buffer = ""
    for para in paragraphs:
        candidate = f"{buffer}\n\n{para}" if buffer else para
        if len(candidate) > _MAX_CHUNK_CHARS and buffer:
            pieces.append(buffer)
            buffer = para
        else:
            buffer = candidate
    if buffer:
        pieces.append(buffer)
    return pieces or [body]


def chunk_note(note: ParsedNote) -> list[Chunk]:
    """Turn a parsed note into ordered, embeddable :class:`Chunk`s (one+ per section).

    Each chunk's text is prefixed with the note title + section heading so the embedded
    text (and the retrieved snippet) is self-describing.
    """
    risk_tier = note.frontmatter.get("risk_tier")
    updated = note.frontmatter.get("updated")
    chunks: list[Chunk] = []
    index = 0
    for section in note.sections:
        for piece in _split_long(section.body):
            heading = section.heading or note.title
            if section.heading:
                text = f"{note.title} — {heading}\n\n{piece}"
            else:
                text = f"{note.title}\n\n{piece}"
            chunks.append(
                Chunk(
                    source=note.source,
                    title=note.title,
                    section=heading,
                    text=text,
                    index=index,
                    tags=note.tags,
                    wikilinks=note.wikilinks,
                    risk_tier=str(risk_tier) if risk_tier is not None else None,
                    updated=str(updated) if updated is not None else None,
                )
            )
            index += 1
    return chunks


# ─────────────────────────────────────────────────────────────────────────────
# Ingestion
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class IngestResult:
    """Per-note outcome: how many chunks were written and how many stale ones pruned."""

    source: str
    written: int
    pruned: int = 0


async def ingest_note(
    text: str,
    *,
    source: str,
    store: ChunkStore,
    embedder: Embedder,
    source_ref: str | None = None,
) -> IngestResult:
    """Parse → chunk → embed → upsert one note; idempotent for a fixed ``source``.

    The same ``(source, text)`` always yields the same row ids, so re-running updates
    in place; a shortened note has its now-orphaned chunks pruned. FAIL-CLOSED on PII: a note
    with secret/PII-shaped content is refused (never embedded). Every chunk is stamped with the
    git sha (``source_ref``) + ingest timestamp for provenance (T123).
    """
    found = scan_for_pii(text)
    if found:
        raise PiiDetectedError(
            f"note {source!r} contains PII/secret-shaped content "
            f"({', '.join(found)}); refusing to ingest"
        )
    note = parse_note(text, source=source)
    chunks = chunk_note(note)
    sid = source_uuid(source)
    if not chunks:
        pruned = await store.prune_source(sid, [])
        return IngestResult(source=source, written=0, pruned=pruned)

    provenance = _provenance(source_ref)
    # The backend embed is a synchronous network call — run it OFF the event loop so an ingest
    # (incl. an admin-console PUT on the request path) never blocks request serving.
    embeddings = await asyncio.to_thread(embedder.embed, [c.text for c in chunks])
    rows = [
        ChunkRow(
            id=chunk_uuid(source, chunk.index),
            source_id=sid,
            content=chunk.text,
            embedding=emb.vector,
            embedding_model=emb.model_version,
            metadata={**chunk.metadata(), **provenance},
        )
        for chunk, emb in zip(chunks, embeddings, strict=True)
    ]
    written = await store.upsert_chunks(rows)
    pruned = await store.prune_source(sid, [row.id for row in rows])
    return IngestResult(source=source, written=written, pruned=pruned)


@dataclass(frozen=True)
class CorpusReport:
    """Aggregate of a directory ingest — one :class:`IngestResult` per note."""

    results: tuple[IngestResult, ...] = field(default_factory=tuple)

    @property
    def total_written(self) -> int:
        return sum(r.written for r in self.results)


def read_corpus(path: str | Path, *, pattern: str = "*.md") -> list[tuple[str, str]]:
    """Read every markdown note under ``path`` into ``(source_slug, text)`` (sorted).

    The blocking filesystem IO is isolated here (sync) so :func:`ingest_directory` — which
    awaits embedding/DB work — performs no blocking Path calls of its own.
    """
    root = Path(path)
    return [
        (note_path.stem, note_path.read_text(encoding="utf-8"))
        for note_path in sorted(root.glob(pattern))
    ]


async def ingest_directory(
    path: str | Path,
    *,
    store: ChunkStore,
    embedder: Embedder,
    pattern: str = "*.md",
    skip_sources: set[str] | None = None,
    source_ref: str | None = None,
) -> CorpusReport:
    """Ingest every markdown note under ``path`` (sorted, stem = source slug).

    PRECEDENCE (R2): a source in ``skip_sources`` is NOT re-ingested — an admin-edited note of the
    same slug wins over the shipped seed. ``source_ref`` stamps the git sha onto every chunk.
    """
    skip = skip_sources or set()
    results: list[IngestResult] = []
    for source, text in read_corpus(path, pattern=pattern):
        if source in skip:
            continue
        results.append(
            await ingest_note(
                text, source=source, store=store, embedder=embedder, source_ref=source_ref
            )
        )
    return CorpusReport(results=tuple(results))


def default_seed_dir() -> Path:
    """Absolute path to the shipped seed corpus (``services/agent/knowledge_seed``)."""
    # knowledge/ingestion.py -> knowledge -> sparkpoint_agent -> src -> agent root
    return Path(__file__).resolve().parents[3] / "knowledge_seed"


def note_sources(chunks: Sequence[Chunk]) -> list[str]:
    """The distinct source slugs present in ``chunks`` (helper for callers/tests)."""
    return list(dict.fromkeys(c.source for c in chunks))
