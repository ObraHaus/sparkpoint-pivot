"""076 — durable single-use NEP-413 login nonces (migration 0045).

A NEAR sign-in must use a server-issued nonce exactly once. Keeping it in Postgres (rather than
only in the httpOnly cookie) makes that true across workers/restarts: ``consume`` is one atomic
``UPDATE ... WHERE consumed_at IS NULL AND expires_at > now()``.

NON-CUSTODY: this table stores a random nonce and its lifetime only. No key, no signature, no
authority to move funds.
"""

from __future__ import annotations

import base64
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from .pool import Database

#: A login must finish within ten minutes of asking for a nonce (mirrors the SIWE nonce TTL).
NONCE_TTL = timedelta(minutes=10)

_INSERT = (
    "INSERT INTO near_login_nonces (nonce, expires_at) VALUES ($1, $2) "
    "RETURNING issued_at, expires_at"
)
_CONSUME = (
    "UPDATE near_login_nonces SET consumed_at = now() "
    "WHERE nonce = $1 AND consumed_at IS NULL AND expires_at > now() "
    "RETURNING issued_at, expires_at"
)
_SWEEP = "DELETE FROM near_login_nonces WHERE expires_at < $1"


def new_nonce() -> str:
    """A 32-byte URL-safe nonce (no padding, so it is cookie-safe)."""
    return base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")


@dataclass(frozen=True)
class IssuedNonce:
    nonce: str
    issued_at: datetime
    expires_at: datetime


@dataclass
class NearNonceStore:
    """asyncpg-backed single-use nonce store."""

    db: Database

    async def create(self) -> IssuedNonce:
        nonce = new_nonce()
        expires = datetime.now(UTC) + NONCE_TTL
        row = await self.db.fetchrow(_INSERT, nonce, expires)
        assert row is not None  # noqa: S101 — INSERT ... RETURNING always yields a row
        return IssuedNonce(nonce, row["issued_at"], row["expires_at"])

    async def consume(self, nonce: str) -> IssuedNonce | None:
        """Consume ``nonce`` exactly once. ``None`` ⇒ unknown, already used, or expired."""
        row = await self.db.fetchrow(_CONSUME, nonce)
        if row is None:
            return None
        return IssuedNonce(nonce, row["issued_at"], row["expires_at"])

    async def sweep(self, *, now: datetime | None = None) -> int:
        """Delete expired rows (a bounded housekeeping sweep; failure is never user-visible)."""
        cutoff = now or datetime.now(UTC)
        try:
            result = await self.db.execute(_SWEEP, cutoff)
            return int(str(result).split()[-1])
        except Exception:
            return 0
