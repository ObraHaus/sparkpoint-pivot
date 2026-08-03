"""Store for the pre-trade simulation results (migration 0021, feature 019 US2).

One row per bundle-simulation — the mandatory preview backing an ``intent_bundles`` proposal
(data-model.md §12, VR-S1/S2/S3). The INSERT SQL is reused by :mod:`.intent_bundles` so an approved
bundle + its passing sim land in ONE transaction (VR-X2).

NON-CUSTODY (N2/N3/N5): a simulation is an ADVISORY preview — it never gates the withdraw/exit path
and holds no key. Amounts are exact base-unit values; nothing here is a signing input.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from .pool import Database

# Reused by intent_bundles.persist_approved so the bundle + its sim are one transaction. Returns the
# new sim id; ``intent_bundle_id`` is bound first ($1).
_INSERT_SIM_SQL = (
    "INSERT INTO simulation_results ("
    " intent_bundle_id, simulator, sim_block, will_revert, revert_reason,"
    " expected_out_raw, expected_fees_raw, price_impact_bps, estimated_slippage_bps,"
    " balance_deltas, passed, raw_sim_ref"
    ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12) RETURNING id"
)

_GET_BY_BUNDLE_SQL = (
    "SELECT id, intent_bundle_id, simulator, sim_block, will_revert, revert_reason,"
    " expected_out_raw, expected_fees_raw, price_impact_bps, estimated_slippage_bps,"
    " balance_deltas, passed, raw_sim_ref, created_at"
    " FROM simulation_results WHERE intent_bundle_id = $1 ORDER BY created_at DESC LIMIT 1"
)


@dataclass(frozen=True, slots=True)
class SimulationInsert:
    """The insertable fields of one simulation (no DB-generated id/created_at)."""

    simulator: str
    sim_block: int
    will_revert: bool
    passed: bool
    revert_reason: str | None = None
    expected_out_raw: int | None = None
    expected_fees_raw: int | None = None
    price_impact_bps: int | None = None
    estimated_slippage_bps: int | None = None
    balance_deltas: list[dict[str, Any]] = field(default_factory=list)
    raw_sim_ref: str | None = None


@dataclass(frozen=True, slots=True)
class SimulationRow:
    """One fetched simulation row (read model)."""

    id: UUID
    intent_bundle_id: UUID
    simulator: str
    sim_block: int
    will_revert: bool
    revert_reason: str | None
    expected_out_raw: int | None
    expected_fees_raw: int | None
    price_impact_bps: int | None
    estimated_slippage_bps: int | None
    balance_deltas: list[dict[str, Any]]
    passed: bool
    raw_sim_ref: str | None
    created_at: datetime


def _as_list(raw: Any) -> list[dict[str, Any]]:
    """asyncpg returns jsonb as a str by default; tolerate a str, a list, or None."""
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return []
        return parsed if isinstance(parsed, list) else []
    return raw if isinstance(raw, list) else []


def sim_insert_args(intent_bundle_id: UUID, sim: SimulationInsert) -> tuple[Any, ...]:
    """Positional args for :data:`_INSERT_SIM_SQL` (reused by intent_bundles.persist_approved)."""
    return (
        intent_bundle_id,
        sim.simulator,
        sim.sim_block,
        sim.will_revert,
        sim.revert_reason,
        (str(sim.expected_out_raw) if sim.expected_out_raw is not None else None),
        (str(sim.expected_fees_raw) if sim.expected_fees_raw is not None else None),
        sim.price_impact_bps,
        sim.estimated_slippage_bps,
        json.dumps(sim.balance_deltas, ensure_ascii=False),
        sim.passed,
        sim.raw_sim_ref,
    )


def _row_to_model(r: Any) -> SimulationRow:
    return SimulationRow(
        id=r["id"],
        intent_bundle_id=r["intent_bundle_id"],
        simulator=str(r["simulator"]),
        sim_block=int(r["sim_block"]),
        will_revert=bool(r["will_revert"]),
        revert_reason=(str(r["revert_reason"]) if r["revert_reason"] is not None else None),
        expected_out_raw=(
            int(r["expected_out_raw"]) if r["expected_out_raw"] is not None else None
        ),
        expected_fees_raw=(
            int(r["expected_fees_raw"]) if r["expected_fees_raw"] is not None else None
        ),
        price_impact_bps=(
            int(r["price_impact_bps"]) if r["price_impact_bps"] is not None else None
        ),
        estimated_slippage_bps=(
            int(r["estimated_slippage_bps"]) if r["estimated_slippage_bps"] is not None else None
        ),
        balance_deltas=_as_list(r["balance_deltas"]),
        passed=bool(r["passed"]),
        raw_sim_ref=(str(r["raw_sim_ref"]) if r["raw_sim_ref"] is not None else None),
        created_at=r["created_at"],
    )


@dataclass
class SimulationStore:
    """asyncpg-backed store over ``simulation_results`` (migration 0021)."""

    db: Database

    async def create(self, intent_bundle_id: UUID, sim: SimulationInsert) -> UUID:
        """Insert one simulation for a bundle; return the new sim id."""
        new_id: UUID = await self.db.fetchval(
            _INSERT_SIM_SQL, *sim_insert_args(intent_bundle_id, sim)
        )
        return new_id

    async def get_by_bundle(self, intent_bundle_id: UUID) -> SimulationRow | None:
        """The most recent simulation for a bundle, or None."""
        row = await self.db.fetchrow(_GET_BY_BUNDLE_SQL, intent_bundle_id)
        return _row_to_model(row) if row is not None else None


__all__: Sequence[str] = ("SimulationInsert", "SimulationRow", "SimulationStore")
