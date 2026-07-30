"""Authoritative store for the feature-024 VAULT REGISTRY (migration 0026).

Three 024-owned tables (see ``migrations/0026_vault_registry.sql``):

  * ``vault_registry`` — one row per ``(chain_id, vault_address)`` we display or authorize. This is
    what replaces the single ``SPARKPOINT_VAULT_ADDRESS`` env var: "which vault" becomes a per-row
    data question once Aave and Morpho coexist across Base, Base Sepolia and Robinhood Chain 4663.
  * ``vault_allowlist`` — the governance record plus the FR-020 on-chain eligibility evidence
    (provenance, the three critical gate abdications, asset match, liquidity ratio, native fees).
  * ``vault_apy_snapshots`` — timestamped, SOURCE-TAGGED yield reads written by a BACKGROUND poller.

NON-CUSTODY (Constitution N1/N2/N5, v3.0.0). This is a DISPLAY + AUTHORIZATION registry, never a
custody surface:

  * It holds NO keys and moves NO funds. Every column is re-derivable from chain (Principle III).
  * ``status = 'redeem_only'`` is the durable form of a RETIRED vault: SparkPoint stops authorizing
    DEPOSITS while withdraw/redeem stays permanently open. N2 says only underlying liquidity may
    block an exit, never a SparkPoint decision — so NOTHING here may gate a withdrawal, and this
    module deliberately exposes no method that a withdraw path could consult to refuse.
  * Losing this table degrades discovery and disclosure, never custody: every read below is
    fail-open at the caller, and a user can always exit directly on-chain with the service offline.

IV.5(d) — POLICY ISOLATION. The curated-vault record is consulted at admission/display time ONLY and
MUST NOT leak into the deterministic policy path (PolicyModule / SessionKeyValidator / any agent
strategy-direction path), exactly as the on-chain Morpho allowlist is isolated today. That is why
:func:`resolve_first_party_vault` returns a bare ADDRESS STRING rather than a row: an address is the
same shape of input the env var already supplies, so nothing about a registry row's contents can
influence a policy decision.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .pool import Database

# ── vault_registry ───────────────────────────────────────────────────────────
_REGISTRY_COLUMNS = (
    "id, chain_id, protocol, kind, vault_address, child_address, asset_address, asset_symbol, "
    "asset_decimals, share_decimals, status, sparkpoint_fee_bps, native_fee_note, apy_source, "
    "label, vetting_notes, created_at, updated_at"
)

_LIST_REGISTRY_SQL = (
    f"SELECT {_REGISTRY_COLUMNS} FROM vault_registry ORDER BY chain_id, label"  # noqa: S608 - constant
)
_LIST_REGISTRY_FOR_CHAIN_SQL = (
    f"SELECT {_REGISTRY_COLUMNS} FROM vault_registry WHERE chain_id = $1 ORDER BY label"  # noqa: S608
)
_GET_REGISTRY_SQL = (
    f"SELECT {_REGISTRY_COLUMNS} FROM vault_registry "  # noqa: S608
    "WHERE chain_id = $1 AND vault_address = $2"
)

# The DEPOSIT-authorized first-party vault for a chain.
#
# `status = 'live'` is required here because this resolves a DEPOSIT target: a 'redeem_only' or
# 'deprecated' vault must never be handed back as "the vault" for a new position. Withdrawals do not
# come through this path at all — they address a vault the user already holds shares in — so this
# filter cannot block an exit (N2).
#
# `kind = 'first_party'` because this replaces SPARKPOINT_VAULT_ADDRESS, which has only ever pointed
# at SparkPoint's own ERC-4626. Fee Wrappers are resolved per-selection, not as a chain default.
#
# ORDER BY created_at is a determinism guard, not a preference: if a chain ever holds two live
# first-party rows that is a data error, and an arbitrary row order would make the resolved address
# flap between requests. Oldest wins, stably, and `_count_live_first_party` lets the caller detect
# and log the ambiguity rather than silently pick.
_RESOLVE_FIRST_PARTY_SQL = (
    "SELECT vault_address FROM vault_registry "
    "WHERE chain_id = $1 AND kind = 'first_party' AND status = 'live' "
    "ORDER BY created_at ASC LIMIT 1"
)
_COUNT_LIVE_FIRST_PARTY_SQL = (
    "SELECT count(*) FROM vault_registry "
    "WHERE chain_id = $1 AND kind = 'first_party' AND status = 'live'"
)

# ── vault_allowlist ──────────────────────────────────────────────────────────
_LIST_ALLOWLIST_SQL = (
    "SELECT chain_id, candidate_address, status, provenance_verified, gates_abdicated, "
    "asset_matches_expected, liquidity_ratio_bps, native_performance_fee_bps, "
    "native_management_fee_bps, curator_address, checked_at, vetting_notes, updated_at "
    "FROM vault_allowlist WHERE chain_id = $1 ORDER BY updated_at DESC"
)

# ── vault_apy_snapshots ──────────────────────────────────────────────────────
# The LATEST snapshot per vault on a chain. `net_apy_bps` is nullable and `source =
# 'unavailable'` is a first-class value — Morpho's API covers no testnet, so on Base Sepolia the
# honest answer is
# "unavailable", never 0. A 0 would be a fabricated figure (Principle III).
_LATEST_APY_SQL = (
    "SELECT DISTINCT ON (vault_address) vault_address, source, net_apy_bps, tvl_usd, "
    "liquidity_usd, fetched_at "
    "FROM vault_apy_snapshots WHERE chain_id = $1 "
    "ORDER BY vault_address, fetched_at DESC"
)
_INSERT_APY_SQL = """
INSERT INTO vault_apy_snapshots
    (chain_id, vault_address, source, net_apy_bps, tvl_usd, liquidity_usd)
VALUES ($1, $2, $3, $4, $5, $6)
""".strip()


def _row(record: Any) -> dict[str, Any]:
    """asyncpg ``Record`` → plain dict with ISO timestamps (JSON-serialisable)."""
    out: dict[str, Any] = {}
    for key in record.keys():
        value = record[key]
        out[key] = value.isoformat() if hasattr(value, "isoformat") else value
    return out


@dataclass
class VaultRegistryStore:
    """asyncpg-backed store for ``vault_registry`` / ``vault_allowlist`` / ``vault_apy_snapshots``.

    Every method is a plain read except :meth:`insert_apy_snapshot`, which the background APY poller
    owns. There is deliberately no write path for ``vault_registry`` here: rows are seeded by the
    migration and changed by a reviewed migration or an operator, never by a request handler — a
    registry row is an authorization record, so it must not be mutable from the request path.
    """

    db: Database

    # ── vault_registry ──
    async def list_vaults(self, chain_id: int | None = None) -> list[dict[str, Any]]:
        """Every registry row, or just one chain's. Ordered for stable rendering."""
        if chain_id is None:
            rows = await self.db.fetch(_LIST_REGISTRY_SQL)
        else:
            rows = await self.db.fetch(_LIST_REGISTRY_FOR_CHAIN_SQL, chain_id)
        return [_row(r) for r in rows]

    async def get_vault(self, chain_id: int, vault_address: str) -> dict[str, Any] | None:
        r = await self.db.fetchrow(_GET_REGISTRY_SQL, chain_id, vault_address.lower())
        return _row(r) if r is not None else None

    async def resolve_first_party_vault(self, chain_id: int) -> str | None:
        """The chain's deposit-authorized first-party vault address, or ``None``.

        ``None`` means "the registry does not know" — NOT "there is no vault". The caller must treat
        it as an absent answer and fall back, never as a refusal (see
        ``chain/vault_resolution.py``).
        """
        value = await self.db.fetchval(_RESOLVE_FIRST_PARTY_SQL, chain_id)
        # `fetchval` is untyped (Any). Coerce explicitly rather than trusting the driver's shape: a
        # non-str leaking out of here would become a calldata `to` further downstream.
        return str(value) if value is not None else None

    async def count_live_first_party(self, chain_id: int) -> int:
        """How many live first-party rows a chain has. ``> 1`` is a data error worth logging."""
        value = await self.db.fetchval(_COUNT_LIVE_FIRST_PARTY_SQL, chain_id)
        return int(value or 0)

    # ── vault_allowlist ──
    async def list_allowlist(self, chain_id: int) -> list[dict[str, Any]]:
        """The FR-020 eligibility evidence per candidate. ``None`` in a check column means NOT YET
        CHECKED — never read it as a pass."""
        rows = await self.db.fetch(_LIST_ALLOWLIST_SQL, chain_id)
        return [_row(r) for r in rows]

    # ── vault_apy_snapshots ──
    async def latest_apy(self, chain_id: int) -> list[dict[str, Any]]:
        """The most recent snapshot per vault on ``chain_id``."""
        rows = await self.db.fetch(_LATEST_APY_SQL, chain_id)
        return [_row(r) for r in rows]

    async def insert_apy_snapshot(
        self,
        *,
        chain_id: int,
        vault_address: str,
        source: str,
        net_apy_bps: int | None,
        tvl_usd: str | None = None,
        liquidity_usd: str | None = None,
    ) -> None:
        """Append one APY reading.

        ``source='unavailable'`` REQUIRES ``net_apy_bps is None`` — the migration enforces it with a
        CHECK, so writing 0 to mean "unknown" fails loudly rather than fabricating a yield figure.
        """
        await self.db.execute(
            _INSERT_APY_SQL,
            chain_id,
            vault_address.lower(),
            source,
            net_apy_bps,
            tvl_usd,
            liquidity_usd,
        )
