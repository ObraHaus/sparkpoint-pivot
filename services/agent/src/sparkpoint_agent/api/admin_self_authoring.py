"""034 — the admin surface for Sparky's daily self-authoring.

Admin-gated like every other `/admin/*` route (a non-admin gets 404 — the same invisible posture).
The console is the only client, and it fills the whole section from one GET rather than five,
because this is a page an admin opens to check one number.

WHAT AN ADMIN CONTROLS HERE, AND WHY EACH IS A SETTING RATHER THAN A CONSTANT:

* **Which sources may be read**, including the prose domain allowlist. A source that starts
  publishing something we do not want quoted must be removable in minutes, not in a release.
* **Whether and when documents publish.** The client asked to watch what it writes before users do,
  and asked for that to stay adjustable rather than be a one-off.
* **Which unflattering findings have been released.** Editorial control, with the guard that a
  published document may not assert a claim a held finding contradicts.

This surface never touches custody (N2) and nothing it writes is read by the policy gate.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..db import get_database
from ..db.self_authoring import SelfAuthoringStore
from ..selfauthor.claims import STATUS_DISMISSED, STATUS_HELD, STATUS_RELEASED
from ..selfauthor.documents import STATUS_DRAFT, STATUS_PUBLISHED, STATUS_RETIRED
from ..selfauthor.settings import merge_patch, to_wire
from .allowlist import require_admin
from .errors import ApiError, ErrorCode
from .security import AccountContext

router = APIRouter(tags=["admin-self-authoring"])
_logger = logging.getLogger(__name__)

_DOC_STATUSES = {STATUS_DRAFT, STATUS_PUBLISHED, STATUS_RETIRED}
_FINDING_STATUSES = {STATUS_HELD, STATUS_RELEASED, STATUS_DISMISSED}


def _store() -> SelfAuthoringStore:
    return SelfAuthoringStore(get_database())


def _iso(value: Any) -> str | None:
    try:
        return str(value.isoformat())
    except AttributeError:
        return None


class SettingsPatch(BaseModel):
    """Every field optional: the console sends one at a time, and a PUT that reset the unmentioned
    fields would silently disable the feature whenever somebody adjusted the draft window."""

    enabled: bool | None = None
    publishMode: str | None = None
    draftWindowHours: int | None = None
    allowedDataSources: list[str] | None = None
    allowedProseDomains: list[str] | None = None


class DocumentPatch(BaseModel):
    title: str | None = None
    markdown: str | None = None
    status: str | None = None


class FindingPatch(BaseModel):
    status: str


@router.get("/admin/self-authoring")
async def overview(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """Everything the Self-authored section needs, in one round trip."""
    del admin
    store = _store()
    settings = await store.get_settings()
    updated_at, updated_by = await store.settings_updated()
    documents = await store.list_documents()
    findings = await store.list_findings()
    runs = await store.list_runs(limit=20)

    held = [f for f in findings if f.status == STATUS_HELD]
    oldest = min((f.created_at for f in held if f.created_at), default=None)

    return {
        "settings": {**to_wire(settings), "updatedAt": _iso(updated_at), "updatedBy": updated_by},
        "documents": [
            {
                "slug": d.slug,
                "title": d.title,
                "status": d.status,
                "markdown": d.markdown,
                "claimCount": len(d.claims),
                "firstWrittenAt": _iso(d.first_written_at),
                "updatedAt": _iso(d.updated_at),
                "publishedAt": _iso(d.published_at),
                "editedByAdmin": d.edited_by_admin,
            }
            for d in documents
        ],
        "findings": {
            # Count AND age: a growing pile of held findings is what turns editorial control into
            # silence, and a number that goes up is visible in a way that a list alone is not.
            "heldCount": len(held),
            "oldestHeldAt": _iso(oldest),
            "items": [
                {
                    "id": f.id,
                    "topic": f.topic,
                    "summary": f.summary,
                    "status": f.status,
                    "createdAt": _iso(f.created_at),
                }
                for f in findings
            ],
        },
        "runs": [
            {
                "id": r.id,
                "trigger": r.trigger,
                "startedAt": _iso(r.started_at),
                "finishedAt": _iso(r.finished_at),
                "outcome": r.outcome,
                "detail": r.detail,
                "stats": r.stats,
            }
            for r in runs
        ],
    }


@router.put("/admin/self-authoring/settings")
async def put_settings(
    body: SettingsPatch, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Update settings. Validation errors NAME the offending value.

    An admin who typed `https://docs.aave.com/v3` into the domain list needs to be told it was
    rejected — silently coercing it to the bare host would leave them believing a path restriction
    is in force when none is.
    """
    store = _store()
    patch: dict[str, Any] = {}
    if body.enabled is not None:
        patch["enabled"] = body.enabled
    if body.publishMode is not None:
        patch["publish_mode"] = body.publishMode
    if body.draftWindowHours is not None:
        patch["draft_window_hours"] = body.draftWindowHours
    if body.allowedDataSources is not None:
        patch["allowed_data_sources"] = body.allowedDataSources
    if body.allowedProseDomains is not None:
        patch["allowed_prose_domains"] = body.allowedProseDomains

    current = await store.get_settings()
    try:
        updated = merge_patch(current, patch)
    except ValueError as exc:
        raise ApiError(ErrorCode.VALIDATION_ERROR, str(exc)) from exc

    await store.put_settings(updated, actor=admin.owner)
    _logger.info(
        "self_authoring_settings_changed by=%s enabled=%s mode=%s window=%sh sources=%d domains=%d",
        admin.owner, updated.enabled, updated.publish_mode, updated.draft_window_hours,
        len(updated.allowed_data_sources), len(updated.allowed_prose_domains),
    )
    return to_wire(updated)


@router.post("/admin/self-authoring/run")
async def trigger_run(admin: Annotated[AccountContext, Depends(require_admin)]) -> dict[str, Any]:
    """Run now, in the background.

    Returns immediately: the request never waits on an embedding provider or a model. A run already
    in flight declines — pressing the button twice is an ordinary thing an admin does, so a refusal
    is an ordinary answer rather than an error.
    """
    del admin
    from ..selfauthor.run import OUTCOME_DISABLED

    store = _store()
    settings = await store.get_settings()
    if not settings.enabled:
        return {"runId": None, "outcome": OUTCOME_DISABLED}

    from .self_authoring_runner import run_once

    task = asyncio.create_task(run_once(trigger="manual"))
    # Hold a reference so the task is not garbage-collected mid-flight; discard it when done.
    _BACKGROUND.add(task)
    task.add_done_callback(_BACKGROUND.discard)
    return {"runId": None, "outcome": "started", "startedAt": time.time()}


_BACKGROUND: set[asyncio.Task[Any]] = set()


@router.put("/admin/self-authoring/documents/{slug}")
async def put_document(
    slug: str, body: DocumentPatch, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Read, edit, publish, unpublish. An admin edit is flagged so the next run can report that it
    replaced hand-written text rather than overwriting it invisibly."""
    if body.status is not None and body.status not in _DOC_STATUSES:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"status must be one of {sorted(_DOC_STATUSES)}")

    store = _store()
    existing = await store.get_document(slug)
    if existing is None:
        raise ApiError(ErrorCode.NOT_FOUND, "No such document.")

    ok = await store.set_document_fields(
        slug,
        title=body.title,
        markdown=body.markdown,
        status=body.status,
        by_admin=body.markdown is not None,
    )
    if not ok:
        raise ApiError(ErrorCode.NOT_FOUND, "No such document.")

    from .self_authoring_runner import publish_document, unpublish_document

    updated = await store.get_document(slug)
    if updated is not None:
        if updated.status == STATUS_PUBLISHED:
            await publish_document(updated.slug, updated.title, updated.markdown)
        else:
            await unpublish_document(updated.slug)

    # Address-free logs (065): the audit table records WHO acted; the line does not need the wallet.
    _logger.info("self_authoring_document_edited slug=%s", slug)
    return {"ok": True, "slug": slug, "status": updated.status if updated else None}


@router.delete("/admin/self-authoring/documents/{slug}")
async def delete_document(
    slug: str, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Delete the row and prune its chunks. The next run may recreate it if its evidence supports
    it — an empty self-authored corpus is a valid state, not a broken one."""
    from .self_authoring_runner import unpublish_document

    store = _store()
    await unpublish_document(slug)
    removed = await store.delete_document(slug)
    _logger.info("self_authoring_document_deleted slug=%s removed=%s", slug, removed)
    return {"ok": True, "removed": removed}


@router.post("/admin/self-authoring/findings/{finding_id}")
async def resolve_finding(
    finding_id: int, body: FindingPatch, admin: Annotated[AccountContext, Depends(require_admin)]
) -> dict[str, Any]:
    """Release, dismiss, or re-hold a finding.

    Releasing lets the next run assert claims on that topic; dismissing means it never will. Both
    record who acted and when, because "why did we stop saying that" is a question somebody asks
    six months later.
    """
    if body.status not in _FINDING_STATUSES:
        raise ApiError(
            ErrorCode.VALIDATION_ERROR, f"status must be one of {sorted(_FINDING_STATUSES)}"
        )
    store = _store()
    ok = await store.resolve_finding(finding_id, status=body.status, actor=admin.owner)
    if not ok:
        raise ApiError(ErrorCode.NOT_FOUND, "No such finding.")
    _logger.info("self_authoring_finding_%s id=%d", body.status, finding_id)
    return {"ok": True, "id": finding_id, "status": body.status}
