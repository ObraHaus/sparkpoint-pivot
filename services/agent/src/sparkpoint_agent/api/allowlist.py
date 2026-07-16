"""§B beta/admin allowlist endpoints — the login status check + admin-gated management.

Two surfaces:
  * ``GET /allowlist/status`` — returns ``{beta, admin}`` for the caller-scoped wallet
    (``X-Owner``). NOT admin-gated: a caller may always learn its OWN status. This is what the
    web SIWE ``/verify`` step calls (s2s bearer + X-Owner = the just-verified wallet) to bake the
    role claims into the session cookie.
  * ``/admin/allowlist*`` — view/add/remove wallets + read the audit trail. Admin-gated on the
    caller's ``X-Owner`` (must hold the ``admin`` role). A non-admin gets **404, not 403**
    (defense-in-depth mirror of the web middleware — a non-admin must not learn the surface
    exists). Every write is audit-logged in the store.

Non-custody: this is an ACCESS gate only. It never returns a signable artifact and never gates
/exit, /trust, or the on-chain withdraw path (N2).
"""

from __future__ import annotations

import re
from typing import Annotated, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from ..db import get_database
from ..db.allowlist import ADMIN_ROLE, AllowlistStore
from .errors import ApiError, ErrorCode
from .mandate import get_account
from .security import AccountContext

router = APIRouter(tags=["allowlist"])

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
Role = Literal["beta", "admin"]


def get_allowlist_store() -> AllowlistStore:
    """The asyncpg-backed allowlist store (production). Overridden with a fake in tests."""
    return AllowlistStore(get_database())


async def require_admin(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[AllowlistStore, Depends(get_allowlist_store)],
) -> AccountContext:
    """Gate admin routes on the caller's ``X-Owner`` holding the ``admin`` role.

    Raises ``NOT_FOUND`` (404) — never 403 — so a non-admin cannot even confirm the admin
    surface exists (mirrors the web middleware's 404 posture, item #8).
    """
    if not await store.is_admin(account.owner):
        raise ApiError(ErrorCode.NOT_FOUND, "Not found.")
    return account


class AllowlistMutate(BaseModel):
    """``POST /admin/allowlist`` body: ``{ address, role }``."""

    address: str
    role: Role

    @field_validator("address")
    @classmethod
    def _validate_address(cls, value: str) -> str:
        candidate = value.strip()
        if not _ADDRESS_RE.match(candidate):
            raise ValueError("address must be a 20-byte 0x address")
        return candidate


@router.get("/allowlist/status")
async def allowlist_status(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[AllowlistStore, Depends(get_allowlist_store)],
) -> dict[str, bool]:
    """Return ``{beta, admin}`` for the caller-scoped wallet (``X-Owner``). Not admin-gated —
    a wallet may always read its own access status (the SIWE login path uses this)."""
    return await store.status(account.owner)


@router.get("/admin/allowlist")
async def admin_list(
    role: Role,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[AllowlistStore, Depends(get_allowlist_store)],
) -> dict[str, object]:
    """List the wallets holding ``role`` (admin-gated). Addresses are lowercase; the web
    checksum-normalizes for display."""
    return {"role": role, "addresses": await store.list_role(role)}


@router.post("/admin/allowlist", status_code=201)
async def admin_add(
    body: AllowlistMutate,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[AllowlistStore, Depends(get_allowlist_store)],
) -> dict[str, object]:
    """Add ``address`` to ``role`` (admin-gated, idempotent, audit-logged; actor = caller)."""
    await store.add(body.address, body.role, actor=admin.owner)
    return {"ok": True, "address": body.address.lower(), "role": body.role}


@router.delete("/admin/allowlist/{role}/{address}")
async def admin_remove(
    role: Role,
    address: str,
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[AllowlistStore, Depends(get_allowlist_store)],
) -> dict[str, object]:
    """Remove ``address`` from ``role`` (admin-gated, audit-logged; actor = caller).

    Guardrail: refuses to remove the LAST admin (an env re-seed would restore it on the next
    boot, but a mid-session lockout of every admin is never allowed).
    """
    candidate = address.strip()
    if not _ADDRESS_RE.match(candidate):
        raise ApiError(ErrorCode.VALIDATION_ERROR, "address must be a 20-byte 0x address")
    if role == ADMIN_ROLE:
        admins = await store.list_role(ADMIN_ROLE)
        if candidate.lower() in admins and len(admins) <= 1:
            raise ApiError(
                ErrorCode.VALIDATION_ERROR,
                "Refusing to remove the last admin (would lock out all admins).",
            )
    await store.remove(candidate, role, actor=admin.owner)
    return {"ok": True, "address": candidate.lower(), "role": role}


@router.get("/admin/allowlist/audit")
async def admin_audit(
    admin: Annotated[AccountContext, Depends(require_admin)],
    store: Annotated[AllowlistStore, Depends(get_allowlist_store)],
    limit: int = 50,
) -> dict[str, object]:
    """Read the most-recent allowlist audit rows (admin-gated, newest first)."""
    return {"entries": await store.recent_audit(limit)}
