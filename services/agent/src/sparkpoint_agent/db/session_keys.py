"""Store for the on-chain session-key MIRROR (migration 0024, feature 022 US6 automation).

One row per authorized session key: its PUBLIC key, the granted scope (targets/selectors,
per-tx + cumulative caps, max slippage, hard expiry), the monotonic spend synced from chain, and the
register/revoke tx hashes. The CHAIN (the deployed SparkPointAccount's own storage) is the source of
truth — every value here is re-derivable, so nothing is fabricated (Principle III / N5).

NON-CUSTODY (N1/N2/N3/N4/N5): holds the session PUBLIC key ONLY — never a private key/signature
(N3). Revoke is a SACRED EXIT (N2): ``mark_revoked`` records that the owner unilaterally killed the
key; the authoritative revoke lives on-chain and needs no SparkPoint cooperation, and no row here
can gate it. A store outage degrades the automation UI/notifications, never custody.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from .pool import Database


def _hex_to_bytes(value: str | None) -> bytes | None:
    """A 0x-prefixed hex string → bytes for a BYTEA column (None-safe)."""
    if value is None:
        return None
    h = value[2:] if value.startswith(("0x", "0X")) else value
    return bytes.fromhex(h)


def _bytes_to_hex(value: Any) -> str | None:
    """A BYTEA value (bytes/memoryview) → 0x-prefixed hex string (None-safe)."""
    if value is None:
        return None
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytes | bytearray):
        return "0x" + bytes(value).hex()
    return None


@dataclass(frozen=True, slots=True)
class SessionKeyRow:
    """One fetched session-key row (read model). Caps/spent base-unit; hashes 0x hex."""

    id: UUID
    smart_account_address: str
    owner_address: str
    chain_id: int
    session_pubkey: str
    status: str
    allowlisted_targets: list[str]
    allowlisted_selectors: list[str]
    per_tx_cap_raw: int
    cumulative_cap_raw: int
    spent_raw: int
    max_slippage_bps: int
    valid_after: datetime | None
    valid_until: datetime
    registered_tx_hash: str | None
    revoked_tx_hash: str | None
    created_at: datetime
    updated_at: datetime


def _row_to_model(r: Any) -> SessionKeyRow:
    return SessionKeyRow(
        id=r["id"],
        smart_account_address=str(r["smart_account_address"]),
        owner_address=str(r["owner_address"]),
        chain_id=int(r["chain_id"]),
        session_pubkey=str(r["session_pubkey"]),
        status=str(r["status"]),
        allowlisted_targets=[str(t) for t in (r["allowlisted_targets"] or [])],
        allowlisted_selectors=[str(s) for s in (r["allowlisted_selectors"] or [])],
        per_tx_cap_raw=int(r["per_tx_cap_raw"]),
        cumulative_cap_raw=int(r["cumulative_cap_raw"]),
        spent_raw=int(r["spent_raw"]),
        max_slippage_bps=int(r["max_slippage_bps"]),
        valid_after=r["valid_after"],
        valid_until=r["valid_until"],
        registered_tx_hash=_bytes_to_hex(r["registered_tx_hash"]),
        revoked_tx_hash=_bytes_to_hex(r["revoked_tx_hash"]),
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


# Upsert a grant. A re-grant of the same (account, pubkey) refreshes the scope and clears any prior
# revoke, but NEVER resets spent_raw (the on-chain ledger is monotonic; the mirror follows it).
_UPSERT_GRANT_SQL = (
    "INSERT INTO session_keys ("
    " smart_account_address, owner_address, chain_id, session_pubkey, status,"
    " allowlisted_targets, allowlisted_selectors, per_tx_cap_raw, cumulative_cap_raw,"
    " spent_raw, max_slippage_bps, valid_after, valid_until, registered_tx_hash)"
    " VALUES ($1,$2,$3,$4,'active',$5,$6,$7,$8,$9,$10,$11,$12,$13)"
    " ON CONFLICT (smart_account_address, session_pubkey) DO UPDATE SET"
    "   owner_address = EXCLUDED.owner_address,"
    "   chain_id = EXCLUDED.chain_id,"
    "   status = 'active',"
    "   allowlisted_targets = EXCLUDED.allowlisted_targets,"
    "   allowlisted_selectors = EXCLUDED.allowlisted_selectors,"
    "   per_tx_cap_raw = EXCLUDED.per_tx_cap_raw,"
    "   cumulative_cap_raw = EXCLUDED.cumulative_cap_raw,"
    "   max_slippage_bps = EXCLUDED.max_slippage_bps,"
    "   valid_after = EXCLUDED.valid_after,"
    "   valid_until = EXCLUDED.valid_until,"
    "   registered_tx_hash ="
    " COALESCE(EXCLUDED.registered_tx_hash, session_keys.registered_tx_hash),"
    "   revoked_tx_hash = NULL,"
    "   updated_at = now()"
    " RETURNING id"
)

# Sacred exit (N2): mark revoked. Idempotent; never gated. Records the revoke tx event if provided.
_MARK_REVOKED_SQL = (
    "UPDATE session_keys SET status = 'revoked',"
    " revoked_tx_hash = COALESCE($3, revoked_tx_hash), updated_at = now()"
    " WHERE smart_account_address = $1 AND session_pubkey = $2"
)

# Sync the mirror from a fresh chain read: spent monotonic (GREATEST); status follows chain.
_SYNC_SQL = (
    "UPDATE session_keys SET spent_raw = GREATEST(spent_raw, $3), status = $4, updated_at = now()"
    " WHERE smart_account_address = $1 AND session_pubkey = $2"
)

# Fully-literal SELECTs (columns inlined per query) — no dynamic SQL construction (S608-clean).
_GET_SQL = (
    "SELECT id, smart_account_address, owner_address, chain_id, session_pubkey, status,"
    " allowlisted_targets, allowlisted_selectors, per_tx_cap_raw, cumulative_cap_raw,"
    " spent_raw, max_slippage_bps, valid_after, valid_until, registered_tx_hash,"
    " revoked_tx_hash, created_at, updated_at FROM session_keys"
    " WHERE smart_account_address = $1 AND session_pubkey = $2"
)
_LIST_BY_ACCOUNT_SQL = (
    "SELECT id, smart_account_address, owner_address, chain_id, session_pubkey, status,"
    " allowlisted_targets, allowlisted_selectors, per_tx_cap_raw, cumulative_cap_raw,"
    " spent_raw, max_slippage_bps, valid_after, valid_until, registered_tx_hash,"
    " revoked_tx_hash, created_at, updated_at FROM session_keys"
    " WHERE smart_account_address = $1 ORDER BY created_at DESC"
)
_LIST_ACTIVE_BY_ACCOUNT_SQL = (
    "SELECT id, smart_account_address, owner_address, chain_id, session_pubkey, status,"
    " allowlisted_targets, allowlisted_selectors, per_tx_cap_raw, cumulative_cap_raw,"
    " spent_raw, max_slippage_bps, valid_after, valid_until, registered_tx_hash,"
    " revoked_tx_hash, created_at, updated_at FROM session_keys"
    " WHERE smart_account_address = $1 AND status = 'active' ORDER BY valid_until ASC"
)


@dataclass
class SessionKeyStore:
    """asyncpg-backed store over ``session_keys`` (migration 0024)."""

    db: Database

    async def upsert_grant(
        self,
        *,
        smart_account_address: str,
        owner_address: str,
        chain_id: int,
        session_pubkey: str,
        allowlisted_targets: Sequence[str],
        allowlisted_selectors: Sequence[str],
        per_tx_cap_raw: int,
        cumulative_cap_raw: int,
        max_slippage_bps: int,
        valid_until: datetime,
        valid_after: datetime | None = None,
        spent_raw: int = 0,
        registered_tx_hash: str | None = None,
    ) -> UUID | None:
        """Record (or refresh) a granted session key; returns its id. Never resets a prior spent."""
        new_id: UUID | None = await self.db.fetchval(
            _UPSERT_GRANT_SQL,
            smart_account_address.lower(),
            owner_address.lower(),
            chain_id,
            session_pubkey.lower(),
            [t.lower() for t in allowlisted_targets],
            [s.lower() for s in allowlisted_selectors],
            str(per_tx_cap_raw),
            str(cumulative_cap_raw),
            str(max(0, spent_raw)),
            max_slippage_bps,
            valid_after,
            valid_until,
            _hex_to_bytes(registered_tx_hash),
        )
        return new_id

    async def mark_revoked(
        self, *, smart_account_address: str, session_pubkey: str, tx_hash: str | None = None
    ) -> None:
        """Sacred exit (N2): mark the key revoked. Idempotent, never gated."""
        await self.db.execute(
            _MARK_REVOKED_SQL,
            smart_account_address.lower(),
            session_pubkey.lower(),
            _hex_to_bytes(tx_hash),
        )

    async def sync_from_chain(
        self, *, smart_account_address: str, session_pubkey: str, spent_raw: int, status: str
    ) -> None:
        """Reconcile the mirror to a fresh chain read (spent monotonic; status = chain truth)."""
        await self.db.execute(
            _SYNC_SQL,
            smart_account_address.lower(),
            session_pubkey.lower(),
            str(max(0, spent_raw)),
            status,
        )

    async def get(self, smart_account_address: str, session_pubkey: str) -> SessionKeyRow | None:
        """Fetch one session key by (account, pubkey), or None."""
        row = await self.db.fetchrow(
            _GET_SQL, smart_account_address.lower(), session_pubkey.lower()
        )
        return _row_to_model(row) if row is not None else None

    async def list_by_account(self, smart_account_address: str) -> list[SessionKeyRow]:
        """All session keys for an account, newest-first (drives GET /session-keys)."""
        rows = await self.db.fetch(_LIST_BY_ACCOUNT_SQL, smart_account_address.lower())
        return [_row_to_model(r) for r in rows]

    async def list_active_by_account(self, smart_account_address: str) -> list[SessionKeyRow]:
        """Active session keys for an account, soonest-expiry-first (drives sessionKeyExpiry)."""
        rows = await self.db.fetch(_LIST_ACTIVE_BY_ACCOUNT_SQL, smart_account_address.lower())
        return [_row_to_model(r) for r in rows]


__all__: Sequence[str] = ("SessionKeyRow", "SessionKeyStore")
