"""Sparky Broker mint whitelist applications (migration 0042).

The Sparky Broker collection mints through SeaDrop in staged allowlists (Treasury, GTD, FCFS,
then Public). This store records the public form's whitelist requests so an operator can hand the
addresses to the allowlist and guarantee the applicant's spot. It grants NOTHING on-chain by
itself, is never read on the app's access path, and is never on the custody path (/exit, /trust
and the on-chain withdraw are never gated by it, N2).

Addresses are stored + compared LOWERCASE, mirroring ``db/access_applications.py``. The endpoint
behind the write is UNAUTHENTICATED (a visitor with no wallet), so ``submit`` is
``ON CONFLICT DO NOTHING`` — first submission per address wins; a stranger cannot overwrite or
grief a real applicant's row. The public API answers identically either way.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .pool import Database

#: Server-side field caps. The DB has the same CHECKs (a cap that only lives in app code is a cap
#: that eventually isn't there); these give a clean 400 instead of a constraint violation.
MAX_CONTACT = 200
MAX_NAME = 120
MAX_REASON = 2000

_INSERT_SQL = """
INSERT INTO mint_whitelist_applications
    (address, contact, display_name, reason)
VALUES ($1, $2, $3, $4)
ON CONFLICT (address) DO NOTHING
"""

_LIST_SQL = (
    "SELECT address, contact, display_name, reason, submitted_at "
    "FROM mint_whitelist_applications ORDER BY submitted_at DESC LIMIT $1"
)

_AUDIT_SQL = "INSERT INTO mint_whitelist_audit (action, address) VALUES ('submit', $1)"


def _norm(address: str | None) -> str:
    return (address or "").strip().lower()


@dataclass(frozen=True)
class MintWhitelistApplication:
    """One mint whitelist application, as the API and the admin panel see it."""

    address: str
    contact: str
    display_name: str
    reason: str
    submitted_at: str

    def to_wire(self) -> dict[str, Any]:
        return {
            "address": self.address,
            "contact": self.contact,
            "name": self.display_name,
            "reason": self.reason,
            "submittedAt": self.submitted_at,
        }


def _row_to_application(row: Any) -> MintWhitelistApplication:
    submitted = row["submitted_at"]
    return MintWhitelistApplication(
        address=str(row["address"]),
        contact=str(row["contact"]),
        display_name=str(row["display_name"]),
        reason=str(row["reason"]),
        submitted_at=submitted.isoformat() if submitted is not None else "",
    )


@dataclass
class MintWhitelistStore:
    """asyncpg-backed store for the Sparky Broker mint whitelist applications."""

    db: Database

    async def submit(
        self, *, address: str, contact: str, display_name: str, reason: str
    ) -> bool:
        """File a whitelist request for a SELF-DECLARED address.

        Returns whether a NEW row was created. The caller is unauthenticated, so it must never
        learn anything about an address it does not control — the API answers identically either
        way; this value exists only so the server can audit the difference and tests can assert it.
        """
        addr = _norm(address)
        async with self.db.acquire() as conn, conn.transaction():
            status = await conn.execute(
                _INSERT_SQL, addr, contact.strip(), display_name.strip(), reason.strip()
            )
            # asyncpg returns the command tag ("INSERT 0 1" / "INSERT 0 0") — 0 rows means an
            # application already existed and this one was dropped.
            created = str(status).strip().endswith("1")
            # Audited either way, so a dropped duplicate is visible.
            await conn.execute(_AUDIT_SQL, addr)
        return created

    async def list(self, *, limit: int = 500) -> list[MintWhitelistApplication]:
        rows = await self.db.fetch(_LIST_SQL, max(1, min(limit, 2000)))
        return [_row_to_application(r) for r in rows]
