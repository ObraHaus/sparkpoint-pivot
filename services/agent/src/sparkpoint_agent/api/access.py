"""Feature 026 - alpha access applications: apply, check your own status, admin review.

Before this, a wallet that wasn't on the beta allowlist hit a DEAD END at /verify. Now it can
apply. Two surfaces:

  * ``/access/*`` - the applicant's OWN application (submit + read status). This is the ONE write
    surface a non-beta wallet is granted, so it is deliberately minimal: the owner is derived
    server-side (never a body field), there is exactly one application per wallet (upsert), fields
    are length-capped, and nothing here grants any access. The BFF's beta gate carries a narrow
    exemption for this prefix.
  * ``/access/public-application`` - feature 045, the LANDING-PAGE form. No session, no signature:
    the applicant types their own address. See the route for why it is shaped so differently.
  * ``/admin/access/applications*`` - list / approve / deny, behind the existing ``require_admin``
    (a non-admin gets **404, not 403** - the surface must not be discoverable).

APPROVING is just the existing allowlist add: ``AllowlistStore.add(address, 'beta')``, audit-logged
exactly like a manual add. This table is a record, never an authority. Nothing here is ever on the
custody path - /exit, /trust and the on-chain withdraw are never gated by it (N2).
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from ..db import get_database
from ..db.access_applications import (
    MAX_CONTACT,
    MAX_NAME,
    MAX_REASON,
    AccessApplicationStore,
)
from ..db.allowlist import BETA_ROLE, AllowlistStore
from ..db.mint_whitelist import MintWhitelistStore
from .allowlist import get_allowlist_store, require_admin
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext, is_valid_account_identifier

router = APIRouter(tags=["access"])

#: Control characters and angle brackets are stripped at the edge: these fields are rendered in the
#: admin panel, and the only safe input is input that was never dangerous.
_STRIP_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f<>]")


def get_application_store() -> AccessApplicationStore:
    """The asyncpg-backed application store (production). Overridden with a fake in tests."""
    return AccessApplicationStore(get_database())


def get_mint_whitelist_store() -> MintWhitelistStore:
    """The asyncpg-backed Sparky Broker mint whitelist store. Overridden with a fake in tests."""
    return MintWhitelistStore(get_database())


def _clean(value: str, *, cap: int, label: str) -> str:
    cleaned = _STRIP_RE.sub("", value).strip()
    if not cleaned:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"{label} is required.")
    if len(cleaned) > cap:
        raise ApiError(ErrorCode.VALIDATION_ERROR, f"{label} must be {cap} characters or fewer.")
    return cleaned


class ApplicationSubmit(BaseModel):
    """The applicant's three client-decided fields. The WALLET is never a body field."""

    contact: str = Field(max_length=MAX_CONTACT * 2)
    name: str = Field(max_length=MAX_NAME * 2)
    reason: str = Field(max_length=MAX_REASON * 2)


class ApplicationDecision(BaseModel):
    """``POST /admin/access/applications/{approve,deny}`` body: ``{ address }``."""

    address: str

    @field_validator("address")
    @classmethod
    def _validate_address(cls, value: str) -> str:
        candidate = value.strip()
        if not is_valid_account_identifier(candidate):
            raise ValueError("address must be a 20-byte 0x address or a NEAR account id")
        return candidate


@router.post("/access/application", status_code=201)
async def submit_application(
    body: ApplicationSubmit,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[AccessApplicationStore, Depends(get_application_store)],
) -> dict[str, object]:
    """Submit (or re-submit) THIS wallet's alpha access application.

    Owner-scoped: the application is always filed against ``account.owner``, so a wallet can never
    apply on another's behalf. Re-submitting overwrites the applicant's own answers and re-opens a
    denied application; an APPROVED one is never reverted by a re-submit.
    """
    contact = _clean(body.contact, cap=MAX_CONTACT, label="A contact handle")
    name = _clean(body.name, cap=MAX_NAME, label="A name or alias")
    reason = _clean(body.reason, cap=MAX_REASON, label="A reason for access")
    stored = await store.submit(
        address=account.owner, contact=contact, display_name=name, reason=reason
    )
    return {"ok": True, "application": stored.to_wire()}


class PublicApplicationSubmit(ApplicationSubmit):
    """The landing-page form's body. Here the wallet IS a body field — there is nothing else."""

    address: str

    @field_validator("address")
    @classmethod
    def _validate_address(cls, value: str) -> str:
        candidate = value.strip()
        if not is_valid_account_identifier(candidate):
            raise ValueError("address must be a 20-byte 0x address or a NEAR account id")
        return candidate


@router.post("/access/public-application")
async def submit_public_application(
    body: PublicApplicationSubmit,
    store: Annotated[AccessApplicationStore, Depends(get_application_store)],
) -> dict[str, object]:
    """Apply for alpha access WITHOUT connecting a wallet (045).

    ``/access/application`` above only exists for someone who has already signed in — which is
    nobody who needs it. A visitor with no access has no reason to connect a wallet to a product
    they cannot use, and connecting only to be told "no" is a dead end with extra steps. This is the
    form on the landing page: type your address, tell us how to reach you.

    Three things follow from being unauthenticated, and each is a deliberate constraint:

    * **The address is SELF-DECLARED.** Nobody signed anything, so this is a claim, not a proof. It
      is stored with ``source='public'`` and the admin panel labels it, because approving one grants
      beta to an address whose owner never demonstrated control.
    * **The response is IDENTICAL in every case.** A new application, a duplicate, an address that
      is already approved, an address on the allowlist already — all return the same ``{"ok": true,
      "received": true}``. Any difference would let an anonymous caller probe who has applied or who
      has access, and this endpoint is not entitled to answer that.
    * **An existing application is never touched** (see ``submit_public``). Anyone can type anyone's
      address here, so a write that could modify an existing row would let a stranger overwrite a
      real applicant's contact details. First application wins.

    Nothing here grants anything: an application is a request for a human to look at, and the only
    thing that opens access is still an admin pressing approve. Never on the custody path (N2).
    """
    contact = _clean(body.contact, cap=MAX_CONTACT, label="A contact handle")
    name = _clean(body.name, cap=MAX_NAME, label="A name or alias")
    reason = _clean(body.reason, cap=MAX_REASON, label="A reason for access")
    await store.submit_public(
        address=body.address, contact=contact, display_name=name, reason=reason
    )
    # `submit_public`'s return value is deliberately dropped: the caller learns only that we took
    # the form, never whether it changed anything.
    return {"ok": True, "received": True}


@router.post("/access/mint-whitelist")
async def submit_mint_whitelist(
    body: PublicApplicationSubmit,
    store: Annotated[MintWhitelistStore, Depends(get_mint_whitelist_store)],
) -> dict[str, object]:
    """Apply for the Sparky Broker MINT whitelist WITHOUT connecting a wallet.

    The same public shape as ``/access/public-application`` — no session, no signature, the
    address typed by hand — but for a different decision: an operator adds these addresses to the
    SeaDrop GTD/FCFS allowlist so the applicant mints early at the allowlist price. It does NOT
    grant app access (that is ``/access/public-application`` + the beta allowlist) and it does not
    put anything on-chain; approving one is a human uploading a list.

    The same constraints follow from being unauthenticated, for the same reasons: the address is
    SELF-DECLARED and stored as such, the response is IDENTICAL for a new, duplicate, or unknown
    address (no enumeration oracle), and an existing row is never modified (first submission wins,
    so a stranger cannot overwrite a real applicant's contact details). Never on the custody path.
    """
    contact = _clean(body.contact, cap=MAX_CONTACT, label="A contact handle")
    name = _clean(body.name, cap=MAX_NAME, label="A name or alias")
    reason = _clean(body.reason, cap=MAX_REASON, label="A reason for the whitelist")
    await store.submit(address=body.address, contact=contact, display_name=name, reason=reason)
    # The store's return value is deliberately dropped — see `submit_public_application`.
    return {"ok": True, "received": True}


@router.get("/admin/access/mint-whitelist")
async def admin_list_mint_whitelist(
    admin: Annotated[AccountContext, Depends(require_admin)],  # noqa: ARG001 (gates the route)
    store: Annotated[MintWhitelistStore, Depends(get_mint_whitelist_store)],
    limit: int = 500,
) -> dict[str, object]:
    """List Sparky Broker mint whitelist applications, newest first (admin-gated; 404 otherwise).

    This is the list the operator exports to the SeaDrop allowlist. There is no approve/deny
    action here on purpose: nothing in this app decides who is on-chain, and a status flip that
    did not change the actual allowlist would be a lie.
    """
    rows = await store.list(limit=limit)
    return {"applications": [r.to_wire() for r in rows]}


@router.get("/access/application")
async def my_application(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[AccessApplicationStore, Depends(get_application_store)],
) -> dict[str, object]:
    """Read THIS wallet's own application (``application: null`` when it hasn't applied)."""
    stored = await store.get(account.owner)
    return {"application": stored.to_wire() if stored else None}


@router.get("/admin/access/applications")
async def admin_list_applications(
    admin: Annotated[AccountContext, Depends(require_admin)],  # noqa: ARG001 (gates the route)
    store: Annotated[AccessApplicationStore, Depends(get_application_store)],
    status: Literal["pending", "approved", "denied"] | None = None,
    limit: int = 100,
) -> dict[str, object]:
    """List applications, newest first (admin-gated; 404 to a non-admin)."""
    rows = await store.list(status=status, limit=limit)
    return {"applications": [r.to_wire() for r in rows]}


@router.post("/admin/access/applications/approve")
async def admin_approve(
    body: ApplicationDecision,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[AccessApplicationStore, Depends(get_application_store)],
    allowlist: Annotated[AllowlistStore, Depends(get_allowlist_store)],
) -> dict[str, object]:
    """Approve: grant the ``beta`` role (the real gate), then record the decision.

    The allowlist add happens FIRST and is audit-logged by the allowlist store exactly like a manual
    add — if the status flip fails, the applicant still has access rather than a silent no-op.
    """
    address = body.address.lower()
    await allowlist.add(address, BETA_ROLE, actor=admin.owner)
    await store.decide(address=address, approve=True, actor=admin.owner)
    return {"ok": True, "address": address, "status": "approved"}


@router.post("/admin/access/applications/deny")
async def admin_deny(
    body: ApplicationDecision,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[AccessApplicationStore, Depends(get_application_store)],
) -> dict[str, object]:
    """Deny an application. Grants nothing and REVOKES nothing — it only records the decision."""
    address = body.address.lower()
    await store.decide(address=address, approve=False, actor=admin.owner)
    return {"ok": True, "address": address, "status": "denied"}
