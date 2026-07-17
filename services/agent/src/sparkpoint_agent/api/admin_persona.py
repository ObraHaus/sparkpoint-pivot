"""Admin persona console — view/edit/revert Sparky's persona sections, admin-gated.

Sits alongside the Obsidian knowledge console but is a DISTINCT, isolated surface. The persona is
Sparky's TRUSTED character (identity / soul / voice / boundaries / examples), composed into the
literacy agent's SYSTEM prompt — NOT the RAG corpus. So, unlike ``admin_knowledge``:

* there is NO embedder and NO chunks — a persona edit is just markdown (works even when the RAG
  embedder is unconfigured);
* a save/delete never touches ``memory_chunks`` — it upserts the isolated ``persona_notes`` table
  and then reloads the in-process persona (so the next chat turn reflects it, no redeploy).

Every route requires the caller's X-Owner to hold the ``admin`` role (a non-admin gets 404, the
same invisible posture as the other admin routes). Writes are PII/secret-scanned FIRST (422 on a
hit) and audit-logged. Access/knowledge only — never custody (N2).
"""

from __future__ import annotations

import logging
import os
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..db import get_database
from ..db.persona_notes import PersonaNoteStore
from ..knowledge import scan_for_pii
from ..persona import (
    PERSONA_SECTIONS,
    PERSONA_SLUGS,
    get_persona,
    reload_persona,
    seed_section,
)
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .security import AccountContext

logger = logging.getLogger(__name__)

router = APIRouter(tags=["admin-persona"])

_TITLE_BY_SLUG = {slug: title for slug, _f, title, _r in PERSONA_SECTIONS}
_REQUIRED_BY_SLUG = {slug: required for slug, _f, _t, required in PERSONA_SECTIONS}


def _store() -> PersonaNoteStore:
    return PersonaNoteStore(get_database())


def _git_sha() -> str:
    return os.environ.get("SPARKPOINT_GIT_SHA") or os.environ.get("GIT_SHA") or "admin-edit"


def _require_slug(slug: str) -> None:
    """Only the fixed persona sections are editable — an unknown slug is invisible (404)."""
    if slug not in PERSONA_SLUGS:
        raise ApiError(ErrorCode.NOT_FOUND, "Not found.", http_status=404)


async def _reload_persona_cache() -> None:
    """Recompose the live persona from seed + current overrides (best-effort; the write persisted).

    The DB write is what durably persists; the cache swap is a convenience so the next chat turn
    reflects the edit without a redeploy. A reload failure is logged, not surfaced.
    """
    try:
        reload_persona(await _store().overrides())
    except Exception:
        logger.warning("persona_reload_failed_after_write")


class PersonaPut(BaseModel):
    """``POST /admin/persona/{slug}`` body."""

    title: str = Field(min_length=1)
    markdown: str = Field(min_length=1)


@router.get("/admin/persona")
async def list_persona(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """The fixed persona sections, each flagged seed vs admin-override, + the live composed size."""
    notes = {n["source"]: n for n in await _store().list_notes()}
    sections = []
    for slug, _filename, title, required in PERSONA_SECTIONS:
        note = notes.get(slug)
        sections.append(
            {
                "slug": slug,
                "title": title,
                "required": required,
                "origin": "admin" if note else "seed",
                "has_seed": seed_section(slug) is not None,
                "author": (note or {}).get("author"),
                "updated_at": (note or {}).get("updated_at"),
            }
        )
    return {"sections": sections, "persona_chars": len(get_persona())}


@router.get("/admin/persona/audit")
async def persona_audit(
    admin: Annotated[AccountContext, Depends(require_admin)], limit: int = 50
) -> dict[str, Any]:
    """Recent persona-console changes (newest first). Declared BEFORE ``/{slug}`` so the literal
    path wins over the parameterised one."""
    return {"entries": await _store().recent_audit(limit)}


@router.get("/admin/persona/{slug}")
async def get_persona_section(
    slug: str, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """One section's shipped seed markdown (the revert baseline) + its admin override, if any."""
    _require_slug(slug)
    return {
        "slug": slug,
        "title": _TITLE_BY_SLUG[slug],
        "required": _REQUIRED_BY_SLUG[slug],
        "seed_markdown": seed_section(slug),  # None ⇒ no seed file ships this section
        "note": await _store().get_note(slug),  # None ⇒ seed-only (no override)
    }


@router.post("/admin/persona/{slug}")
async def put_persona_section(
    slug: str, body: PersonaPut, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Override a section: PII-scan FIRST (422), upsert the note, then reload the live persona.

    No embedding — persona is trusted SYSTEM content, not the RAG corpus. The override wins over the
    same-slug seed file until it is deleted (revert). Audited.
    """
    _require_slug(slug)
    found = scan_for_pii(body.markdown)
    if found:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR,
            f"Refusing to store PII/secret-shaped content ({', '.join(found)}).",
            http_status=422,
        )
    await _store().put(
        source=slug, title=body.title, markdown=body.markdown,
        author=admin.owner, git_sha=_git_sha(), audit_action="put",
    )
    await _reload_persona_cache()
    return {"ok": True, "slug": slug, "persona_chars": len(get_persona())}


@router.post("/admin/persona/{slug}/delete")
async def revert_persona_section(
    slug: str, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Drop a section's override — reverting it to the shipped seed — then reload. Audited."""
    _require_slug(slug)
    await _store().delete(slug, actor=admin.owner)
    await _reload_persona_cache()
    return {"ok": True, "slug": slug, "reverted_to": "seed"}
