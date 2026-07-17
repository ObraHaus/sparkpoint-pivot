"""Alpha sidebar TIP widget endpoint — a KEYLESS read of curated tips from the Obsidian corpus.

Tips live in ``memory_chunks`` under ``source_kind='tip'`` (migration 0012), isolated from the
assistant's ``'knowledge'`` RAG citations. This returns up to N RANDOM active tips WITHOUT an
embedding or LLM call. Any beta wallet may read (reached through the beta-gated BFF, which injects
identity + s2s); it must NOT be added to any status-exempt list. ACCESS only — never custody (N2).
"""

from __future__ import annotations

import asyncio
from typing import Annotated, Any, Protocol

from fastapi import APIRouter, Depends

from ..db import get_database
from ..knowledge import (
    TIP_SOURCE_KIND,
    ChunkHit,
    PgChunkStore,
    ingest_directory,
    openai_embedder,
    tips_seed_dir,
)
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext

router = APIRouter(tags=["tips"])

_MAX_TIPS = 12
_INGEST_TIMEOUT_S = 120.0


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
