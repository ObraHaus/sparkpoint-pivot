"""Authoritative store for the feature-011 branded-wrapper PROVENANCE (migration 0016).

Two 011-owned tables (see ``migrations/0016_vault_factory.sql``):

  * ``morpho_curated_allowlist`` — the off-chain VETTING record behind each on-chain allowlist add
    (the on-chain ``morphoAllowlist[addr]`` mapping is the enforcement; this row is the rationale).
  * ``sparkpoint_wrappers`` — provenance the 010 vault reader MERGES with its static registry; the
    admin create flow inserts a ``pending`` row here, promoted to ``live`` once the wrapper's
    on-chain provenance verifies.

NON-CUSTODY (N1/N2): pure provenance/access records. Nothing stored here is EVER a signing input or
a fund path — the admin BFF only READS these and returns prepared calldata the operator signs
off-app; the on-chain wrapper's withdraw/redeem escape hatch never depends on a row here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .pool import Database

# ── sparkpoint_wrappers ──────────────────────────────────────────────────────
_LIST_WRAPPERS_SQL = (
    "SELECT vault_address, chain_id, kind, label, morpho_vault, native_fee_bps, "
    "deploy_tx, factory_address, status, created_at "
    "FROM sparkpoint_wrappers ORDER BY created_at DESC"
)
_GET_WRAPPER_SQL = (
    "SELECT vault_address, chain_id, kind, label, morpho_vault, native_fee_bps, "
    "deploy_tx, factory_address, status, created_at "
    "FROM sparkpoint_wrappers WHERE chain_id = $1 AND vault_address = $2"
)
_INSERT_WRAPPER_SQL = """
INSERT INTO sparkpoint_wrappers
    (vault_address, chain_id, kind, label, morpho_vault, native_fee_bps, factory_address, status)
VALUES ($1, $2, 'morpho_wrapper', $3, $4, $5, $6, 'pending')
ON CONFLICT (chain_id, vault_address) DO UPDATE SET
    label = EXCLUDED.label, morpho_vault = EXCLUDED.morpho_vault,
    native_fee_bps = EXCLUDED.native_fee_bps, factory_address = EXCLUDED.factory_address
""".strip()
# Promote-only: the `status = 'pending'` guard makes this NEVER demote a `live` row (a no-op for
# anything already promoted) — status only ever moves forward pending → live.
_MARK_WRAPPER_LIVE_SQL = (
    "UPDATE sparkpoint_wrappers SET status = 'live' "
    "WHERE chain_id = $1 AND vault_address = $2 AND status = 'pending'"
)

# ── morpho_curated_allowlist ─────────────────────────────────────────────────
_GET_ALLOWLIST_SQL = (
    "SELECT morpho_vault, chain_id, allowed, curator, label, native_fee_bps, vetting_notes, "
    "oracle_notes, gates_notes, timelock_notes, allowlisted_tx, status, created_at, updated_at "
    "FROM morpho_curated_allowlist WHERE chain_id = $1 AND morpho_vault = $2"
)
_LIST_ALLOWLIST_SQL = (
    "SELECT morpho_vault, chain_id, allowed, curator, label, native_fee_bps, vetting_notes, "
    "status, updated_at "
    "FROM morpho_curated_allowlist WHERE chain_id = $1 ORDER BY updated_at DESC"
)
_UPSERT_ALLOWLIST_SQL = """
INSERT INTO morpho_curated_allowlist
    (morpho_vault, chain_id, allowed, curator, label, native_fee_bps,
     vetting_notes, oracle_notes, gates_notes, timelock_notes, status, author, updated_at)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
ON CONFLICT (chain_id, morpho_vault) DO UPDATE SET
    allowed = EXCLUDED.allowed, curator = EXCLUDED.curator, label = EXCLUDED.label,
    native_fee_bps = EXCLUDED.native_fee_bps, vetting_notes = EXCLUDED.vetting_notes,
    oracle_notes = EXCLUDED.oracle_notes, gates_notes = EXCLUDED.gates_notes,
    timelock_notes = EXCLUDED.timelock_notes, status = EXCLUDED.status,
    author = EXCLUDED.author, updated_at = now()
""".strip()


def _row(record: Any) -> dict[str, Any]:
    """asyncpg ``Record`` → plain dict with ISO timestamps (JSON-serialisable)."""
    out: dict[str, Any] = {}
    for key in record.keys():
        value = record[key]
        out[key] = value.isoformat() if hasattr(value, "isoformat") else value
    return out


@dataclass
class VaultFactoryStore:
    """asyncpg-backed store for ``sparkpoint_wrappers`` + ``morpho_curated_allowlist``."""

    db: Database

    # ── wrappers ──
    async def list_wrappers(self) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_LIST_WRAPPERS_SQL)
        return [_row(r) for r in rows]

    async def get_wrapper(self, chain_id: int, vault_address: str) -> dict[str, Any] | None:
        r = await self.db.fetchrow(_GET_WRAPPER_SQL, chain_id, vault_address.lower())
        return _row(r) if r is not None else None

    async def insert_pending_wrapper(
        self,
        *,
        vault_address: str,
        chain_id: int,
        label: str,
        morpho_vault: str,
        native_fee_bps: int | None,
        factory_address: str | None,
    ) -> None:
        await self.db.execute(
            _INSERT_WRAPPER_SQL,
            vault_address.lower(),
            chain_id,
            label,
            morpho_vault.lower(),
            native_fee_bps,
            factory_address.lower() if factory_address else None,
        )

    async def mark_wrapper_live(self, vault_address: str, chain_id: int) -> None:
        """Promote a ``pending`` provenance row to ``live`` once the on-chain factory ATTESTS the
        wrapper (``factory.isSparkPointVault``). Promote-only: the ``status = 'pending'`` guard
        means this NEVER demotes a ``live`` row and is a no-op once already promoted (N1/N2 —
        provenance only, never a fund path)."""
        await self.db.execute(_MARK_WRAPPER_LIVE_SQL, chain_id, vault_address.lower())

    # ── curated allowlist ──
    async def get_allowlist_record(
        self, chain_id: int, morpho_vault: str
    ) -> dict[str, Any] | None:
        r = await self.db.fetchrow(_GET_ALLOWLIST_SQL, chain_id, morpho_vault.lower())
        return _row(r) if r is not None else None

    async def list_allowlist_records(self, chain_id: int) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_LIST_ALLOWLIST_SQL, chain_id)
        return [_row(r) for r in rows]

    async def upsert_allowlist_record(
        self,
        *,
        morpho_vault: str,
        chain_id: int,
        allowed: bool,
        curator: str | None = None,
        label: str | None = None,
        native_fee_bps: int | None = None,
        vetting_notes: str | None = None,
        oracle_notes: str | None = None,
        gates_notes: str | None = None,
        timelock_notes: str | None = None,
        author: str | None = None,
    ) -> None:
        status = "allowlisted" if allowed else "revoked"
        await self.db.execute(
            _UPSERT_ALLOWLIST_SQL,
            morpho_vault.lower(),
            chain_id,
            allowed,
            (curator.lower() if curator else None),
            label,
            native_fee_bps,
            vetting_notes,
            oracle_notes,
            gates_notes,
            timelock_notes,
            status,
            (author or "").lower() or None,
        )
