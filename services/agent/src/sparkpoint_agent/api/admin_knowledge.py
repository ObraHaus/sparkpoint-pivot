"""§R2 admin Obsidian console — view/edit/delete/re-ingest the knowledge corpus, admin-gated.

Every route requires the caller's X-Owner to hold the ``admin`` role (a non-admin gets 404, same
invisible posture as the other admin routes). Writes are fail-closed: a note is PII/secret-scanned
FIRST (422 on a hit) and embedded ONLY with the real provider (503 if unset — never the stub), and
each mutation is audit-logged. This is a knowledge/access surface — it never touches custody (N2).
"""

from __future__ import annotations

import asyncio
import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..db import get_database
from ..db.knowledge_notes import KnowledgeNoteStore
from ..knowledge import (
    EMBEDDING_MODEL_VERSION,
    PgChunkStore,
    default_seed_dir,
    ingest_directory,
    ingest_note,
    openai_embedder,
    scan_for_pii,
    source_uuid,
)
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .security import AccountContext

router = APIRouter(tags=["admin-knowledge"])

_INGEST_TIMEOUT_S = 90.0


def _chunk_store() -> PgChunkStore:
    return PgChunkStore(get_database())


def _note_store() -> KnowledgeNoteStore:
    return KnowledgeNoteStore(get_database())


def _git_sha() -> str:
    return os.environ.get("SPARKPOINT_GIT_SHA") or os.environ.get("GIT_SHA") or "admin-edit"


def _require_embedder() -> Any:
    """The real embedder, or 503 — NEVER the stub (writing stub vectors would poison the space)."""
    embedder = openai_embedder()
    if embedder is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The embedding provider isn't configured; knowledge edits are unavailable.",
        )
    return embedder


class NotePut(BaseModel):
    """``PUT /admin/knowledge/sources/{source}`` body."""

    title: str = Field(min_length=1)
    markdown: str = Field(min_length=1)


@router.get("/admin/knowledge/sources")
async def list_sources(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """List every ingested note with provenance + origin (seed vs admin-edited)."""
    summaries = await _chunk_store().list_sources()
    notes = {n["source"]: n for n in await _note_store().list_notes()}
    merged = [
        {
            **s,
            "origin": notes.get(s["source"], {}).get("origin", "seed"),
            "author": notes.get(s["source"], {}).get("author"),
            "updated_at": notes.get(s["source"], {}).get("updated_at"),
        }
        for s in summaries
    ]
    return {"sources": merged}


@router.get("/admin/knowledge/sources/{source}")
async def get_source(
    source: str, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """The note's authoritative markdown (if console-authored) + its live ingested chunks."""
    note = await _note_store().get_note(source)
    chunks = await _chunk_store().get_source_chunks(source)
    return {
        "source": source,
        "note": note,  # None ⇒ seed-only (markdown lives in git, not the DB)
        "chunks": [{"content": c.content, "metadata": c.metadata} for c in chunks],
    }


# POST (not PUT): the same-origin BFF proxy forwards only GET/POST, so every mutation is a POST.
@router.post("/admin/knowledge/sources/{source}")
async def put_source(
    source: str, body: NotePut, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Add/edit a note: PII-scan FIRST (422), embed with the REAL provider (503 if unset),
    re-chunk + upsert, mark it admin-owned (wins over a same-slug seed on re-ingest). Audited."""
    found = scan_for_pii(body.markdown)
    if found:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Refusing to store PII/secret-shaped content ({', '.join(found)}).",
            http_status=422,
        )
    embedder = _require_embedder()
    git = _git_sha()
    try:
        result = await asyncio.wait_for(
            ingest_note(
                body.markdown,
                source=source,
                store=_chunk_store(),
                embedder=embedder,
                source_ref=git,
            ),
            timeout=_INGEST_TIMEOUT_S,
        )
    except TimeoutError as exc:
        raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, "Embedding timed out; try again.") from exc
    await _note_store().put(
        source=source, title=body.title, markdown=body.markdown, origin="admin",
        author=admin.owner, git_sha=git, audit_action="put",
    )
    return {"ok": True, "source": source, "chunks_written": result.written}


# POST (not DELETE): the BFF proxy forwards only GET/POST, so a delete is a POST to …/delete.
@router.post("/admin/knowledge/sources/{source}/delete")
async def delete_source(
    source: str, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Remove a note: prune all its chunks + delete the authoritative note. Audit-logged."""
    pruned = await _chunk_store().prune_source(source_uuid(source), [])
    await _note_store().delete(source, actor=admin.owner)
    return {"ok": True, "source": source, "chunks_pruned": pruned}


@router.post("/admin/knowledge/reingest")
async def reingest(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """Re-ingest the shipped seed corpus, SKIPPING admin-edited slugs (precedence). Audit-logged."""
    embedder = _require_embedder()
    notes = _note_store()
    skip = await notes.admin_sources()
    report = await asyncio.wait_for(
        ingest_directory(
            default_seed_dir(), store=_chunk_store(), embedder=embedder,
            skip_sources=skip, source_ref=_git_sha(),
        ),
        timeout=_INGEST_TIMEOUT_S * 4,
    )
    # One transaction for the whole re-ingest audit trail (atomic — never a half-written log, B5).
    await notes.record_many("reingest", [r.source for r in report.results], admin.owner)
    return {
        "ok": True,
        "ingested": [{"source": r.source, "written": r.written} for r in report.results],
        "skipped_admin_owned": sorted(skip),
    }


@router.get("/admin/knowledge/status")
async def status(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """Embedder health + corpus counts."""
    summaries = await _chunk_store().list_sources()
    notes = await _note_store().list_notes()
    return {
        "embedder_configured": openai_embedder() is not None,
        "model_version": EMBEDDING_MODEL_VERSION,
        "source_count": len(summaries),
        "chunk_count": sum(int(s["chunk_count"]) for s in summaries),
        "admin_notes": sum(1 for n in notes if n["origin"] == "admin"),
    }


@router.get("/admin/knowledge/audit")
async def audit(
    admin: Annotated[AccountContext, Depends(require_admin)], limit: int = 50
) -> dict[str, Any]:
    """Recent knowledge-console changes (newest first)."""
    return {"entries": await _note_store().recent_audit(limit)}
