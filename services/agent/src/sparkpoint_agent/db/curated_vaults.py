"""Feature 048 — the curated vault store (migration 0038), OFF-CHAIN and non-custodial.

The daily curator runner discovers vaults, screens + scores them, and reports the result here. This
module holds the list, the daily pick, the admin decisions over both, and the audit trail. Nothing
in it moves funds, holds a key, or is read by the deterministic policy path (N1/N2, IV.5(d)).

Three rules shape every method below:

* **Admin edits win (FR-007).** The scan upsert refreshes OBSERVATIONS but freezes admin metadata
  (``provenance='admin'``) and NEVER writes ``status`` on an existing row. An edit, an approval, a
  denial or a pin is durable.
* **Fail-open (FR-011).** A failed run writes nothing. ``record_run(ok=False)`` touches only the
  state row — the last good list and pick are untouched — and the public read keeps serving it.
* **Honesty (FR-008).** Absent table / absent data degrades to empty + ``available: false``, never
  to invented rows; NULL figures stay NULL (``None``), never 0.

Addresses are stored + compared LOWERCASE, mirroring ``db/allowlist.py``.
"""

# ruff: noqa: S608 — this module intentionally assembles SQL (dynamic column lists for admin
# edits). Every identifier comes from the fixed ADMIN_EDITABLE_FIELDS allowlist, and every value is
# bound as an asyncpg parameter. See the guard in update_metadata().

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from asyncpg.exceptions import UndefinedTableError

logger = logging.getLogger(__name__)

# ── lifecycle + provenance constants ─────────────────────────────────────────────────────────────

CANDIDATE = "candidate"
APPROVED = "approved"
HIDDEN = "hidden"
DENIED = "denied"

PROVENANCE_AI = "ai"
PROVENANCE_ADMIN = "admin"

DEPOSIT_DIRECT = "direct"
DEPOSIT_WRAPPER = "wrapper"

SOURCE_MORPHO = "morpho"

#: Editable metadata fields, and the frozen ones. Kept as sets so the API can validate and the SQL
#: can CASE on the same list (a field that is editable but not frozen is a bug waiting to happen).
ADMIN_EDITABLE_FIELDS: frozenset[str] = frozenset(
    {
        "label",
        "curator",
        "curator_verified",
        "asset_address",
        "asset_symbol",
        "asset_decimals",
        "wrapped",
        "wrapper_address",
        "deposit_mode",
        "admin_note",
    }
)

_ADDRESS_WIRE_KEYS = ("vault_address",)


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _num(value: Any) -> float | None:
    """asyncpg hands back ``Decimal`` for numeric columns; JSON needs a float (or None)."""
    if value is None:
        return None
    return float(value)


def _actor(value: str | None) -> str | None:
    """Actors (admin wallet addresses) are stored lowercase, exactly like addresses: a checksummed
    session address and a lowercase audit row must not describe the same admin as two people."""
    return value.strip().lower() if value else None


def _json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except ValueError:  # pragma: no cover - a corrupt row must not 500 a read
            return None
    return value


# ── dataclasses ──────────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CuratedVault:
    """One curated vault row, as the API and the admin panel see it."""

    chain_id: int
    vault_address: str
    source: str
    label: str
    asset_address: str | None
    asset_symbol: str | None
    asset_decimals: int | None
    curator: str | None
    curator_verified: bool
    listed: bool
    status: str
    provenance: str
    score: int | None
    score_inputs: dict[str, Any]
    screening: list[Any]
    net_apy_bps: int | None
    tvl_usd: float | None
    liquidity_usd: float | None
    vault_age_seconds: int | None
    wrapped: bool
    wrapper_address: str | None
    deposit_mode: str
    admin_note: str | None
    pinned_at: str | None
    decided_by: str | None
    decided_at: str | None
    first_seen_at: str
    last_scan_at: str | None
    updated_at: str

    def to_wire(self) -> dict[str, Any]:
        return {
            "chainId": self.chain_id,
            "address": self.vault_address,
            "source": self.source,
            "label": self.label,
            "asset": {
                "address": self.asset_address,
                "symbol": self.asset_symbol,
                "decimals": self.asset_decimals,
            },
            "curator": self.curator,
            "curatorVerified": self.curator_verified,
            "listed": self.listed,
            "status": self.status,
            "provenance": self.provenance,
            "score": self.score,
            "scoreInputs": self.score_inputs,
            "screening": self.screening,
            "netApyBps": self.net_apy_bps,
            "tvlUsd": self.tvl_usd,
            "liquidityUsd": self.liquidity_usd,
            "ageSeconds": self.vault_age_seconds,
            "wrapped": self.wrapped,
            "wrapperAddress": self.wrapper_address,
            "depositMode": self.deposit_mode,
            "adminNote": self.admin_note,
            "pinned": self.pinned_at is not None,
            "pinnedAt": self.pinned_at,
            "decidedBy": self.decided_by,
            "decidedAt": self.decided_at,
            "firstSeenAt": self.first_seen_at,
            "lastScanAt": self.last_scan_at,
            "updatedAt": self.updated_at,
        }


@dataclass(frozen=True)
class ScanVault:
    """One screened discovery result, as the runner reports it (the ingest payload item)."""

    address: str
    label: str
    screened: bool
    score: int | None = None
    score_inputs: dict[str, Any] = field(default_factory=dict)
    screening: list[Any] = field(default_factory=list)
    asset_address: str | None = None
    asset_symbol: str | None = None
    asset_decimals: int | None = None
    curator: str | None = None
    curator_verified: bool = False
    listed: bool = False
    net_apy_bps: int | None = None
    tvl_usd: float | None = None
    liquidity_usd: float | None = None
    vault_age_seconds: int | None = None


@dataclass(frozen=True)
class Recommendation:
    """One run's pick + alternates (or an admin publication)."""

    chain_id: int
    run_key: str | None
    as_of: str
    source: str
    pick_address: str
    pick_reason: str
    alternates: list[dict[str, Any]]
    published: bool
    provenance: str

    def to_wire(self) -> dict[str, Any]:
        return {
            "chainId": self.chain_id,
            "runKey": self.run_key,
            "asOf": self.as_of,
            "source": self.source,
            "pickAddress": self.pick_address,
            "pickReason": self.pick_reason,
            "alternates": self.alternates,
            "published": self.published,
            "provenance": self.provenance,
        }


@dataclass(frozen=True)
class CurationState:
    """The per-chain control row: who publishes, when it last ran, whether a run was requested.

    The optional fields default so a never-run chain is one constructor call (and tests can build
    the state without restating every absence).
    """

    chain_id: int
    auto_publish: bool = False
    last_run_at: str | None = None
    last_run_ok: bool | None = None
    last_run_key: str | None = None
    last_failed_at: str | None = None
    last_failed_detail: dict[str, Any] = field(default_factory=dict)
    run_requested_at: str | None = None
    run_requested_by: str | None = None

    def to_wire(self) -> dict[str, Any]:
        return {
            "chainId": self.chain_id,
            "autoPublish": self.auto_publish,
            "lastRunAt": self.last_run_at,
            "lastRunOk": self.last_run_ok,
            "lastRunKey": self.last_run_key,
            "lastFailedAt": self.last_failed_at,
            "lastFailedDetail": self.last_failed_detail,
            "runRequestedAt": self.run_requested_at,
            "runRequestedBy": self.run_requested_by,
        }


# ── store ────────────────────────────────────────────────────────────────────────────────────────

#: The columns every vault read returns, in the order ``_row_to_vault`` expects.
_VAULT_COLUMNS = """
    chain_id, vault_address, source, label, asset_address, asset_symbol, asset_decimals,
    curator, curator_verified, listed, status, provenance, score, score_inputs, screening,
    net_apy_bps, tvl_usd, liquidity_usd, vault_age_seconds, wrapped, wrapper_address,
    deposit_mode, admin_note, pinned_at, decided_by, decided_at, first_seen_at, last_scan_at,
    updated_at
"""

_UPSERT_VAULT_SQL = """
INSERT INTO curated_vaults (
    chain_id, vault_address, source, label, asset_address, asset_symbol, asset_decimals,
    curator, curator_verified, listed, status, provenance, score, score_inputs, screening,
    net_apy_bps, tvl_usd, liquidity_usd, vault_age_seconds, last_scan_at
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'candidate', 'ai', $11,
    CAST($12 AS jsonb), CAST($13 AS jsonb), $14, $15, $16, $17, $18
)
ON CONFLICT (chain_id, vault_address) DO UPDATE SET
    -- Source facts always refresh: a re-listing or an asset correction is an observation.
    source         = EXCLUDED.source,
    asset_address  = COALESCE(EXCLUDED.asset_address, curated_vaults.asset_address),
    asset_symbol   = COALESCE(EXCLUDED.asset_symbol, curated_vaults.asset_symbol),
    asset_decimals = COALESCE(EXCLUDED.asset_decimals, curated_vaults.asset_decimals),
    listed         = EXCLUDED.listed,
    -- Admin metadata is FROZEN once provenance flips (FR-007). The CASE is the whole mechanism.
    label = CASE WHEN curated_vaults.provenance = 'admin'
                 THEN curated_vaults.label ELSE EXCLUDED.label END,
    curator = CASE WHEN curated_vaults.provenance = 'admin'
                   THEN curated_vaults.curator ELSE EXCLUDED.curator END,
    curator_verified = CASE WHEN curated_vaults.provenance = 'admin'
                            THEN curated_vaults.curator_verified
                            ELSE EXCLUDED.curator_verified END,
    -- Observations refresh for every row, admin-owned or not: they are facts, not edits.
    score             = EXCLUDED.score,
    score_inputs      = EXCLUDED.score_inputs,
    screening         = EXCLUDED.screening,
    net_apy_bps       = EXCLUDED.net_apy_bps,
    tvl_usd           = EXCLUDED.tvl_usd,
    liquidity_usd     = EXCLUDED.liquidity_usd,
    vault_age_seconds = EXCLUDED.vault_age_seconds,
    last_scan_at      = EXCLUDED.last_scan_at,
    updated_at        = now()
    -- status / provenance / wrapped / wrapper_address / deposit_mode / admin_note / decided_* are
    -- deliberately ABSENT: a scan may not approve, deny, hide, wrap or un-admin a vault.
"""

_UPSERT_STATE_SQL = """
INSERT INTO vault_curation_state (chain_id, auto_publish, updated_at)
VALUES ($1, $2, now())
ON CONFLICT (chain_id) DO UPDATE SET auto_publish = EXCLUDED.auto_publish, updated_at = now()
"""

_RECORD_RUN_SQL = """
INSERT INTO vault_curation_state (
    chain_id, last_run_at, last_run_ok, last_run_key, last_failed_at, last_failed_detail,
    run_requested_at, run_requested_by, updated_at
) VALUES (
    $1,
    CASE WHEN $4 THEN $3::timestamptz ELSE NULL END,
    $4,
    CASE WHEN $4 THEN $2 ELSE NULL END,
    CASE WHEN $4 THEN NULL ELSE $3::timestamptz END,
    CASE WHEN $4 THEN '{}'::jsonb ELSE CAST($5 AS jsonb) END,
    NULL, NULL, now()
)
ON CONFLICT (chain_id) DO UPDATE SET
    last_run_at = CASE WHEN $4 THEN $3::timestamptz
                       ELSE vault_curation_state.last_run_at END,
    last_run_ok = $4,
    last_run_key = CASE WHEN $4 THEN $2 ELSE vault_curation_state.last_run_key END,
    last_failed_at = CASE WHEN $4 THEN vault_curation_state.last_failed_at
                          ELSE $3::timestamptz END,
    last_failed_detail = CASE WHEN $4 THEN vault_curation_state.last_failed_detail
                              ELSE CAST($5 AS jsonb) END,
    -- A completed attempt clears the request either way; a failed run must not retry forever.
    run_requested_at = NULL,
    run_requested_by = NULL,
    updated_at = now()
"""


class CurationStore(Protocol):
    """The narrow persistence port the API + ingest need (a fake satisfies it in tests)."""

    async def list_vaults(
        self, chain_id: int, *, statuses: tuple[str, ...] | None = None
    ) -> list[CuratedVault]: ...

    async def get_vault(self, chain_id: int, address: str) -> CuratedVault | None: ...

    async def upsert_scan_vaults(
        self, chain_id: int, vaults: list[ScanVault], *, source: str, as_of: datetime
    ) -> int: ...

    async def approve_recommended(self, chain_id: int, addresses: list[str]) -> int: ...

    async def record_recommendation(
        self,
        chain_id: int,
        *,
        run_key: str | None,
        as_of: datetime,
        source: str,
        pick_address: str,
        pick_reason: str,
        alternates: list[dict[str, Any]],
        published: bool,
        provenance: str = PROVENANCE_AI,
    ) -> bool: ...

    async def latest_recommendation(
        self, chain_id: int, *, published_only: bool = True
    ) -> Recommendation | None: ...

    async def get_state(self, chain_id: int) -> CurationState: ...

    async def set_auto_publish(
        self, chain_id: int, *, enabled: bool, actor: str | None
    ) -> None: ...

    async def request_run(self, chain_id: int, *, actor: str | None) -> None: ...

    async def record_run(
        self,
        chain_id: int,
        *,
        run_key: str | None,
        as_of: datetime,
        ok: bool,
        detail: dict[str, Any],
    ) -> bool: ...


class PgCurationStore:
    """asyncpg-backed :class:`CurationStore` (migration 0038).

    Missing-table degradation: reads return empty/absent and writes return 0/False, each with ONE
    warning per call site class. An agent deployed ahead of 0038 serves the honest empty shape
    instead of 500-ing `/vault`, and a curator ingest against an unmigrated DB records nothing
    (fail-open) rather than trapping the runner.
    """

    def __init__(self, db: Any) -> None:
        self._db = db

    # ── reads ─────────────────────────────────────────────────────────────────────────────────

    async def list_vaults(
        self, chain_id: int, *, statuses: tuple[str, ...] | None = None
    ) -> list[CuratedVault]:
        try:
            rows = await self._db.fetch(
                f"SELECT {_VAULT_COLUMNS} FROM curated_vaults"
                " WHERE chain_id = $1"
                "   AND ($2::text[] IS NULL OR status = ANY($2::text[]))"
                " ORDER BY score DESC NULLS LAST, tvl_usd DESC NULLS LAST, vault_address",
                chain_id,
                list(statuses) if statuses else None,
            )
        except UndefinedTableError:
            logger.warning("curated_vaults table absent (migration 0038 unapplied)")
            return []
        return [_row_to_vault(r) for r in rows]

    async def get_vault(self, chain_id: int, address: str) -> CuratedVault | None:
        try:
            rows = await self._db.fetch(
                f"SELECT {_VAULT_COLUMNS} FROM curated_vaults"
                " WHERE chain_id = $1 AND vault_address = $2",
                chain_id,
                address.strip().lower(),
            )
        except UndefinedTableError:
            return None
        return _row_to_vault(rows[0]) if rows else None

    async def latest_recommendation(
        self, chain_id: int, *, published_only: bool = True
    ) -> Recommendation | None:
        try:
            rows = await self._db.fetch(
                """
                SELECT chain_id, run_key, as_of, source, pick_address, pick_reason, alternates,
                       published, provenance
                  FROM vault_recommendations
                 WHERE chain_id = $1 AND (NOT $2::boolean OR published)
                 ORDER BY as_of DESC, created_at DESC, id DESC
                 LIMIT 1
                """,
                chain_id,
                published_only,
            )
        except UndefinedTableError:
            return None
        return _row_to_recommendation(rows[0]) if rows else None

    async def get_state(self, chain_id: int) -> CurationState:
        try:
            rows = await self._db.fetch(
                """
                SELECT chain_id, auto_publish, last_run_at, last_run_ok, last_run_key,
                       last_failed_at, last_failed_detail, run_requested_at, run_requested_by
                  FROM vault_curation_state WHERE chain_id = $1
                """,
                chain_id,
            )
        except UndefinedTableError:
            rows = []
        if not rows:
            # No row yet is NOT an error: auto-publish ships OFF ("AI proposes, admin publishes").
            return CurationState(
                chain_id=chain_id,
                auto_publish=False,
                last_run_at=None,
                last_run_ok=None,
                last_run_key=None,
                last_failed_at=None,
                last_failed_detail={},
                run_requested_at=None,
                run_requested_by=None,
            )
        return _row_to_state(rows[0])

    # ── curator ingest (machine-facing) ───────────────────────────────────────────────────────

    async def upsert_scan_vaults(
        self, chain_id: int, vaults: list[ScanVault], *, source: str, as_of: datetime
    ) -> int:
        """Upsert one run's screened vaults. Returns the number of rows written.

        Observations (score, TVL, APY, screening) refresh for every row; admin metadata and status
        decisions are never touched (see the SQL's CASE/comments).
        """
        if not vaults:
            return 0
        params = [
            (
                chain_id,
                v.address.strip().lower(),
                source,
                v.label,
                v.asset_address.lower() if v.asset_address else None,
                v.asset_symbol,
                v.asset_decimals,
                v.curator.lower() if v.curator else None,
                bool(v.curator_verified),
                bool(v.listed),
                v.score,
                json.dumps(v.score_inputs, ensure_ascii=False),
                json.dumps(v.screening, ensure_ascii=False),
                v.net_apy_bps,
                v.tvl_usd,
                v.liquidity_usd,
                v.vault_age_seconds,
                as_of,
            )
            for v in vaults
        ]
        try:
            async with self._db.acquire() as conn, conn.transaction():
                await conn.executemany(_UPSERT_VAULT_SQL, params)
        except UndefinedTableError:
            logger.warning("curated_vaults table absent (0038 unapplied); scan not stored")
            return 0
        return len(params)

    async def approve_recommended(self, chain_id: int, addresses: list[str]) -> int:
        """Auto-publish: flip AI candidates the run recommended to ``approved`` (never admin rows).

        Only ``candidate`` rows with ``provenance='ai'`` move. A hidden or denied vault stays that
        way even if the source still likes it — an admin said no.
        """
        if not addresses:
            return 0
        lowered = [a.strip().lower() for a in addresses]
        try:
            status = await self._db.execute(
                """
                UPDATE curated_vaults
                   SET status = 'approved', updated_at = now()
                 WHERE chain_id = $1
                   AND vault_address = ANY($2::text[])
                   AND provenance = 'ai'
                   AND status = 'candidate'
                """,
                chain_id,
                lowered,
            )
        except UndefinedTableError:
            return 0
        # asyncpg command tag: "UPDATE <n>".
        try:
            return int(str(status).split()[-1])
        except (ValueError, IndexError):  # pragma: no cover - defensive
            return 0

    async def record_recommendation(
        self,
        chain_id: int,
        *,
        run_key: str | None,
        as_of: datetime,
        source: str,
        pick_address: str,
        pick_reason: str,
        alternates: list[dict[str, Any]],
        published: bool,
        provenance: str = PROVENANCE_AI,
    ) -> bool:
        """Append one recommendation (idempotent on ``run_key``). True iff a row was written."""
        try:
            status = await self._db.execute(
                """
                INSERT INTO vault_recommendations (
                    chain_id, run_key, as_of, source, pick_address, pick_reason, alternates,
                    published, provenance
                ) VALUES ($1, $2, $3, $4, $5, $6, CAST($7 AS jsonb), $8, $9)
                ON CONFLICT DO NOTHING
                """,
                chain_id,
                run_key,
                as_of,
                source,
                pick_address.strip().lower(),
                pick_reason,
                json.dumps(alternates, ensure_ascii=False),
                published,
                provenance,
            )
        except UndefinedTableError:
            return False
        return str(status).strip().endswith("1")

    async def record_run(
        self,
        chain_id: int,
        *,
        run_key: str | None,
        as_of: datetime,
        ok: bool,
        detail: dict[str, Any],
    ) -> bool:
        """Record a completed run attempt and clear any pending "Run now" request.

        A FAILED attempt writes only the state row: the curated list and the last good pick are
        untouched (FR-011). That is the whole fail-open guarantee, in SQL.
        """
        try:
            status = await self._db.execute(
                _RECORD_RUN_SQL,
                chain_id,
                run_key,
                as_of,
                ok,
                json.dumps(detail, ensure_ascii=False),
            )
        except UndefinedTableError:
            return False
        return str(status).strip().startswith("INSERT")

    # ── admin actions ─────────────────────────────────────────────────────────────────────────

    async def set_auto_publish(self, chain_id: int, *, enabled: bool, actor: str | None) -> None:
        try:
            await self._db.execute(_UPSERT_STATE_SQL, chain_id, enabled)
            await self._audit(
                "auto-publish", chain_id, None, actor, {"enabled": enabled}
            )
        except UndefinedTableError:
            logger.warning("vault_curation_state absent (0038 unapplied); toggle not stored")

    async def request_run(self, chain_id: int, *, actor: str | None) -> None:
        """Set the run-request marker. The RUNNER acts on it; the agent cannot make it run."""
        try:
            await self._db.execute(
                """
                INSERT INTO vault_curation_state (
                    chain_id, run_requested_at, run_requested_by, updated_at
                )
                VALUES ($1, now(), $2, now())
                ON CONFLICT (chain_id) DO UPDATE SET
                    run_requested_at = now(), run_requested_by = EXCLUDED.run_requested_by,
                    updated_at = now()
                """,
                chain_id,
                _actor(actor),
            )
            await self._audit("run-now", chain_id, None, actor, {})
        except UndefinedTableError:
            logger.warning("vault_curation_state absent (0038 unapplied); run request dropped")

    async def upsert_admin_vault(
        self,
        chain_id: int,
        *,
        address: str,
        label: str,
        actor: str | None,
        asset_address: str | None = None,
        asset_symbol: str | None = None,
        asset_decimals: int | None = None,
        wrapped: bool = False,
        wrapper_address: str | None = None,
        deposit_mode: str = DEPOSIT_DIRECT,
        admin_note: str | None = None,
    ) -> bool:
        """Admin 'add by address': insert an approved, admin-owned row (or adopt an existing one).

        Returns True when a NEW row was created. Adopting an existing row marks it
        ``provenance='admin'`` + ``approved`` — an admin adding a vault by hand outranks whatever
        the scan thought of it.
        """
        try:
            status = await self._db.execute(
                """
                INSERT INTO curated_vaults (
                    chain_id, vault_address, source, label, asset_address, asset_symbol,
                    asset_decimals, status, provenance, wrapped, wrapper_address, deposit_mode,
                    admin_note, decided_by, decided_at, last_scan_at
                ) VALUES (
                    $1, $2, 'admin', $3, $4, $5, $6, 'approved', 'admin', $7, $8, $9, $10,
                    $11, now(), NULL
                )
                ON CONFLICT (chain_id, vault_address) DO UPDATE SET
                    label         = EXCLUDED.label,
                    asset_address = COALESCE(EXCLUDED.asset_address, curated_vaults.asset_address),
                    asset_symbol  = COALESCE(EXCLUDED.asset_symbol, curated_vaults.asset_symbol),
                    asset_decimals = COALESCE(
                        EXCLUDED.asset_decimals, curated_vaults.asset_decimals
                    ),
                    status        = 'approved',
                    provenance    = 'admin',
                    wrapped       = EXCLUDED.wrapped,
                    wrapper_address = EXCLUDED.wrapper_address,
                    deposit_mode  = EXCLUDED.deposit_mode,
                    admin_note    = COALESCE(EXCLUDED.admin_note, curated_vaults.admin_note),
                    decided_by    = EXCLUDED.decided_by,
                    decided_at    = now(),
                    updated_at    = now()
                """,
                chain_id,
                address.strip().lower(),
                label,
                asset_address.lower() if asset_address else None,
                asset_symbol,
                asset_decimals,
                wrapped,
                wrapper_address.lower() if wrapper_address else None,
                deposit_mode,
                admin_note,
                _actor(actor),
            )
            created = str(status).strip().startswith("INSERT")
            await self._audit(
                "add", chain_id, address, actor, {"created": created, "label": label}
            )
            return created
        except UndefinedTableError:
            logger.warning("curated_vaults table absent (0038 unapplied); add dropped")
            return False

    async def decide(
        self,
        chain_id: int,
        *,
        address: str,
        status: str,
        actor: str | None,
        note: str | None = None,
    ) -> bool:
        """Approve / deny / hide / unhide a vault. Admin decisions are authoritative forever."""
        try:
            result = await self._db.execute(
                """
                UPDATE curated_vaults
                   SET status = $3,
                       provenance = 'admin',
                       admin_note = COALESCE($4, admin_note),
                       decided_by = $5,
                       decided_at = now(),
                       updated_at = now()
                 WHERE chain_id = $1 AND vault_address = $2
                """,
                chain_id,
                address.strip().lower(),
                status,
                note,
                _actor(actor),
            )
        except UndefinedTableError:
            return False
        updated = str(result).strip().endswith("1")
        if updated:
            await self._audit(
                status, chain_id, address, actor, {"note": note} if note else {}
            )
        return updated

    async def set_pinned(
        self, chain_id: int, *, address: str, pinned: bool, actor: str | None
    ) -> bool:
        """Pin (or unpin) the best pick. Pinning approves the vault; only ONE vault stays pinned."""
        target = address.strip().lower()
        try:
            async with self._db.acquire() as conn, conn.transaction():
                if pinned:
                    # Single-pick invariant: two pinned rows would make the public pick ambiguous.
                    await conn.execute(
                        """
                        UPDATE curated_vaults SET pinned_at = NULL, updated_at = now()
                         WHERE chain_id = $1 AND pinned_at IS NOT NULL AND vault_address <> $2
                        """,
                        chain_id,
                        target,
                    )
                result = await conn.execute(
                    """
                    UPDATE curated_vaults
                       SET pinned_at = CASE WHEN $3 THEN now() ELSE NULL END,
                           status = CASE WHEN $3 AND status IN ('candidate', 'hidden')
                                         THEN 'approved' ELSE status END,
                           provenance = CASE WHEN $3 THEN 'admin' ELSE provenance END,
                           decided_by = CASE WHEN $3 THEN $4 ELSE decided_by END,
                           decided_at = CASE WHEN $3 THEN now() ELSE decided_at END,
                           updated_at = now()
                     WHERE chain_id = $1 AND vault_address = $2
                    """,
                    chain_id,
                    target,
                    pinned,
                    _actor(actor),
                )
        except UndefinedTableError:
            return False
        updated = str(result).strip().endswith("1")
        if updated:
            await self._audit(
                "pin" if pinned else "unpin", chain_id, address, actor, {}
            )
        return updated

    async def update_metadata(
        self, chain_id: int, *, address: str, fields: dict[str, Any], actor: str | None
    ) -> CuratedVault | None:
        """Apply an admin metadata edit and set ``provenance='admin'`` (the freeze marker).

        Only :data:`ADMIN_EDITABLE_FIELDS` are accepted; the API validates values, this is the
        last-line guard.
        """
        unknown = set(fields) - ADMIN_EDITABLE_FIELDS
        if unknown:
            raise ValueError(f"fields not admin-editable: {sorted(unknown)}")
        if not fields:
            return await self.get_vault(chain_id, address)
        assignments = ", ".join(f"{name} = ${i + 3}" for i, name in enumerate(fields))
        values = [fields[name] for name in fields]
        try:
            result = await self._db.execute(
                f"""
                UPDATE curated_vaults
                   SET {assignments},
                       provenance = 'admin',
                       updated_at = now()
                 WHERE chain_id = $1 AND vault_address = $2
                """,
                chain_id,
                address.strip().lower(),
                *values,
            )
        except UndefinedTableError:
            return None
        if not str(result).strip().endswith("1"):
            return None
        await self._audit("edit", chain_id, address, actor, {"fields": fields})
        return await self.get_vault(chain_id, address)

    # ── audit ─────────────────────────────────────────────────────────────────────────────────

    async def list_audit(self, chain_id: int | None, limit: int = 50) -> list[dict[str, Any]]:
        try:
            rows = await self._db.fetch(
                """
                SELECT action, chain_id, vault_address, actor, detail, created_at
                  FROM vault_curation_audit
                 WHERE ($1::integer IS NULL OR chain_id = $1)
                 ORDER BY created_at DESC, id DESC
                 LIMIT $2
                """,
                chain_id,
                max(1, min(limit, 500)),
            )
        except UndefinedTableError:
            return []
        return [
            {
                "action": str(r["action"]),
                "chainId": r["chain_id"],
                "address": r["vault_address"],
                "actor": r["actor"],
                "detail": _json(r["detail"]) or {},
                "at": _iso(r["created_at"]),
            }
            for r in rows
        ]

    async def _audit(
        self,
        action: str,
        chain_id: int | None,
        address: str | None,
        actor: str | None,
        detail: dict[str, Any],
    ) -> None:
        try:
            await self._db.execute(
                """
                INSERT INTO vault_curation_audit (action, chain_id, vault_address, actor, detail)
                VALUES ($1, $2, $3, $4, CAST($5 AS jsonb))
                """,
                action,
                chain_id,
                address.strip().lower() if address else None,
                actor.strip().lower() if actor else None,
                json.dumps(detail, ensure_ascii=False),
            )
        except UndefinedTableError:
            logger.warning("vault_curation_audit absent (0038 unapplied); audit row dropped")


# ── row mappers ──────────────────────────────────────────────────────────────────────────────────


def _row_to_vault(row: Any) -> CuratedVault:
    return CuratedVault(
        chain_id=int(row["chain_id"]),
        vault_address=str(row["vault_address"]),
        source=str(row["source"]),
        label=str(row["label"]),
        asset_address=row["asset_address"],
        asset_symbol=row["asset_symbol"],
        asset_decimals=row["asset_decimals"],
        curator=row["curator"],
        curator_verified=bool(row["curator_verified"]),
        listed=bool(row["listed"]),
        status=str(row["status"]),
        provenance=str(row["provenance"]),
        score=row["score"],
        score_inputs=_json(row["score_inputs"]) or {},
        screening=_json(row["screening"]) or [],
        net_apy_bps=row["net_apy_bps"],
        tvl_usd=_num(row["tvl_usd"]),
        liquidity_usd=_num(row["liquidity_usd"]),
        vault_age_seconds=row["vault_age_seconds"],
        wrapped=bool(row["wrapped"]),
        wrapper_address=row["wrapper_address"],
        deposit_mode=str(row["deposit_mode"]),
        admin_note=row["admin_note"],
        pinned_at=_iso(row["pinned_at"]),
        decided_by=row["decided_by"],
        decided_at=_iso(row["decided_at"]),
        first_seen_at=_iso(row["first_seen_at"]) or "",
        last_scan_at=_iso(row["last_scan_at"]),
        updated_at=_iso(row["updated_at"]) or "",
    )


def _row_to_recommendation(row: Any) -> Recommendation:
    alternates = _json(row["alternates"]) or []
    return Recommendation(
        chain_id=int(row["chain_id"]),
        run_key=row["run_key"],
        as_of=_iso(row["as_of"]) or "",
        source=str(row["source"]),
        pick_address=str(row["pick_address"]),
        pick_reason=str(row["pick_reason"]),
        alternates=alternates if isinstance(alternates, list) else [],
        published=bool(row["published"]),
        provenance=str(row["provenance"]),
    )


def _row_to_state(row: Any) -> CurationState:
    return CurationState(
        chain_id=int(row["chain_id"]),
        auto_publish=bool(row["auto_publish"]),
        last_run_at=_iso(row["last_run_at"]),
        last_run_ok=(bool(row["last_run_ok"]) if row["last_run_ok"] is not None else None),
        last_run_key=row["last_run_key"],
        last_failed_at=_iso(row["last_failed_at"]),
        last_failed_detail=_json(row["last_failed_detail"]) or {},
        run_requested_at=_iso(row["run_requested_at"]),
        run_requested_by=row["run_requested_by"],
    )
