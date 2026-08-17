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

#: Where the application came from (migration 0036). ``wallet`` = the /verify form, filed against a
#: SIWE-verified session, so the address is PROVEN. ``public`` = the landing-page form, where the
#: applicant typed the address themselves and proved nothing. Approving a ``public`` row grants beta
#: to an address whose owner never signed — the panel says so, because a reviewer who cannot tell
#: the two apart is being asked to make a decision they don't have the facts for.
SOURCE_WALLET = "wallet"
SOURCE_PUBLIC = "public"

#: Server-side field caps. The DB has the same CHECKs (a cap that only lives in app code is a cap
#: that eventually isn't there); these give a clean 400 instead of a constraint violation.
MAX_CONTACT = 200
MAX_NAME = 120
MAX_REASON = 2000

_UPSERT_SQL = """
INSERT INTO access_applications
    (address, contact, display_name, reason, status, updated_at, source)
VALUES ($1, $2, $3, $4, 'pending', now(), 'wallet')
ON CONFLICT (address) DO UPDATE SET
    contact      = EXCLUDED.contact,
    display_name = EXCLUDED.display_name,
    reason       = EXCLUDED.reason,
    -- A re-submit re-opens a DENIED application but must never un-approve an approved one.
    status       = CASE WHEN access_applications.status = 'approved' THEN 'approved'
                        ELSE 'pending' END,
    -- A signed-in applicant re-filing their own row UPGRADES its provenance: they have now proven
    -- the address. It never downgrades — see `_INSERT_PUBLIC_SQL`, which cannot touch an existing
    -- row at all.
    source       = 'wallet',
    updated_at   = now()
"""

#: The PUBLIC form's write (045). DO NOTHING, deliberately — NOT an upsert.
#:
#: Anyone can type anyone's address here, so an upsert would let a stranger overwrite a real
#: applicant's contact details, and the response would differ depending on whether a row already
#: existed, which is an enumeration oracle for "has this address applied / been approved". Neither
#: is acceptable for an unauthenticated endpoint. First application wins; the repeat attempt is
#: recorded in the audit table and the caller is told the same thing either way.
_INSERT_PUBLIC_SQL = """
INSERT INTO access_applications
    (address, contact, display_name, reason, status, updated_at, source)
VALUES ($1, $2, $3, $4, 'pending', now(), 'public')
ON CONFLICT (address) DO NOTHING
"""

_GET_SQL = (
    "SELECT address, contact, display_name, reason, status, submitted_at, updated_at, "
    "decided_by, decided_at, source FROM access_applications WHERE address = $1"
)
_LIST_SQL = (
    "SELECT address, contact, display_name, reason, status, submitted_at, updated_at, "
    "decided_by, decided_at, source FROM access_applications "
    "WHERE ($1::text IS NULL OR status = $1) ORDER BY submitted_at DESC LIMIT $2"
)
_DECIDE_SQL = (
    "UPDATE access_applications SET status = $2, decided_by = $3, decided_at = now(), "
    "updated_at = now() WHERE address = $1"
)
_AUDIT_SQL = (
    "INSERT INTO access_application_audit (action, address, actor, source) VALUES ($1, $2, $3, $4)"
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
    #: 'wallet' (signature-backed) or 'public' (self-declared address). Defaulted so the many
    #: existing constructions in tests and callers keep meaning what they meant before 045.
    source: str = SOURCE_WALLET

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
            # The reviewer's most important field: whether anyone proved this address.
            "source": self.source,
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
        source=str(row["source"] or SOURCE_WALLET),
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
            await conn.execute(_AUDIT_SQL, "submit", addr, addr, SOURCE_WALLET)
        stored = await self.get(addr)
        if stored is None:  # pragma: no cover - the upsert just wrote it
            raise RuntimeError("application vanished immediately after write")
        return stored

    async def submit_public(
        self, *, address: str, contact: str, display_name: str, reason: str
    ) -> bool:
        """File an application for a SELF-DECLARED address (the landing-page form, 045).

        Returns whether a NEW row was created. It returns a bare bool, not the row, on purpose:
        the caller is unauthenticated, so it must never learn anything about an address it does
        not control — not the stored contact details, not the review status, not even reliably
        whether the address was already known. The API answers identically either way; this value
        exists only so the server can audit the difference.

        An existing row is never modified (``ON CONFLICT DO NOTHING``): the first application wins,
        and a stranger cannot overwrite, re-open or grief someone else's.
        """
        addr = _norm(address)
        async with self.db.acquire() as conn, conn.transaction():
            status = await conn.execute(
                _INSERT_PUBLIC_SQL, addr, contact.strip(), display_name.strip(), reason.strip()
            )
            # asyncpg returns the command tag ("INSERT 0 1" / "INSERT 0 0") — 0 rows means an
            # application already existed and this one was dropped.
            created = str(status).strip().endswith("1")
            # Audited either way. A dropped duplicate leaves NO other trace, and "someone else
            # tried to apply for an address that already has a row" is exactly the signal an
            # operator would want if this endpoint were ever abused.
            await conn.execute(_AUDIT_SQL, "submit", addr, None, SOURCE_PUBLIC)
        return created

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
            await conn.execute(_AUDIT_SQL, "approve" if approve else "deny", addr, act, None)
