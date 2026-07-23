"""Store for the SIWE network-gate diagnostic captures (migration 0020).

Persists the client-reported wallet/network snapshot the ``/verify`` beacon posts (forwarded by the
web tier, S2S) so ops can review "wrong network" incidents at ``/admin/diagnostics`` without a log
grep. DISPLAY/DIAGNOSTIC data only: the address is CLIENT-REPORTED (unverified — the capture
happens BEFORE sign-in, when the user is stuck at the network step) and nothing here is ever read on
the withdraw/redeem/exit path (N2) — a stalled table only makes the admin view incomplete.

Parameterized SQL only; the store takes a narrow executor so tests can drive it with a fake.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class DiagnosticCapture:
    """The insertable fields of one capture (no DB-generated id/created_at)."""

    reason: str
    address: str | None
    wagmi_chain_id: int | None
    wallet_chain_id: int | None
    chain_mismatch: bool | None
    wagmi_status: str | None
    connector_id: str | None
    connector_name: str | None
    is_metamask: bool | None
    injected_count: int | None
    injected_names: tuple[str, ...] = ()
    user_agent: str | None = None
    build_id: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class NetworkDiagnostic:
    """One fetched capture row (read model). Addresses are lowercased + UNVERIFIED."""

    id: int
    created_at: datetime
    reason: str
    address: str | None
    wagmi_chain_id: int | None
    wallet_chain_id: int | None
    chain_mismatch: bool | None
    wagmi_status: str | None
    connector_id: str | None
    connector_name: str | None
    is_metamask: bool | None
    injected_count: int | None
    injected_names: tuple[str, ...]
    user_agent: str | None
    build_id: str | None
    raw: dict[str, Any]


class NetworkDiagnosticStore(Protocol):
    """Persistence port for the diagnostics table (mockable in tests)."""

    async def record(self, cap: DiagnosticCapture) -> int:
        """Insert one capture; return the new row id."""
        ...

    async def list(
        self, *, limit: int = 100, address: str | None = None, mismatch_only: bool = False
    ) -> list[NetworkDiagnostic]: ...


class _Executor(Protocol):
    """The subset of ``db.pool.Database`` the store needs (keeps this module import-light)."""

    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any: ...
    async def fetch(self, query: str, *args: Any) -> list[Any]: ...


def _as_dict(raw: Any) -> dict[str, Any]:
    """asyncpg returns jsonb as a str by default; tolerate a str, a dict, or None."""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return raw if isinstance(raw, dict) else {}


def _row_to_model(r: Any) -> NetworkDiagnostic:
    names = r["injected_names"] or []
    return NetworkDiagnostic(
        id=int(r["id"]),
        created_at=r["created_at"],
        reason=str(r["reason"]),
        address=(str(r["address"]) if r["address"] is not None else None),
        wagmi_chain_id=(int(r["wagmi_chain_id"]) if r["wagmi_chain_id"] is not None else None),
        wallet_chain_id=(int(r["wallet_chain_id"]) if r["wallet_chain_id"] is not None else None),
        chain_mismatch=(bool(r["chain_mismatch"]) if r["chain_mismatch"] is not None else None),
        wagmi_status=(str(r["wagmi_status"]) if r["wagmi_status"] is not None else None),
        connector_id=(str(r["connector_id"]) if r["connector_id"] is not None else None),
        connector_name=(str(r["connector_name"]) if r["connector_name"] is not None else None),
        is_metamask=(bool(r["is_metamask"]) if r["is_metamask"] is not None else None),
        injected_count=(int(r["injected_count"]) if r["injected_count"] is not None else None),
        injected_names=tuple(str(n) for n in names),
        user_agent=(str(r["user_agent"]) if r["user_agent"] is not None else None),
        build_id=(str(r["build_id"]) if r["build_id"] is not None else None),
        raw=_as_dict(r["raw"]),
    )


class PgNetworkDiagnosticStore:
    """asyncpg-backed store over ``network_diagnostics`` (migration 0020)."""

    def __init__(self, db: _Executor) -> None:
        self._db = db

    async def record(self, cap: DiagnosticCapture) -> int:
        new_id = await self._db.fetchval(
            """
            INSERT INTO network_diagnostics (
                reason, address, wagmi_chain_id, wallet_chain_id, chain_mismatch,
                wagmi_status, connector_id, connector_name, is_metamask,
                injected_count, injected_names, user_agent, build_id, raw
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
            RETURNING id
            """,
            cap.reason,
            (cap.address.lower() if cap.address else None),
            cap.wagmi_chain_id,
            cap.wallet_chain_id,
            cap.chain_mismatch,
            cap.wagmi_status,
            cap.connector_id,
            cap.connector_name,
            cap.is_metamask,
            cap.injected_count,
            list(cap.injected_names),
            cap.user_agent,
            cap.build_id,
            json.dumps(cap.raw),
        )
        return int(new_id)

    async def list(
        self, *, limit: int = 100, address: str | None = None, mismatch_only: bool = False
    ) -> list[NetworkDiagnostic]:
        rows = await self._db.fetch(
            """
            SELECT id, created_at, reason, address, wagmi_chain_id, wallet_chain_id, chain_mismatch,
                   wagmi_status, connector_id, connector_name, is_metamask, injected_count,
                   injected_names, user_agent, build_id, raw
            FROM network_diagnostics
            WHERE ($2::text IS NULL OR address = $2)
              AND ($3::boolean IS FALSE OR chain_mismatch IS TRUE)
            ORDER BY created_at DESC, id DESC
            LIMIT $1
            """,
            max(1, min(limit, 500)),
            (address.lower() if address else None),
            mismatch_only,
        )
        return [_row_to_model(r) for r in rows]
