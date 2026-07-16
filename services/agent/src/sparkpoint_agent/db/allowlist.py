"""Beta + admin wallet allowlists (Phase B) — DB-backed, audit-logged, seed-from-env.

An ACCESS gate only (who may enter the (app) shell / the admin panel). It NEVER gates custody:
/exit, /trust, and the on-chain withdraw path are never checked against it (N2). Addresses are
stored + compared LOWERCASE (callers checksum-normalize for display). Every mutation writes an
append-only ``allowlist_audit`` row in the same transaction.
"""

from __future__ import annotations

from dataclasses import dataclass

from .pool import Database

BETA_ROLE = "beta"
ADMIN_ROLE = "admin"

_LIST_SQL = "SELECT address FROM wallet_allowlist WHERE role = $1 ORDER BY added_at"
_ROLES_SQL = "SELECT role FROM wallet_allowlist WHERE address = $1"
_COUNT_ROLE_SQL = "SELECT count(*) FROM wallet_allowlist WHERE role = $1"
_AUDIT_READ_SQL = (
    "SELECT action, address, role, actor, at FROM allowlist_audit ORDER BY at DESC LIMIT $1"
)
_ADD_SQL = (
    "INSERT INTO wallet_allowlist (address, role, added_by) VALUES ($1, $2, $3) "
    "ON CONFLICT (address, role) DO NOTHING"
)
_REMOVE_SQL = "DELETE FROM wallet_allowlist WHERE address = $1 AND role = $2"
_AUDIT_SQL = "INSERT INTO allowlist_audit (action, address, role, actor) VALUES ($1, $2, $3, $4)"


def _norm(address: str | None) -> str:
    return (address or "").strip().lower()


@dataclass
class AllowlistStore:
    """asyncpg-backed store for the beta/admin allowlists."""

    db: Database

    async def status(self, address: str) -> dict[str, bool]:
        """Return ``{"beta": bool, "admin": bool}`` for ``address``. Admin implies beta (an
        admin may always enter the app). Unknown address ⇒ both False (fail-closed)."""
        rows = await self.db.fetch(_ROLES_SQL, _norm(address))
        roles = {str(r["role"]) for r in rows}
        is_admin = ADMIN_ROLE in roles
        return {"beta": is_admin or BETA_ROLE in roles, "admin": is_admin}

    async def is_admin(self, address: str) -> bool:
        return (await self.status(address))["admin"]

    async def list_role(self, role: str) -> list[str]:
        rows = await self.db.fetch(_LIST_SQL, role)
        return [str(r["address"]) for r in rows]

    async def count_role(self, role: str) -> int:
        return int(await self.db.fetchval(_COUNT_ROLE_SQL, role) or 0)

    async def recent_audit(self, limit: int = 50) -> list[dict[str, object]]:
        rows = await self.db.fetch(_AUDIT_READ_SQL, max(1, min(limit, 500)))
        return [
            {
                "action": str(r["action"]),
                "address": str(r["address"]),
                "role": str(r["role"]),
                "actor": (str(r["actor"]) if r["actor"] is not None else None),
                "at": r["at"].isoformat(),
            }
            for r in rows
        ]

    async def add(self, address: str, role: str, *, actor: str | None) -> None:
        addr = _norm(address)
        act = _norm(actor) or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_ADD_SQL, addr, role, act)
            await conn.execute(_AUDIT_SQL, "add", addr, role, act)

    async def remove(self, address: str, role: str, *, actor: str | None) -> None:
        addr = _norm(address)
        act = _norm(actor) or None
        async with self.db.acquire() as conn, conn.transaction():
            await conn.execute(_REMOVE_SQL, addr, role)
            await conn.execute(_AUDIT_SQL, "remove", addr, role, act)

    async def seed(self, *, beta: list[str], admin: list[str]) -> int:
        """Idempotently seed from env (comma-split lists). Returns the count of NEW rows added.
        Records each newly-seeded address with actor ``env-seed``; existing rows are untouched."""
        added = 0
        async with self.db.acquire() as conn, conn.transaction():
            for role, addresses in ((BETA_ROLE, beta), (ADMIN_ROLE, admin)):
                for raw in addresses:
                    addr = _norm(raw)
                    if not addr:
                        continue
                    result = await conn.execute(_ADD_SQL, addr, role, "env-seed")
                    if result.endswith("1"):  # "INSERT 0 1" ⇒ a new row (not a conflict no-op)
                        await conn.execute(_AUDIT_SQL, "seed", addr, role, "env-seed")
                        added += 1
        return added


def parse_allowlist_env(value: str | None) -> list[str]:
    """Parse a comma-separated ``BETA_ALLOWLIST`` / ``ADMIN_ALLOWLIST`` env value → addresses."""
    return [a.strip() for a in (value or "").split(",") if a.strip()]
