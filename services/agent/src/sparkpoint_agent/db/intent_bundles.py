"""Store for the unsigned proposals (migration 0021, feature 019 US2).

``intent_bundles`` is the OFFCHAIN record of what the agent proposed — the only state-changing
artifact, and inert (unsigned calldata, ``signature`` never present). Its ``id`` is the
``intent_action_id`` minted at build time and is the US5 per-advice attribution anchor.

NON-CUSTODY (N1/N3/VR-X2/VR-X3): a rejected verdict persists a bundle row with a non-``approved``
``policy_verdict`` and NO signable artifact reaches the client; an ``approved`` bundle MUST
reference a
passing simulation — so :meth:`persist_approved` writes the bundle + its sim + the cross-FK in ONE
transaction. No key, signature, or signed payload is ever stored.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
from uuid import UUID

from .pool import Database
from .simulations import _INSERT_SIM_SQL, SimulationInsert, sim_insert_args

# Insert a bundle WITHOUT the sim FK first (the FK is set after the sim row exists — circular ref).
_INSERT_BUNDLE_SQL = (
    "INSERT INTO intent_bundles ("
    " recommendation_id, user_id, smart_account_address, chain_id, kind, steps,"
    " policy_verdict, policy_version, policy_reasons, exec_mode, expires_at, is_session_key_path"
    ") VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9::jsonb, $10, $11, $12) RETURNING id"
)

_SET_SIM_FK_SQL = "UPDATE intent_bundles SET simulation_result_id = $2 WHERE id = $1"

_GET_SQL = (
    "SELECT id, recommendation_id, user_id, smart_account_address, chain_id, kind, steps,"
    " policy_verdict, policy_version, policy_reasons, simulation_result_id, exec_mode,"
    " expires_at, is_session_key_path, created_at"
    " FROM intent_bundles WHERE id = $1"
)


@dataclass(frozen=True, slots=True)
class BundleInsert:
    """The insertable fields of one bundle (no DB-generated id/created_at/sim FK)."""

    smart_account_address: str
    chain_id: int
    kind: str
    steps: list[dict[str, Any]]
    policy_verdict: str
    policy_version: str
    expires_at: datetime
    policy_reasons: list[dict[str, Any]] = field(default_factory=list)
    recommendation_id: UUID | None = None
    user_id: UUID | None = None
    exec_mode: str = "per_action_user_signature"
    is_session_key_path: bool = False


@dataclass(frozen=True, slots=True)
class BundleRow:
    """One fetched bundle row (read model)."""

    id: UUID
    recommendation_id: UUID | None
    user_id: UUID | None
    smart_account_address: str
    chain_id: int
    kind: str
    steps: list[dict[str, Any]]
    policy_verdict: str
    policy_version: str
    policy_reasons: list[dict[str, Any]]
    simulation_result_id: UUID | None
    exec_mode: str
    expires_at: datetime
    is_session_key_path: bool
    created_at: datetime


def _as_list(raw: Any) -> list[dict[str, Any]]:
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError):
            return []
        return parsed if isinstance(parsed, list) else []
    return raw if isinstance(raw, list) else []


def _bundle_insert_args(b: BundleInsert) -> tuple[Any, ...]:
    return (
        b.recommendation_id,
        b.user_id,
        b.smart_account_address.lower(),
        b.chain_id,
        b.kind,
        json.dumps(b.steps, ensure_ascii=False),
        b.policy_verdict,
        b.policy_version,
        json.dumps(b.policy_reasons, ensure_ascii=False),
        b.exec_mode,
        b.expires_at,
        b.is_session_key_path,
    )


def _row_to_model(r: Any) -> BundleRow:
    return BundleRow(
        id=r["id"],
        recommendation_id=r["recommendation_id"],
        user_id=r["user_id"],
        smart_account_address=str(r["smart_account_address"]),
        chain_id=int(r["chain_id"]),
        kind=str(r["kind"]),
        steps=_as_list(r["steps"]),
        policy_verdict=str(r["policy_verdict"]),
        policy_version=str(r["policy_version"]),
        policy_reasons=_as_list(r["policy_reasons"]),
        simulation_result_id=r["simulation_result_id"],
        exec_mode=str(r["exec_mode"]),
        expires_at=r["expires_at"],
        is_session_key_path=bool(r["is_session_key_path"]),
        created_at=r["created_at"],
    )


@dataclass
class IntentBundleStore:
    """asyncpg-backed store over ``intent_bundles`` (migration 0021)."""

    db: Database

    async def persist_approved(self, bundle: BundleInsert, sim: SimulationInsert) -> UUID:
        """Write an approved bundle + its passing sim + the cross-FK in ONE transaction (VR-X2).

        Returns the new bundle id (the ``intent_action_id``). Order: insert bundle (no sim FK) →
        insert sim (references the bundle) → set the bundle's ``simulation_result_id``.
        """
        async with self.db.acquire() as conn, conn.transaction():
            bundle_id: UUID = await conn.fetchval(_INSERT_BUNDLE_SQL, *_bundle_insert_args(bundle))
            sim_id: UUID = await conn.fetchval(_INSERT_SIM_SQL, *sim_insert_args(bundle_id, sim))
            await conn.execute(_SET_SIM_FK_SQL, bundle_id, sim_id)
            return bundle_id

    async def persist_bundle(self, bundle: BundleInsert) -> UUID:
        """Write a bundle row with NO sim FK. Used for a rejected bundle (audit trail; VR-X3) AND an
        approved EXIT built without a sim (N2 — simulator down but the exit is sacred)."""
        new_id: UUID = await self.db.fetchval(_INSERT_BUNDLE_SQL, *_bundle_insert_args(bundle))
        return new_id

    async def get(self, bundle_id: UUID) -> BundleRow | None:
        """Fetch one bundle by id, or None."""
        row = await self.db.fetchrow(_GET_SQL, bundle_id)
        return _row_to_model(row) if row is not None else None


__all__: Sequence[str] = ("BundleInsert", "BundleRow", "IntentBundleStore")
