"""Alpha sidebar TIP widget endpoint — a KEYLESS read of curated tips from the Obsidian corpus.

Tips live in ``memory_chunks`` under ``source_kind='tip'`` (migration 0012), isolated from the
assistant's ``'knowledge'`` RAG citations. This returns up to N RANDOM active tips WITHOUT an
embedding or LLM call. Any beta wallet may read (reached through the beta-gated BFF, which injects
identity + s2s); it must NOT be added to any status-exempt list. ACCESS only — never custody (N2).
"""

from __future__ import annotations

import asyncio
import re
from typing import Annotated, Any, Protocol

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..db import get_database
from ..knowledge import (
    TIP_SOURCE_KIND,
    ChunkHit,
    PgChunkStore,
    ingest_directory,
    ingest_note,
    openai_embedder,
    scan_for_pii,
    source_uuid,
    tips_seed_dir,
)
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext

router = APIRouter(tags=["tips"])

_MAX_TIPS = 12
_INGEST_TIMEOUT_S = 120.0
_ADMIN_INGEST_TIMEOUT_S = 30.0


def _slugify(text: str) -> str:
    return re.sub(r"-+", "-", re.sub(r"[^a-z0-9]+", "-", text.strip().lower())).strip("-")


def _tip_markdown(title: str, body: str, cta_label: str | None, cta_href: str | None,
                  active: bool) -> str:
    """Build a tip note (frontmatter + H1 + body) the ingest pipeline parses into a single chunk."""
    lines = ["---", f"title: {title}"]
    if cta_href and cta_label:
        lines += [f"cta_url: {cta_href}", f"cta_label: {cta_label}"]
    lines += [f"active: {'true' if active else 'false'}", "---", "", f"# {title}", "", body]
    return "\n".join(lines)


def _reconstruct_tip(content: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Reconstruct the editable tip {source, title, body, ctaLabel, ctaHref, active} from a chunk.

    The lead chunk text is ``"Title\n\nBody"`` (see chunk_note); strip the title prefix off the
    body. ``active`` is true unless metadata says ``'false'``."""
    title = str(metadata.get("title") or "").strip()
    body = content
    prefix = f"{title}\n\n"
    if title and body.startswith(prefix):
        body = body[len(prefix):]
    return {
        "source": str(metadata.get("source") or ""),
        "title": title,
        "body": body.strip(),
        "ctaLabel": (str(metadata["cta_label"]) if metadata.get("cta_label") else None),
        "ctaHref": (str(metadata["cta_url"]) if metadata.get("cta_url") else None),
        "active": str(metadata.get("active") or "true") != "false",
    }


class TipReader(Protocol):
    """The narrow read the tips endpoint needs (``PgChunkStore`` satisfies it; a fake in tests)."""

    async def list_tips(self, limit: int) -> list[ChunkHit]: ...


def get_tip_store() -> TipReader:
    """The tip-scoped chunk store (production). Overridden with a fake in tests."""
    return PgChunkStore(get_database(), source_kind=TIP_SOURCE_KIND)


def _to_tip(content: str, metadata: dict[str, Any]) -> dict[str, Any]:
    """Split a tip chunk into ``{title, body, ctaLabel, ctaHref}``. The chunk text is
    ``"Title\n\nBody"`` (see ``chunk_note``); prefer the metadata title and strip the title prefix
    off the body so the widget never renders the title twice."""
    title = str(metadata.get("title") or "").strip()
    body = content
    prefix = f"{title}\n\n"
    if title and body.startswith(prefix):
        body = body[len(prefix):]
    return {
        "title": title or "Tip",
        "body": body.strip(),
        "ctaLabel": (str(metadata["cta_label"]) if metadata.get("cta_label") else None),
        "ctaHref": (str(metadata["cta_url"]) if metadata.get("cta_url") else None),
    }


@router.get("/tips")
async def list_tips(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[TipReader, Depends(get_tip_store)],
    limit: int = 5,
) -> dict[str, Any]:
    """Up to ``limit`` (capped) random active tips for the widget. Keyless — no LLM/embed call."""
    count = max(1, min(limit, _MAX_TIPS))
    hits = await store.list_tips(count)
    return {"tips": [_to_tip(hit.content, hit.metadata) for hit in hits]}


@router.post("/admin/tips/reingest")
async def reingest_tips(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """Re-ingest the shipped tip seed dir into the Obsidian corpus under ``source_kind='tip'``.

    Admin-gated (non-admin → 404). PII-scanned + embedded with the REAL provider only (503 if
    unset — never stub vectors). Mirrors ``/admin/knowledge/reingest`` but for the tip databank."""
    embedder = openai_embedder()
    if embedder is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The embedding provider isn't configured; tip ingest is unavailable.",
        )
    store = PgChunkStore(get_database(), source_kind=TIP_SOURCE_KIND)
    report = await asyncio.wait_for(
        ingest_directory(
            tips_seed_dir(), store=store, embedder=embedder, source_kind=TIP_SOURCE_KIND
        ),
        timeout=_INGEST_TIMEOUT_S,
    )
    return {
        "ok": True,
        "ingested": [{"source": r.source, "written": r.written} for r in report.results],
    }


# ── Admin tip manager (list / create-edit / delete) — writes to the Obsidian 'tip' corpus ──


def get_tip_admin_store() -> PgChunkStore:
    """The mutable tip-scoped chunk store (production). Overridden with a fake in tests."""
    return PgChunkStore(get_database(), source_kind=TIP_SOURCE_KIND)


def _require_embedder() -> Any:
    """The real embedder, or 503 — NEVER a stub (a stub vector would poison the space)."""
    embedder = openai_embedder()
    if embedder is None:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The embedding provider isn't configured; tip edits are unavailable.",
        )
    return embedder


class TipWrite(BaseModel):
    """``POST /admin/tips`` body: create (``source`` omitted) or edit (``source`` set)."""

    source: str | None = None
    title: str = Field(min_length=1, max_length=80)
    body: str = Field(min_length=1, max_length=400)
    cta_label: str | None = Field(default=None, max_length=40)
    cta_href: str | None = Field(default=None, max_length=400)
    active: bool = True

    @field_validator("cta_href")
    @classmethod
    def _safe_href(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            return None
        if not (candidate.startswith("/") or candidate.startswith("https://")):
            raise ValueError("cta_href must be an internal path ('/...') or an https:// URL")
        return candidate


class TipDelete(BaseModel):
    """``POST /admin/tips/delete`` body: ``{ source }``."""

    source: str = Field(min_length=1)


@router.get("/admin/tips")
async def admin_list_tips(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgChunkStore, Depends(get_tip_admin_store)],
) -> dict[str, Any]:
    """Every tip (active or not) as editable records for the admin manager."""
    hits = await store.list_all_tips()
    return {"tips": [_reconstruct_tip(h.content, h.metadata) for h in hits]}


@router.post("/admin/tips")
async def admin_upsert_tip(
    body: TipWrite,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgChunkStore, Depends(get_tip_admin_store)],
) -> dict[str, Any]:
    """Create (source omitted → slug from title) or edit (source set) a tip in the Obsidian corpus.

    PII-scanned FIRST (422), embedded with the REAL provider only (503 if unset — never stub), then
    upserted under ``source_kind='tip'``. The sidebar widget reads it on its next poll. The chunk IS
    the source of truth for a single-note tip (no separate ledger)."""
    slug = (body.source or _slugify(body.title)).strip()
    if not slug:
        raise ApiError(ErrorCode.VALIDATION_ERROR, "Couldn't derive a tip id from the title.")
    markdown = _tip_markdown(body.title, body.body, body.cta_label, body.cta_href, body.active)
    found = scan_for_pii(markdown)
    if found:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Refusing to store PII/secret-shaped content ({', '.join(found)}).",
            http_status=422,
        )
    embedder = _require_embedder()
    try:
        result = await asyncio.wait_for(
            ingest_note(
                markdown, source=slug, store=store, embedder=embedder,
                source_kind=TIP_SOURCE_KIND,
            ),
            timeout=_ADMIN_INGEST_TIMEOUT_S,
        )
    except TimeoutError as exc:
        raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, "Embedding timed out; try again.") from exc
    return {"ok": True, "source": slug, "chunks_written": result.written}


@router.post("/admin/tips/delete")
async def admin_delete_tip(
    body: TipDelete,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[PgChunkStore, Depends(get_tip_admin_store)],
) -> dict[str, Any]:
    """Delete a tip: prune all its chunks from the corpus (POST, not DELETE — BFF is GET/POST)."""
    pruned = await store.prune_source(source_uuid(body.source), [])
    return {"ok": True, "source": body.source, "chunks_pruned": pruned}
