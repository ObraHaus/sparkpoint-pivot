"""Feature 026 - alpha access applications (migration 0029).

A wallet that isn't on the beta allowlist is no longer a dead end: it can submit ONE application
(upserted on re-submit) which an admin approves or denies from the panel. This store records the
application only - APPROVING is the existing ``AllowlistStore.add`` call, so nothing here ever
grants access by itself, and nothing here is read on the login path except the applicant's own
status. It is never on the custody path (/exit, /trust and the on-chain withdraw are never gated
by any of it, N2).

Addresses are stored + compared LOWERCASE, mirroring ``db/allowlist.py``.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .pool import Database

PENDING = "pending"
APPROVED = "approved"
DENIED = "denied"

#: Server-side field caps. The DB has the same CHECKs (a cap that only lives in app code is a cap
#: that eventually isn't there); these give a clean 400 instead of a constraint violation.
MAX_CONTACT = 200
MAX_NAME = 120
MAX_REASON = 2000

_UPSERT_SQL = """
INSERT INTO access_applications (address, contact, display_name, reason, status, updated_at)
VALUES ($1, $2, $3, $4, 'pending', now())
ON CONFLICT (address) DO UPDATE SET
    contact      = EXCLUDED.contact,
    display_name = EXCLUDED.display_name,
    reason       = EXCLUDED.reason,
    -- A re-submit re-opens a DENIED application but must never un-approve an approved one.
    status       = CASE WHEN access_applications.status = 'approved' THEN 'approved'
                        ELSE 'pending' END,
    updated_at   = now()
"""
_GET_SQL = (
    "SELECT address, contact, display_name, reason, status, submitted_at, updated_at, "
    "decided_by, decided_at FROM access_applications WHERE address = $1"
)
_LIST_SQL = (
    "SELECT address, contact, display_name, reason, status, submitted_at, updated_at, "
    "decided_by, decided_at FROM access_applications WHERE ($1::text IS NULL OR status = $1) "
    "ORDER BY submitted_at DESC LIMIT $2"
)
_DECIDE_SQL = (
    "UPDATE access_applications SET status = $2, decided_by = $3, decided_at = now(), "
    "updated_at = now() WHERE address = $1"
)
_AUDIT_SQL = (
    "INSERT INTO access_application_audit (action, address, actor) VALUES ($1, $2, $3)"
)


def _norm(address: str | None) -> str:
    return (address or "").strip().lower()


@dataclass(frozen=True)
class Application:
    """One access application, as the API and the admin panel see it."""

    address: str
    contact: str
    display_name: str
    reason: str
    status: str
    submitted_at: str
    updated_at: str
    decided_by: str | None
    decided_at: str | None

    def to_wire(self) -> dict[str, Any]:
        return {
            "address": self.address,
            "contact": self.contact,
            "name": self.display_name,
            "reason": self.reason,
            "status": self.status,
            "submittedAt": self.submitted_at,
            "updatedAt": self.updated_at,
            "decidedBy": self.decided_by,
            "decidedAt": self.decided_at,
        }


def _row_to_application(row: Any) -> Application:
    def iso(value: Any) -> str | None:
        return value.isoformat() if value is not None else None

    return Application(
        address=str(row["address"]),
        contact=str(row["contact"]),
        display_name=str(row["display_name"]),
        reason=str(row["reason"]),
        status=str(row["status"]),
        submitted_at=iso(row["submitted_at"]) or "",
        updated_at=iso(row["updated_at"]) or "",
        decided_by=(str(row["decided_by"]) if row["decided_by"] is not None else None),
        decided_at=iso(row["decided_at"]),
    )


@dataclass
class AccessApplicationStore:
    """asyncpg-backed store for the access applications."""

    db: Database

    async def submit(
        self, *, address: str, contact: str, display_name: str, reason: str
    ) -> Application:
        """Upsert THIS wallet's application (one per wallet), audit it, return the stored row."""
        addr = _norm(address)
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(
                _UPSERT_SQL, addr, contact.strip(), display_name.strip(), reason.strip()
            )
            await conn.execute(_AUDIT_SQL, "submit", addr, addr)
        stored = await self.get(addr)
        if stored is None:  # pragma: no cover - the upsert just wrote it
            raise RuntimeError("application vanished immediately after write")
        return stored

    async def get(self, address: str) -> Application | None:
        rows = await self.db.fetch(_GET_SQL, _norm(address))
        return _row_to_application(rows[0]) if rows else None

    async def list(self, *, status: str | None = None, limit: int = 100) -> list[Application]:
        rows = await self.db.fetch(_LIST_SQL, status, max(1, min(limit, 500)))
        return [_row_to_application(r) for r in rows]

    async def decide(self, *, address: str, approve: bool, actor: str | None) -> None:
        """Flip an application to approved/denied and audit it.

        Granting the actual ROLE is a separate ``AllowlistStore.add`` call by the caller - this
        table is a record, never an authority.
        """
        addr = _norm(address)
        act = _norm(actor) or None
        status = APPROVED if approve else DENIED
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_DECIDE_SQL, addr, status, act)
            await conn.execute(_AUDIT_SQL, "approve" if approve else "deny", addr, act)
