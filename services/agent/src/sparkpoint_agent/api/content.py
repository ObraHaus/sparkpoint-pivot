"""Alpha content endpoints — the live changelog + the admin-configurable announcement.

Two surfaces (mirrors :mod:`api.allowlist`):
  * PUBLIC reads (``Depends(get_account)``, any beta wallet): ``GET /content/changelog`` and
    ``GET /content/announcement`` feed the ``/changelog`` page and the sidebar tip widget. NOT
    admin-gated and NOT on any status-exempt list — reached through the beta-gated BFF.
  * ADMIN writes (``Depends(require_admin)``, POST-only, audited): ``GET/POST /admin/content*``
    author both the changelog entries and the announcement. A non-admin gets 404 (invisible).

ACCESS/content only — never a signable artifact, never custody (N2).
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..db import get_database
from ..db.content_entries import ContentEntryStore
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext

router = APIRouter(tags=["content"])

ContentType = Literal["changelog", "announcement"]
ContentTag = Literal["New", "Fixed", "Improved", "Announcement"]


def get_content_store() -> ContentEntryStore:
    """The asyncpg-backed content store (production). Overridden with a fake in tests."""
    return ContentEntryStore(get_database())


class ContentWrite(BaseModel):
    """``POST /admin/content`` body: create (``id`` omitted) or edit (``id`` set)."""

    id: int | None = None
    type: ContentType
    title: str = Field(min_length=1, max_length=200)
    body: str = Field(min_length=1, max_length=4000)
    tag: ContentTag | None = None
    cta_label: str | None = Field(default=None, max_length=60)
    cta_href: str | None = Field(default=None, max_length=400)
    is_active: bool = True

    @field_validator("cta_href")
    @classmethod
    def _safe_href(cls, value: str | None) -> str | None:
        if value is None:
            return None
        candidate = value.strip()
        if not candidate:
            return None
        # The widget/page render this as a link — allow ONLY internal paths or https, never
        # javascript:/data: schemes.
        if not (candidate.startswith("/") or candidate.startswith("https://")):
            raise ValueError("cta_href must be an internal path ('/...') or an https:// URL")
        return candidate


class ContentDelete(BaseModel):
    """``POST /admin/content/delete`` body: ``{ id }``."""

    id: int


# ── Public reads (any beta wallet, NOT admin-gated; reached through the beta-gated BFF) ──


@router.get("/content/changelog")
async def public_changelog(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[ContentEntryStore, Depends(get_content_store)],
    limit: int = 50,
) -> dict[str, Any]:
    """Active changelog entries, newest first (the What's-New feed)."""
    return {"entries": await store.list_changelog(limit)}


@router.get("/content/announcement")
async def public_announcement(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[ContentEntryStore, Depends(get_content_store)],
) -> dict[str, Any]:
    """The single active announcement (or ``null``) for the sidebar widget."""
    return {"announcement": await store.active_announcement()}


# ── Admin writes (POST-only through the GET/POST BFF; non-admin → 404) ──


@router.get("/admin/content")
async def admin_list(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[ContentEntryStore, Depends(get_content_store)],
) -> dict[str, Any]:
    """Every entry (both types, active or not) for the admin editor, newest first."""
    return {"entries": await store.list_all()}


@router.post("/admin/content")
async def admin_upsert(
    body: ContentWrite,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[ContentEntryStore, Depends(get_content_store)],
) -> dict[str, Any]:
    """Create (id omitted) or edit (id set) a changelog entry / announcement. Audited."""
    if body.id is None:
        new_id = await store.create(
            type_=body.type, title=body.title, body=body.body, tag=body.tag,
            cta_label=body.cta_label, cta_href=body.cta_href, is_active=body.is_active,
            actor=admin.owner,
        )
        return {"ok": True, "id": new_id, "created": True}
    if await store.get(body.id) is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Not found.")
    await store.update(
        body.id, type_=body.type, title=body.title, body=body.body, tag=body.tag,
        cta_label=body.cta_label, cta_href=body.cta_href, is_active=body.is_active,
        actor=admin.owner,
    )
    return {"ok": True, "id": body.id, "created": False}


@router.post("/admin/content/delete")
async def admin_delete(
    body: ContentDelete,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[ContentEntryStore, Depends(get_content_store)],
) -> dict[str, Any]:
    """Delete an entry by id (POST, not DELETE — the BFF forwards only GET/POST). Audited."""
    if await store.get(body.id) is None:
        raise ApiError(ErrorCode.NOT_FOUND, "Not found.")
    await store.delete(body.id, actor=admin.owner)
    return {"ok": True, "id": body.id}


@router.get("/admin/content/audit")
async def admin_audit(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[ContentEntryStore, Depends(get_content_store)],
    limit: int = 50,
) -> dict[str, Any]:
    """Recent content-console changes (newest first)."""
    return {"entries": await store.recent_audit(limit)}
