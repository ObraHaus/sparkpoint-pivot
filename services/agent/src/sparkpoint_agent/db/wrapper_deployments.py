"""Feature 049 — wrapper deploy requests + results (migration 0039), DISPLAY/QUEUE ONLY.

An admin REQUESTS a wrapper deployment; the keyless agent serves pending requests to the
deterministic deploy runner; the runner (which holds the scoped deploy-only hot key) REPORTS the
result. Nothing here grants on-chain authority: the factory's curated allowlist, deployer role,
fee cap and caps bounds are all enforced in Solidity (constitution v4.0.0).

Fail-open on an unapplied DB: every method degrades to empty/no-op with one warning, so an agent
deployed ahead of migration 0039 shows an empty queue instead of 500-ing the admin panel.
"""

# ruff: noqa: S608 — this module interpolates only the module-level _COLUMNS constant into SQL;
# every value is bound as an asyncpg parameter.

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from asyncpg.exceptions import UndefinedTableError

logger = logging.getLogger(__name__)

REQUESTED = "requested"
DEPLOYED = "deployed"
FAILED = "failed"
CANCELLED = "cancelled"

_STATUSES = (REQUESTED, DEPLOYED, FAILED, CANCELLED)

#: Server-side parameter bounds (the DB CHECK repeats fee_bps; the factory repeats them all).
MAX_FEE_BPS = 2000
MAX_UINT256 = (1 << 256) - 1


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


@dataclass(frozen=True)
class WrapperDeployment:
    """One deploy request / result row, as the admin panel and the runner see it."""

    id: str
    chain_id: int
    child_address: str
    fee_bps: int
    per_user_cap: int
    total_cap: int
    vault_cap: int
    name: str
    symbol: str
    label: str
    status: str
    requested_by: str | None
    requested_at: str
    tx_hash: str | None
    proxy_address: str | None
    cap_registry: str | None
    error: str | None
    reported_at: str | None
    runner_commit: str | None

    def to_wire(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "chainId": self.chain_id,
            "childAddress": self.child_address,
            "feeBps": self.fee_bps,
            "perUserCap": str(self.per_user_cap),
            "totalCap": str(self.total_cap),
            "vaultCap": str(self.vault_cap),
            "name": self.name,
            "symbol": self.symbol,
            "label": self.label,
            "status": self.status,
            "requestedBy": self.requested_by,
            "requestedAt": self.requested_at,
            "txHash": self.tx_hash,
            "proxyAddress": self.proxy_address,
            "capRegistry": self.cap_registry,
            "error": self.error,
            "reportedAt": self.reported_at,
            "runnerCommit": self.runner_commit,
        }


class DeploymentStore(Protocol):
    """The narrow persistence port the API + runner need (a fake satisfies it in tests)."""

    async def request(
        self,
        chain_id: int,
        *,
        child_address: str,
        fee_bps: int,
        per_user_cap: int,
        total_cap: int,
        vault_cap: int,
        name: str,
        symbol: str,
        label: str,
        actor: str | None,
    ) -> WrapperDeployment: ...

    async def list_deployments(
        self, chain_id: int, *, status: str | None = None, limit: int = 100
    ) -> list[WrapperDeployment]: ...

    async def pending(self, chain_id: int, *, limit: int = 20) -> list[WrapperDeployment]: ...

    async def get(self, chain_id: int, deployment_id: str) -> WrapperDeployment | None: ...

    async def report(
        self,
        chain_id: int,
        *,
        deployment_id: str,
        ok: bool,
        tx_hash: str | None,
        proxy_address: str | None,
        cap_registry: str | None,
        error: str | None,
        runner_commit: str | None,
    ) -> bool: ...

    async def cancel(self, chain_id: int, *, deployment_id: str, actor: str | None) -> bool: ...


_COLUMNS = (
    "id, chain_id, child_address, fee_bps, per_user_cap, total_cap, vault_cap, name, symbol, "
    "label, status, requested_by, requested_at, tx_hash, proxy_address, cap_registry, error, "
    "reported_at, runner_commit"
)


class PgDeploymentStore:
    """asyncpg-backed :class:`DeploymentStore` (migration 0039)."""

    def __init__(self, db: Any) -> None:
        self._db = db

    async def request(
        self,
        chain_id: int,
        *,
        child_address: str,
        fee_bps: int,
        per_user_cap: int,
        total_cap: int,
        vault_cap: int,
        name: str,
        symbol: str,
        label: str,
        actor: str | None,
    ) -> WrapperDeployment:
        row = await self._db.fetchrow(
            f"""
            INSERT INTO wrapper_deployments (
                chain_id, child_address, fee_bps, per_user_cap, total_cap, vault_cap,
                name, symbol, label, requested_by
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            RETURNING {_COLUMNS}
            """,
            chain_id,
            child_address.strip().lower(),
            fee_bps,
            per_user_cap,
            total_cap,
            vault_cap,
            name,
            symbol,
            label,
            actor.strip().lower() if actor else None,
        )
        return _row_to_deployment(row)

    async def list_deployments(
        self, chain_id: int, *, status: str | None = None, limit: int = 100
    ) -> list[WrapperDeployment]:
        try:
            rows = await self._db.fetch(
                f"""
                SELECT {_COLUMNS} FROM wrapper_deployments
                 WHERE chain_id = $1 AND ($2::text IS NULL OR status = $2)
                 ORDER BY requested_at DESC LIMIT $3
                """,
                chain_id,
                status,
                max(1, min(limit, 500)),
            )
        except UndefinedTableError:
            logger.warning("wrapper_deployments table absent (migration 0039 unapplied)")
            return []
        return [_row_to_deployment(r) for r in rows]

    async def pending(self, chain_id: int, *, limit: int = 20) -> list[WrapperDeployment]:
        try:
            rows = await self._db.fetch(
                f"""
                SELECT {_COLUMNS} FROM wrapper_deployments
                 WHERE chain_id = $1 AND status = 'requested'
                 ORDER BY requested_at ASC LIMIT $2
                """,
                chain_id,
                max(1, min(limit, 100)),
            )
        except UndefinedTableError:
            return []
        return [_row_to_deployment(r) for r in rows]

    async def get(self, chain_id: int, deployment_id: str) -> WrapperDeployment | None:
        try:
            rows = await self._db.fetch(
                f"SELECT {_COLUMNS} FROM wrapper_deployments WHERE chain_id = $1 AND id = $2",
                chain_id,
                deployment_id,
            )
        except UndefinedTableError:
            return None
        return _row_to_deployment(rows[0]) if rows else None

    async def report(
        self,
        chain_id: int,
        *,
        deployment_id: str,
        ok: bool,
        tx_hash: str | None,
        proxy_address: str | None,
        cap_registry: str | None,
        error: str | None,
        runner_commit: str | None,
    ) -> bool:
        """Record the runner's result. Only a `requested` row resolves (idempotent retries)."""
        try:
            status = await self._db.execute(
                """
                UPDATE wrapper_deployments
                   SET status = $3,
                       tx_hash = $4,
                       proxy_address = $5,
                       cap_registry = $6,
                       error = $7,
                       runner_commit = $8,
                       reported_at = now(),
                       updated_at = now()
                 WHERE chain_id = $1 AND id = $2 AND status = 'requested'
                """,
                chain_id,
                deployment_id,
                DEPLOYED if ok else FAILED,
                tx_hash.lower() if tx_hash else None,
                proxy_address.lower() if proxy_address else None,
                cap_registry.lower() if cap_registry else None,
                (error or "")[:1000] or None,
                runner_commit,
            )
        except UndefinedTableError:
            return False
        return str(status).strip().endswith("1")

    async def cancel(self, chain_id: int, *, deployment_id: str, actor: str | None) -> bool:
        try:
            status = await self._db.execute(
                """
                UPDATE wrapper_deployments
                   SET status = 'cancelled', updated_at = now()
                 WHERE chain_id = $1 AND id = $2 AND status = 'requested'
                """,
                chain_id,
                deployment_id,
            )
        except UndefinedTableError:
            return False
        return str(status).strip().endswith("1")


def _row_to_deployment(row: Any) -> WrapperDeployment:
    return WrapperDeployment(
        id=str(row["id"]),
        chain_id=int(row["chain_id"]),
        child_address=str(row["child_address"]),
        fee_bps=int(row["fee_bps"]),
        per_user_cap=int(row["per_user_cap"]),
        total_cap=int(row["total_cap"]),
        vault_cap=int(row["vault_cap"]),
        name=str(row["name"]),
        symbol=str(row["symbol"]),
        label=str(row["label"]),
        status=str(row["status"]),
        requested_by=row["requested_by"],
        requested_at=_iso(row["requested_at"]) or "",
        tx_hash=row["tx_hash"],
        proxy_address=row["proxy_address"],
        cap_registry=row["cap_registry"],
        error=row["error"],
        reported_at=_iso(row["reported_at"]),
        runner_commit=row["runner_commit"],
    )
