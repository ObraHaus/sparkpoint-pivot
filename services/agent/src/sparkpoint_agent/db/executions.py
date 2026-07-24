"""Store for submitted/confirmed executions (migration 0021, feature 019 US2).

``executions`` is an append-mostly, ONCHAIN-DERIVED index (VR-X6): the on-chain ``tx_hash`` + events
are authoritative and re-derivable — this row is a convenience index, never a source of funds
movement. It records the *event* of having signed (a byte-matched signed payload / a tx hash), NEVER
a signature or key (VR-X1/N3). ``UNIQUE(intent_bundle_id)`` gives durable de-dup (research R6):
a replayed submit returns the existing row rather than double-recording.

NON-CUSTODY (N2): nothing here gates a withdraw/redeem — a stalled executions table only makes the
status view incomplete, never traps funds.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from .pool import Database

# ON CONFLICT DO NOTHING RETURNING id ⇒ None on a replay (the row already exists).
_INSERT_SUBMITTED_SQL = (
    "INSERT INTO executions ("
    " intent_bundle_id, smart_account_address, action_kind, signing_mode, status,"
    " userop_hash, tx_hash"
    ") VALUES ($1, $2, $3, $4, 'submitted', $5, $6)"
    " ON CONFLICT (intent_bundle_id) DO NOTHING RETURNING id"
)

_UPDATE_STATUS_SQL = (
    "UPDATE executions SET status = $2, tx_hash = COALESCE($3, tx_hash),"
    " block_number = COALESCE($4, block_number), gas_used = COALESCE($5, gas_used),"
    " realized_amounts = COALESCE($6::jsonb, realized_amounts),"
    " reverted_reason = COALESCE($7, reverted_reason), updated_at = now()"
    " WHERE intent_bundle_id = $1"
)

_GET_BY_INTENT_SQL = (
    "SELECT id, intent_bundle_id, smart_account_address, action_kind, signing_mode, status,"
    " userop_hash, tx_hash, block_number, gas_used, realized_amounts, reverted_reason,"
    " intent_log_action_id, attribution_method, created_at, updated_at"
    " FROM executions WHERE intent_bundle_id = $1"
)

# Newest-first per-user list (executions_account_idx). Drives the notifications feed (feature 021).
_LIST_BY_ACCOUNT_SQL = (
    "SELECT id, intent_bundle_id, smart_account_address, action_kind, signing_mode, status,"
    " userop_hash, tx_hash, block_number, gas_used, realized_amounts, reverted_reason,"
    " intent_log_action_id, attribution_method, created_at, updated_at"
    " FROM executions WHERE smart_account_address = $1 ORDER BY created_at DESC LIMIT $2"
)


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
    return "0x" + bytes(value).hex()


@dataclass(frozen=True, slots=True)
class ExecutionRow:
    """One fetched execution row (read model). Hashes are 0x hex strings."""

    id: UUID
    intent_bundle_id: UUID
    smart_account_address: str
    action_kind: str
    signing_mode: str
    status: str
    userop_hash: str | None
    tx_hash: str | None
    block_number: int | None
    gas_used: int | None
    realized_amounts: dict[str, Any] | None
    reverted_reason: str | None
    attribution_method: str | None
    created_at: datetime
    updated_at: datetime


def _as_dict_or_none(raw: Any) -> dict[str, Any] | None:
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return None
        return parsed if isinstance(parsed, dict) else None
    return raw if isinstance(raw, dict) else None


def _row_to_model(r: Any) -> ExecutionRow:
    return ExecutionRow(
        id=r["id"],
        intent_bundle_id=r["intent_bundle_id"],
        smart_account_address=str(r["smart_account_address"]),
        action_kind=str(r["action_kind"]),
        signing_mode=str(r["signing_mode"]),
        status=str(r["status"]),
        userop_hash=_bytes_to_hex(r["userop_hash"]),
        tx_hash=_bytes_to_hex(r["tx_hash"]),
        block_number=(int(r["block_number"]) if r["block_number"] is not None else None),
        gas_used=(int(r["gas_used"]) if r["gas_used"] is not None else None),
        realized_amounts=_as_dict_or_none(r["realized_amounts"]),
        reverted_reason=(str(r["reverted_reason"]) if r["reverted_reason"] is not None else None),
        attribution_method=(
            str(r["attribution_method"]) if r["attribution_method"] is not None else None
        ),
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


@dataclass
class ExecutionStore:
    """asyncpg-backed store over ``executions`` (migration 0021)."""

    db: Database

    async def insert_submitted(
        self,
        *,
        intent_bundle_id: UUID,
        smart_account_address: str,
        action_kind: str,
        signing_mode: str = "per_action_user_signature",
        tx_hash: str | None = None,
        userop_hash: str | None = None,
    ) -> UUID | None:
        """Record a submitted execution; return the new id, or None if it was a replay (de-dup)."""
        new_id: UUID | None = await self.db.fetchval(
            _INSERT_SUBMITTED_SQL,
            intent_bundle_id,
            smart_account_address.lower(),
            action_kind,
            signing_mode,
            _hex_to_bytes(userop_hash),
            _hex_to_bytes(tx_hash),
        )
        return new_id

    async def update_status(
        self,
        *,
        intent_bundle_id: UUID,
        status: str,
        tx_hash: str | None = None,
        block_number: int | None = None,
        gas_used: int | None = None,
        realized_amounts: dict[str, Any] | None = None,
        reverted_reason: str | None = None,
    ) -> None:
        """Advance an execution's lifecycle state (COALESCE keeps prior non-null fields)."""
        await self.db.execute(
            _UPDATE_STATUS_SQL,
            intent_bundle_id,
            status,
            _hex_to_bytes(tx_hash),
            block_number,
            (str(gas_used) if gas_used is not None else None),
            (json.dumps(realized_amounts) if realized_amounts is not None else None),
            reverted_reason,
        )

    async def get_by_intent(self, intent_bundle_id: UUID) -> ExecutionRow | None:
        """Fetch the execution for an intent, or None."""
        row = await self.db.fetchrow(_GET_BY_INTENT_SQL, intent_bundle_id)
        return _row_to_model(row) if row is not None else None

    async def list_by_account(
        self, smart_account_address: str, *, limit: int = 50
    ) -> list[ExecutionRow]:
        """The account's executions, newest-first (drives the notifications feed, feature 021)."""
        rows = await self.db.fetch(
            _LIST_BY_ACCOUNT_SQL, smart_account_address.lower(), max(1, min(limit, 200))
        )
        return [_row_to_model(r) for r in rows]


__all__: Sequence[str] = ("ExecutionRow", "ExecutionStore")
