"""Feature 049 v4.1.0 — the admission mirror (migration 0040), DISPLAY/QUEUE ONLY.

The V3 factory is the only admission gate; this store records what the chain already decided —
the AI's cooldown-gated admission, the admin's instant admission/release/cancel, and the deploy
result — so the admin panel can render a queue with a countdown and the runner can be handed
unwrapped candidates with deterministic params.

Fail-open on an unapplied DB: every method degrades to empty/no-op with one warning, so an agent
deployed ahead of migration 0040 shows an empty queue instead of 500-ing the admin panel.
"""

# ruff: noqa: S608 — this module interpolates only the module-level _COLUMNS constant into SQL;
# every value is bound as an asyncpg parameter.

from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from asyncpg.exceptions import UndefinedTableError

logger = logging.getLogger(__name__)

PENDING = "pending"
DEPLOYED = "deployed"
CANCELLED = "cancelled"
FAILED = "failed"

_STATUSES = (PENDING, DEPLOYED, CANCELLED, FAILED)

#: Server-side parameter bounds (the DB CHECK repeats fee_bps; the factory repeats them all).
MAX_FEE_BPS = 2000
MAX_UINT256 = (1 << 256) - 1

#: CapRegistry defaults (contracts/src/governance/CapRegistry.sol), in whole asset units. The web
#: form's `CAP_DEFAULTS` is the same constant; the two MUST stay in sync (lib/curation/caps.ts).
CAP_DEFAULTS_WHOLE = {"perUser": 5_000, "total": 1_000_000, "vault": 1_000_000}
DEFAULT_FEE_BPS = 1000


def default_wrapper_params(
    *, label: str, asset_symbol: str | None, asset_decimals: int | None
) -> dict[str, Any]:
    """Deterministic wrapper params for an AI admission (mirrors the panel's P11 request form).

    Caps scale from the CapRegistry defaults by the curated asset's decimals (6-dp USDG → the
    canonical 5k / 1M / 1M token-unit caps). Names mirror the panel: `name = label`,
    `symbol = "sp" + sanitized asset symbol` (≤20 chars), `label = "<label> · SparkPoint wrapper"`.
    """
    decimals = asset_decimals if asset_decimals is not None and 0 <= asset_decimals <= 36 else 6
    scale = 10**decimals
    base = re.sub(r"[^A-Za-z0-9]", "", asset_symbol or "USDG") or "USDG"
    return {
        "fee_bps": DEFAULT_FEE_BPS,
        "per_user_cap": CAP_DEFAULTS_WHOLE["perUser"] * scale,
        "total_cap": CAP_DEFAULTS_WHOLE["total"] * scale,
        "vault_cap": CAP_DEFAULTS_WHOLE["vault"] * scale,
        "name": label[:80],
        "symbol": f"sp{base}"[:20],
        "label": f"{label} · SparkPoint wrapper"[:200],
    }


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


@dataclass(frozen=True)
class WrapperWhitelistEntry:
    """One admission record, as the admin panel and the runner see it."""

    id: str
    chain_id: int
    child_address: str
    by_address: str | None
    ready_at: int
    fee_bps: int
    per_user_cap: int
    total_cap: int
    vault_cap: int
    name: str
    symbol: str
    label: str
    status: str
    tx_hash: str | None
    proxy_address: str | None
    cap_registry: str | None
    error: str | None
    runner_commit: str | None
    recorded_by: str | None
    reported_at: str | None
    deployed_at: str | None
    cancelled_at: str | None
    created_at: str
    updated_at: str

    @property
    def ready(self) -> bool:
        """Deployable now: an admin entry (ready_at 0) or an elapsed AI cooldown."""
        return self.status == PENDING and (self.ready_at == 0 or self.ready_at <= int(time.time()))

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "chainId": self.chain_id,
            "childAddress": self.child_address,
            "byAddress": self.by_address,
            "readyAt": self.ready_at,
            "ready": self.ready,
            "feeBps": self.fee_bps,
            "perUserCap": str(self.per_user_cap),
            "totalCap": str(self.total_cap),
            "vaultCap": str(self.vault_cap),
            "name": self.name,
            "symbol": self.symbol,
            "label": self.label,
            "status": self.status,
            "txHash": self.tx_hash,
            "proxyAddress": self.proxy_address,
            "capRegistry": self.cap_registry,
            "error": self.error,
            "runnerCommit": self.runner_commit,
            "recordedBy": self.recorded_by,
            "reportedAt": self.reported_at,
            "deployedAt": self.deployed_at,
            "cancelledAt": self.cancelled_at,
            "createdAt": self.created_at,
            "updatedAt": self.updated_at,
        }


class WhitelistStore(Protocol):
    """The narrow persistence port the API needs (a fake satisfies it in tests)."""

    async def list_entries(
        self, chain_id: int, *, limit: int = 200
    ) -> list[WrapperWhitelistEntry]: ...

    async def latest_by_child(self, chain_id: int) -> dict[str, WrapperWhitelistEntry]: ...

    async def get_latest(
        self, chain_id: int, child_address: str
    ) -> WrapperWhitelistEntry | None: ...

    async def record_whitelist(
        self,
        chain_id: int,
        *,
        child_address: str,
        by_address: str | None,
        ready_at: int,
        fee_bps: int,
        per_user_cap: int,
        total_cap: int,
        vault_cap: int,
        name: str,
        symbol: str,
        label: str,
        tx_hash: str | None,
        actor: str | None,
        runner_commit: str | None = None,
    ) -> WrapperWhitelistEntry: ...

    async def record_deploy(
        self,
        chain_id: int,
        *,
        child_address: str,
        tx_hash: str | None,
        proxy_address: str | None,
        cap_registry: str | None,
        actor: str | None,
        runner_commit: str | None = None,
    ) -> WrapperWhitelistEntry | None: ...

    async def record_cancel(
        self, chain_id: int, *, child_address: str, actor: str | None
    ) -> WrapperWhitelistEntry | None: ...

    async def record_release(
        self, chain_id: int, *, child_address: str, actor: str | None
    ) -> WrapperWhitelistEntry | None: ...

    async def record_failure(
        self,
        chain_id: int,
        *,
        child_address: str,
        error: str | None,
        tx_hash: str | None,
        actor: str | None,
        runner_commit: str | None = None,
    ) -> WrapperWhitelistEntry | None: ...


_COLUMNS = (
    "id, chain_id, child_address, by_address, ready_at, fee_bps, per_user_cap, total_cap, "
    "vault_cap, name, symbol, label, status, tx_hash, proxy_address, cap_registry, error, "
    "runner_commit, recorded_by, reported_at, deployed_at, cancelled_at, created_at, updated_at"
)


class PgWhitelistStore:
    """asyncpg-backed :class:`WhitelistStore` (migration 0040)."""

    def __init__(self, db: Any) -> None:
        self._db = db

    async def list_entries(
        self, chain_id: int, *, limit: int = 200
    ) -> list[WrapperWhitelistEntry]:
        try:
            rows = await self._db.fetch(
                f"""
                SELECT {_COLUMNS} FROM wrapper_whitelist
                 WHERE chain_id = $1
                 ORDER BY updated_at DESC LIMIT $2
                """,
                chain_id,
                max(1, min(limit, 500)),
            )
        except UndefinedTableError:
            logger.warning("wrapper_whitelist table absent (migration 0040 unapplied)")
            return []
        return [_row_to_entry(r) for r in rows]

    async def latest_by_child(self, chain_id: int) -> dict[str, WrapperWhitelistEntry]:
        """The newest row per child (DISTINCT ON keeps the latest created_at)."""
        try:
            rows = await self._db.fetch(
                f"""
                SELECT DISTINCT ON (child_address) {_COLUMNS}
                  FROM wrapper_whitelist
                 WHERE chain_id = $1
                 ORDER BY child_address, created_at DESC
                """,
                chain_id,
            )
        except UndefinedTableError:
            return {}
        return {str(r["child_address"]): _row_to_entry(r) for r in rows}

    async def get_latest(
        self, chain_id: int, child_address: str
    ) -> WrapperWhitelistEntry | None:
        try:
            row = await self._db.fetchrow(
                f"""
                SELECT {_COLUMNS} FROM wrapper_whitelist
                 WHERE chain_id = $1 AND child_address = $2
                 ORDER BY created_at DESC LIMIT 1
                """,
                chain_id,
                child_address.strip().lower(),
            )
        except UndefinedTableError:
            return None
        return _row_to_entry(row) if row else None

    async def record_whitelist(
        self,
        chain_id: int,
        *,
        child_address: str,
        by_address: str | None,
        ready_at: int,
        fee_bps: int,
        per_user_cap: int,
        total_cap: int,
        vault_cap: int,
        name: str,
        symbol: str,
        label: str,
        tx_hash: str | None,
        actor: str | None,
        runner_commit: str | None = None,
    ) -> WrapperWhitelistEntry:
        """Insert a pending admission — or refresh the existing pending row for this child.

        A landed-but-unreported whitelist is naturally idempotent: the second record updates the
        same pending row instead of creating a duplicate.
        """
        child = child_address.strip().lower()
        existing = await self.get_latest(chain_id, child)
        if existing is not None and existing.status == PENDING:
            row = await self._db.fetchrow(
                f"""
                UPDATE wrapper_whitelist
                   SET by_address = $3, ready_at = $4, fee_bps = $5, per_user_cap = $6,
                       total_cap = $7, vault_cap = $8, name = $9, symbol = $10, label = $11,
                       tx_hash = $12, runner_commit = COALESCE($13, runner_commit),
                       recorded_by = COALESCE($14, recorded_by), updated_at = now()
                 WHERE chain_id = $1 AND child_address = $2 AND status = 'pending'
                RETURNING {_COLUMNS}
                """,
                chain_id,
                child,
                by_address.lower() if by_address else None,
                ready_at,
                fee_bps,
                per_user_cap,
                total_cap,
                vault_cap,
                name,
                symbol,
                label,
                tx_hash.lower() if tx_hash else None,
                runner_commit,
                actor,
            )
            return _row_to_entry(row)
        row = await self._db.fetchrow(
            f"""
            INSERT INTO wrapper_whitelist (
                chain_id, child_address, by_address, ready_at, fee_bps, per_user_cap, total_cap,
                vault_cap, name, symbol, label, tx_hash, recorded_by, runner_commit
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING {_COLUMNS}
            """,
            chain_id,
            child,
            by_address.lower() if by_address else None,
            ready_at,
            fee_bps,
            per_user_cap,
            total_cap,
            vault_cap,
            name,
            symbol,
            label,
            tx_hash.lower() if tx_hash else None,
            actor,
            runner_commit,
        )
        return _row_to_entry(row)

    async def record_deploy(
        self,
        chain_id: int,
        *,
        child_address: str,
        tx_hash: str | None,
        proxy_address: str | None,
        cap_registry: str | None,
        actor: str | None,
        runner_commit: str | None = None,
    ) -> WrapperWhitelistEntry | None:
        """Resolve the latest pending admission for this child to `deployed` (idempotent)."""
        try:
            row = await self._db.fetchrow(
                f"""
                UPDATE wrapper_whitelist
                   SET status = 'deployed', tx_hash = COALESCE($3, tx_hash),
                       proxy_address = COALESCE($4, proxy_address),
                       cap_registry = COALESCE($5, cap_registry),
                       runner_commit = COALESCE($6, runner_commit),
                       recorded_by = COALESCE($7, recorded_by), reported_at = now(),
                       deployed_at = now(), updated_at = now()
                 WHERE id = (
                     SELECT id FROM wrapper_whitelist
                      WHERE chain_id = $1 AND child_address = $2 AND status = 'pending'
                      ORDER BY created_at DESC LIMIT 1
                 )
                RETURNING {_COLUMNS}
                """,
                chain_id,
                child_address.strip().lower(),
                tx_hash.lower() if tx_hash else None,
                proxy_address.lower() if proxy_address else None,
                cap_registry.lower() if cap_registry else None,
                runner_commit,
                actor,
            )
        except UndefinedTableError:
            return None
        return _row_to_entry(row) if row else None

    async def record_cancel(
        self, chain_id: int, *, child_address: str, actor: str | None
    ) -> WrapperWhitelistEntry | None:
        try:
            row = await self._db.fetchrow(
                f"""
                UPDATE wrapper_whitelist
                   SET status = 'cancelled', recorded_by = COALESCE($3, recorded_by),
                       cancelled_at = now(), updated_at = now()
                 WHERE id = (
                     SELECT id FROM wrapper_whitelist
                      WHERE chain_id = $1 AND child_address = $2 AND status = 'pending'
                      ORDER BY created_at DESC LIMIT 1
                 )
                RETURNING {_COLUMNS}
                """,
                chain_id,
                child_address.strip().lower(),
                actor,
            )
        except UndefinedTableError:
            return None
        return _row_to_entry(row) if row else None

    async def record_release(
        self, chain_id: int, *, child_address: str, actor: str | None
    ) -> WrapperWhitelistEntry | None:
        """`releaseNow`: zero a pending AI entry's cooldown so it can be deployed immediately."""
        try:
            row = await self._db.fetchrow(
                f"""
                UPDATE wrapper_whitelist
                   SET ready_at = 0, recorded_by = COALESCE($3, recorded_by), updated_at = now()
                 WHERE id = (
                     SELECT id FROM wrapper_whitelist
                      WHERE chain_id = $1 AND child_address = $2 AND status = 'pending'
                      ORDER BY created_at DESC LIMIT 1
                 )
                RETURNING {_COLUMNS}
                """,
                chain_id,
                child_address.strip().lower(),
                actor,
            )
        except UndefinedTableError:
            return None
        return _row_to_entry(row) if row else None

    async def record_failure(
        self,
        chain_id: int,
        *,
        child_address: str,
        error: str | None,
        tx_hash: str | None,
        actor: str | None,
        runner_commit: str | None = None,
    ) -> WrapperWhitelistEntry | None:
        try:
            row = await self._db.fetchrow(
                f"""
                UPDATE wrapper_whitelist
                   SET status = 'failed', error = $3, tx_hash = COALESCE($4, tx_hash),
                       runner_commit = COALESCE($5, runner_commit),
                       recorded_by = COALESCE($6, recorded_by), reported_at = now(),
                       updated_at = now()
                 WHERE id = (
                     SELECT id FROM wrapper_whitelist
                      WHERE chain_id = $1 AND child_address = $2 AND status = 'pending'
                      ORDER BY created_at DESC LIMIT 1
                 )
                RETURNING {_COLUMNS}
                """,
                chain_id,
                child_address.strip().lower(),
                (error or "")[:1000] or None,
                tx_hash.lower() if tx_hash else None,
                runner_commit,
                actor,
            )
        except UndefinedTableError:
            return None
        return _row_to_entry(row) if row else None


def _row_to_entry(row: Any) -> WrapperWhitelistEntry:
    return WrapperWhitelistEntry(
        id=str(row["id"]),
        chain_id=int(row["chain_id"]),
        child_address=str(row["child_address"]),
        by_address=row["by_address"],
        ready_at=int(row["ready_at"]),
        fee_bps=int(row["fee_bps"]),
        per_user_cap=int(row["per_user_cap"]),
        total_cap=int(row["total_cap"]),
        vault_cap=int(row["vault_cap"]),
        name=str(row["name"]),
        symbol=str(row["symbol"]),
        label=str(row["label"]),
        status=str(row["status"]),
        tx_hash=row["tx_hash"],
        proxy_address=row["proxy_address"],
        cap_registry=row["cap_registry"],
        error=row["error"],
        runner_commit=row["runner_commit"],
        recorded_by=row["recorded_by"],
        reported_at=_iso(row["reported_at"]),
        deployed_at=_iso(row["deployed_at"]),
        cancelled_at=_iso(row["cancelled_at"]),
        created_at=_iso(row["created_at"]) or "",
        updated_at=_iso(row["updated_at"]) or "",
    )
