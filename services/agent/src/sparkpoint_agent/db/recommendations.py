"""Store for durable recommendation snapshots (migration 0022, feature 020 US5).

Persists one record per distinct piece of advice a user engaged with — the attribution anchor that
links an acted-on recommendation to its realized on-chain outcome (FR-039/SC-010). Idempotent by a
content ``dedupe_key`` so re-surfacing the same advice upserts one row (FR-002). Its ``id`` is the
wire ``recId`` and is written to ``intent_bundles.recommendation_id`` at build time.

NON-CUSTODY (N1/N2/N3/N5): an OFF-CHAIN advice index only — no key, no signature, never on the
withdraw/exit path. A store outage is fail-open (advisory).
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

from .pool import Database

# Upsert by content: re-surfacing the same advice refreshes the snapshot but keeps the id + status.
_UPSERT_SQL = (
    "INSERT INTO recommendations ("
    " wallet, dedupe_key, strategy_kind, title, rationale, proposed_action, rank,"
    " mandate_version, policy_version"
    ") VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)"
    " ON CONFLICT (dedupe_key) DO UPDATE SET"
    "   title = EXCLUDED.title, rationale = EXCLUDED.rationale,"
    "   proposed_action = EXCLUDED.proposed_action, rank = EXCLUDED.rank,"
    "   mandate_version = EXCLUDED.mandate_version, updated_at = now()"
    " RETURNING id"
)

_GET_SQL = (
    "SELECT id, wallet, dedupe_key, strategy_kind, title, rationale, proposed_action, rank,"
    " mandate_version, policy_version, status, created_at, updated_at"
    " FROM recommendations WHERE id = $1"
)

_MARK_STATUS_SQL = "UPDATE recommendations SET status = $2, updated_at = now() WHERE id = $1"

# Only forward-advance the lifecycle; never demote executed → acted (idempotent status writes).
_STATUS_RANK: dict[str, int] = {
    "surfaced": 0,
    "acted": 1,
    "executed": 2,
    "declined": 1,
    "rejected": 1,
}

_LIST_EXECUTED_SQL = (
    "SELECT id, wallet, dedupe_key, strategy_kind, title, rationale, proposed_action, rank,"
    " mandate_version, policy_version, status, created_at, updated_at"
    " FROM recommendations WHERE wallet = $1 AND status = 'executed'"
    " ORDER BY created_at DESC LIMIT $2"
)

# The DEPOSIT tx a recommendation caused: rec → its linked intent_bundle → its submitted execution
# (US5 attribution join key; the tx joins to a vault-flow lot). Newest linked execution wins.
_DEPOSIT_TX_SQL = (
    "SELECT encode(e.tx_hash, 'hex') AS tx_hex FROM intent_bundles ib"
    " JOIN executions e ON e.intent_bundle_id = ib.id"
    " WHERE ib.recommendation_id = $1 AND e.tx_hash IS NOT NULL"
    " ORDER BY ib.created_at DESC LIMIT 1"
)

# All acted-on-and-submitted recs for a wallet + their deposit tx (drives /outcomes rec rows).
_LIST_ACTED_SQL = (
    "SELECT r.id, r.title, r.strategy_kind, r.proposed_action, r.rationale,"
    " encode(e.tx_hash, 'hex') AS tx_hex FROM recommendations r"
    " JOIN intent_bundles ib ON ib.recommendation_id = r.id"
    " JOIN executions e ON e.intent_bundle_id = ib.id"
    " WHERE r.wallet = $1 AND e.tx_hash IS NOT NULL"
    " ORDER BY r.created_at DESC LIMIT $2"
)


def dedupe_key(
    wallet: str, strategy_kind: str, proposed_action: dict[str, Any], policy_version: str
) -> str:
    """A stable content hash → one durable record per distinct advice (canonical json, sorted)."""
    canonical = json.dumps(proposed_action, sort_keys=True, separators=(",", ":"))
    raw = f"{wallet.lower()}|{strategy_kind}|{canonical}|{policy_version}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class RecInsert:
    """The insertable fields of one recommendation snapshot (no DB-set id/status/timestamps)."""

    wallet: str
    strategy_kind: str
    title: str
    proposed_action: dict[str, Any]
    policy_version: str
    rationale: str = ""
    rank: int | None = None
    mandate_version: str | None = None


@dataclass(frozen=True, slots=True)
class ActedRec:
    """An acted-on-and-submitted recommendation + the deposit tx it caused (US5 attribution)."""

    rec_id: UUID
    title: str
    strategy_kind: str
    proposed_action: dict[str, Any]
    rationale: str
    deposit_tx: str  # 0x hex — joins to a vault-flow lot


@dataclass(frozen=True, slots=True)
class RecRow:
    """One fetched recommendation (read model)."""

    id: UUID
    wallet: str
    dedupe_key: str
    strategy_kind: str
    title: str
    rationale: str
    proposed_action: dict[str, Any]
    rank: int | None
    mandate_version: str | None
    policy_version: str
    status: str
    created_at: datetime
    updated_at: datetime


def _as_dict(raw: Any) -> dict[str, Any]:
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return raw if isinstance(raw, dict) else {}


def _row_to_model(r: Any) -> RecRow:
    return RecRow(
        id=r["id"],
        wallet=str(r["wallet"]),
        dedupe_key=str(r["dedupe_key"]),
        strategy_kind=str(r["strategy_kind"]),
        title=str(r["title"]),
        rationale=str(r["rationale"]),
        proposed_action=_as_dict(r["proposed_action"]),
        rank=(int(r["rank"]) if r["rank"] is not None else None),
        mandate_version=(str(r["mandate_version"]) if r["mandate_version"] is not None else None),
        policy_version=str(r["policy_version"]),
        status=str(r["status"]),
        created_at=r["created_at"],
        updated_at=r["updated_at"],
    )


@dataclass
class RecommendationStore:
    """asyncpg-backed store over ``recommendations`` (migration 0022)."""

    db: Database

    async def upsert(self, rec: RecInsert) -> UUID:
        """Upsert a snapshot by content dedupe_key; return the durable id (the wire recId)."""
        key = dedupe_key(rec.wallet, rec.strategy_kind, rec.proposed_action, rec.policy_version)
        new_id: UUID = await self.db.fetchval(
            _UPSERT_SQL,
            rec.wallet.lower(),
            key,
            rec.strategy_kind,
            rec.title,
            rec.rationale,
            json.dumps(rec.proposed_action),
            rec.rank,
            rec.mandate_version,
            rec.policy_version,
        )
        return new_id

    async def get(self, rec_id: UUID) -> RecRow | None:
        """Fetch one recommendation by id, or None."""
        row = await self.db.fetchrow(_GET_SQL, rec_id)
        return _row_to_model(row) if row is not None else None

    async def mark_status(self, rec_id: UUID, status: str) -> None:
        """Advance the lifecycle (forward-only: never demote executed → acted)."""
        current = await self.db.fetchval("SELECT status FROM recommendations WHERE id = $1", rec_id)
        if current is not None and _STATUS_RANK.get(status, 0) < _STATUS_RANK.get(str(current), 0):
            return
        await self.db.execute(_MARK_STATUS_SQL, rec_id, status)

    async def list_executed(self, wallet: str, *, limit: int = 100) -> list[RecRow]:
        """The executed (acted-on-and-confirmed) recommendations for a wallet, newest-first."""
        rows = await self.db.fetch(_LIST_EXECUTED_SQL, wallet.lower(), max(1, min(limit, 200)))
        return [_row_to_model(r) for r in rows]

    async def deposit_tx_for(self, rec_id: UUID) -> str | None:
        """The 0x deposit tx a rec caused (its linked bundle → execution), or None if unacted."""
        tx_hex = await self.db.fetchval(_DEPOSIT_TX_SQL, rec_id)
        return ("0x" + str(tx_hex)) if tx_hex else None

    async def list_acted(self, wallet: str, *, limit: int = 100) -> list[ActedRec]:
        """All acted+submitted recs for a wallet + the deposit tx each caused (newest first)."""
        rows = await self.db.fetch(_LIST_ACTED_SQL, wallet.lower(), max(1, min(limit, 200)))
        return [
            ActedRec(
                rec_id=r["id"],
                title=str(r["title"]),
                strategy_kind=str(r["strategy_kind"]),
                proposed_action=_as_dict(r["proposed_action"]),
                rationale=str(r["rationale"]),
                deposit_tx="0x" + str(r["tx_hex"]),
            )
            for r in rows
        ]


__all__: Sequence[str] = ("ActedRec", "RecInsert", "RecRow", "RecommendationStore", "dedupe_key")
