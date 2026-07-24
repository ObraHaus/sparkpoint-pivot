"""Mandate persistence — versioned, immutable-per-version rows (data-model.md sec.5).

Backs the §3.1 ``POST/GET/PUT /mandate`` endpoints. A mandate is OFFCHAIN product data:
it holds no key, gates no signature, and never sits on the withdrawal path (N2). It only
ever NARROWS what the onchain allowlist already permits (VR-M5); the deterministic policy
layer re-checks every action regardless, so nothing here can authorize an out-of-policy
move. Losing all of Postgres degrades personalization but cannot move or trap funds.

Persistence invariants (data-model.md sec.5 VR-M1/M2/M4):
  - Editing goals/risk FORKS a new ``version`` (never mutates a confirmed row), preserving
    the exact ruleset that scored any historical recommendation (provability).
  - At most one ``confirmed`` (active) mandate per user; the write supersedes the prior
    confirmed row and repoints ``users.active_mandate_id`` atomically in one transaction.

The store is an injected :class:`MandateStore` Protocol so tests mock it (no live DB is
touched); production uses :class:`PgMandateStore` over the asyncpg pool.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from asyncpg import Record

from .pool import Database


def _iso(value: datetime | None) -> str | None:
    """Render a TIMESTAMPTZ as an ISO-8601 ``...Z`` string (§1.4), or ``None``."""
    if value is None:
        return None
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


@dataclass(frozen=True)
class MandateWrite:
    """The validated, mapped values a confirmed mandate version is persisted from.

    Assembled by the API layer from the §3.1 request body; the store assigns ``version``,
    ``status='confirmed'``, and ``confirmed_at`` itself (the client never sets those).
    """

    risk_tier: str
    risk_score: int
    max_slippage_bps: int
    time_horizon: str | None
    horizon_months: int | None
    drawdown_tolerance: str | None
    allowed_assets: list[str]
    goals: list[dict[str, Any]]
    risk_params: dict[str, Any]
    summary_text: str


@dataclass(frozen=True)
class MandateRecord:
    """A persisted mandate version, rendered to the §3.1 wire shape by :meth:`to_wire`."""

    id: UUID
    version: int
    status: str
    confirmed_at: datetime | None
    risk_tier: str
    max_slippage_bps: int
    horizon_months: int | None
    drawdown_tolerance: str | None
    goals: list[dict[str, Any]]
    risk_params: dict[str, Any]
    summary_text: str

    def to_wire(self) -> dict[str, Any]:
        """The §3.1 mandate object: ``active`` ⟺ this is the user's confirmed version.

        Carries NO signable artifact — no ``proposedAction``, no calldata, no signature.
        """
        return {
            "id": f"mnd_{self.id.hex}",
            "version": self.version,
            "active": self.status == "confirmed",
            "confirmedAt": _iso(self.confirmed_at),
            "riskProfile": self.risk_tier,
            "riskParams": self.risk_params,
            "goals": self.goals,
            "summaryText": self.summary_text,
        }


def _as_json(value: Any) -> Any:
    """Decode a JSONB column (asyncpg returns it as ``str`` without a codec)."""
    return json.loads(value) if isinstance(value, str) else value


def row_to_record(row: Record) -> MandateRecord:
    """Map a ``mandates`` row (the shared column projection) to a :class:`MandateRecord`."""
    return MandateRecord(
        id=row["id"],
        version=row["version"],
        status=str(row["status"]),
        confirmed_at=row["confirmed_at"],
        risk_tier=str(row["risk_tier"]),
        max_slippage_bps=row["max_slippage_bps"],
        horizon_months=row["horizon_months"],
        drawdown_tolerance=row["drawdown_tolerance"],
        goals=_as_json(row["goals"]),
        risk_params=_as_json(row["risk_params"]),
        summary_text=row["summary_text"],
    )


class MandateStore(Protocol):
    """The mandate persistence boundary the §3.1 endpoints depend on (mocked in tests)."""

    async def persist(
        self, *, owner_eoa: str, network_id: str, write: MandateWrite
    ) -> MandateRecord: ...

    async def get_active(
        self, *, owner_eoa: str, network_id: str
    ) -> MandateRecord | None: ...


# Static SQL literals (no interpolation of any caller value — asyncpg binds every
# argument server-side via $-placeholders, so there is no injection surface).
_INSERT_SQL = """
INSERT INTO mandates (
    user_id, network_id, version, status, risk_tier, risk_score,
    max_slippage_bps, time_horizon, horizon_months, drawdown_tolerance,
    allowed_assets, goals, risk_params, summary_text, confirmed_at
) VALUES (
    $1, $2, $3, 'confirmed', $4, $5,
    $6, $7, $8, $9,
    $10, $11::jsonb, $12::jsonb, $13, now()
)
RETURNING id, version, status, confirmed_at, risk_tier, max_slippage_bps,
          horizon_months, drawdown_tolerance, goals, risk_params, summary_text
"""

_SELECT_ACTIVE_SQL = """
SELECT m.id, m.version, m.status, m.confirmed_at, m.risk_tier, m.max_slippage_bps,
       m.horizon_months, m.drawdown_tolerance, m.goals, m.risk_params, m.summary_text
FROM mandates m
JOIN users u ON u.id = m.user_id
WHERE u.eoa_address = $1 AND m.network_id = $2 AND m.status = 'confirmed'
ORDER BY m.version DESC
LIMIT 1
"""


@dataclass
class PgMandateStore:
    """The asyncpg-backed :class:`MandateStore` (production). Every write is one atomic
    transaction so the supersede + insert + active-pointer repoint can never half-apply."""

    db: Database

    async def persist(
        self, *, owner_eoa: str, network_id: str, write: MandateWrite
    ) -> MandateRecord:
        """Fork + confirm a new mandate version for ``owner_eoa`` (FR-002/004, VR-M1/M4).

        Upserts the user (by owner EOA), computes the next ``version``, supersedes the
        prior confirmed row, inserts the new confirmed row, and repoints
        ``users.active_mandate_id`` — all in a single transaction.
        """
        async with self.db.acquire() as conn, conn.transaction():
            user_id = await conn.fetchval(
                "INSERT INTO users (eoa_address) VALUES ($1) "
                "ON CONFLICT (eoa_address) DO UPDATE SET updated_at = now() RETURNING id",
                owner_eoa,
            )
            prev_max = await conn.fetchval(
                "SELECT COALESCE(MAX(version), 0) FROM mandates WHERE user_id = $1", user_id
            )
            # Supersede the prior confirmed version BEFORE inserting the new one so the
            # one-confirmed-per-user partial unique index (VR-M1) never trips.
            await conn.execute(
                "UPDATE mandates SET status = 'superseded', updated_at = now() "
                "WHERE user_id = $1 AND status = 'confirmed'",
                user_id,
            )
            row = await conn.fetchrow(
                _INSERT_SQL,
                user_id,
                network_id,
                int(prev_max) + 1,
                write.risk_tier,
                write.risk_score,
                write.max_slippage_bps,
                write.time_horizon,
                write.horizon_months,
                write.drawdown_tolerance,
                write.allowed_assets,
                json.dumps(write.goals),
                json.dumps(write.risk_params),
                write.summary_text,
            )
            assert row is not None  # noqa: S101 — INSERT ... RETURNING always yields a row
            await conn.execute(
                "UPDATE users SET active_mandate_id = $1, onboarding_state = 'mandated', "
                "updated_at = now() WHERE id = $2",
                row["id"],
                user_id,
            )
            return row_to_record(row)

    async def get_active(
        self, *, owner_eoa: str, network_id: str
    ) -> MandateRecord | None:
        """The user's active (confirmed, highest-version) mandate, or ``None`` (§3.1)."""
        row = await self.db.fetchrow(_SELECT_ACTIVE_SQL, owner_eoa, network_id)
        return row_to_record(row) if row is not None else None

    async def list_active_owners(self, *, network_id: str, limit: int = 100) -> list[str]:
        """Distinct EOAs with a confirmed mandate on a network — the wallets the proactive
        new-recommendation poller re-scores (feature 021 ph.2). Newest-mandated first, bounded."""
        rows = await self.db.fetch(
            "SELECT u.eoa_address, MAX(m.confirmed_at) AS latest FROM mandates m"
            " JOIN users u ON u.id = m.user_id"
            " WHERE m.network_id = $1 AND m.status = 'confirmed'"
            " GROUP BY u.eoa_address ORDER BY latest DESC NULLS LAST LIMIT $2",
            network_id,
            max(1, min(limit, 500)),
        )
        return [str(r["eoa_address"]) for r in rows]
