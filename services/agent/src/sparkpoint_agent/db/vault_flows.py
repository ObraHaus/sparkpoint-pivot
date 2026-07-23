"""§B2 Pg-backed vault-flow persistence + the per-user cost-basis reader.

Stores decoded Deposit/Withdraw into ``onchain_events`` (idempotent on the ``(network_id, tx_hash,
log_index)`` unique key) and reads them back to derive a REAL cost basis. Access/derived
only - never
custody (N2): losing this degrades PnL to null (honest), never traps funds.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass

from ..data.log_source import VaultFlow
from .pool import Database

_GET_CURSOR = (
    "SELECT last_processed_block FROM indexer_cursors "
    "WHERE network_id = $1 AND stream = 'vault_flows'"
)
_SET_CURSOR = """
INSERT INTO indexer_cursors (network_id, stream, last_processed_block)
VALUES ($1, 'vault_flows', $2)
ON CONFLICT (network_id, stream) DO UPDATE SET last_processed_block = EXCLUDED.last_processed_block,
    updated_at = now()
""".strip()
_UPSERT_EVENT = """
INSERT INTO onchain_events (network_id, tx_hash, log_index, address, topic0, decoded, block_number)
VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING
""".strip()
# Net deposited (in - out) in USDC base units for one owner, from the indexed flows.
_COST_BASIS = """
SELECT
  COALESCE(SUM((decoded->>'assets')::numeric)
           FILTER (WHERE decoded->>'kind' = 'deposit'), 0) AS deposited,
  COALESCE(SUM((decoded->>'assets')::numeric)
           FILTER (WHERE decoded->>'kind' = 'withdraw'), 0) AS withdrawn,
  COUNT(*) AS n
FROM onchain_events
WHERE network_id = $1 AND address = $2 AND lower(decoded->>'owner') = lower($3)
  AND decoded->>'kind' IN ('deposit', 'withdraw')
""".strip()
# One owner's Deposit/Withdraw rows, newest first — the transaction history (§tx).
_LIST_FLOWS = """
SELECT decoded->>'kind' AS kind,
       decoded->>'assets' AS assets,
       decoded->>'shares' AS shares,
       block_number,
       encode(tx_hash, 'hex') AS tx_hash,
       log_index
FROM onchain_events
WHERE network_id = $1 AND address = $2 AND lower(decoded->>'owner') = lower($3)
  AND decoded->>'kind' IN ('deposit', 'withdraw')
ORDER BY block_number DESC, log_index DESC
LIMIT $4
""".strip()


def _hexb(h: str) -> bytes:
    return bytes.fromhex(h[2:] if h.startswith("0x") else h)


@dataclass
class PgVaultFlowStore:
    """asyncpg-backed :class:`~sparkpoint_agent.data.log_source.VaultFlowStore`."""

    db: Database
    vault_address: str  # the emitting contract stamped onto each onchain_events row

    async def get_cursor(self, network_id: str) -> int:
        v = await self.db.fetchval(_GET_CURSOR, network_id)
        return int(v) if v is not None else 0

    async def set_cursor(self, network_id: str, block: int) -> None:
        await self.db.execute(_SET_CURSOR, network_id, block)

    async def upsert_flows(self, network_id: str, flows: Sequence[VaultFlow]) -> int:
        written = 0
        async with self.db.acquire() as conn, conn.transaction():
            for f in flows:
                decoded = json.dumps(
                    {
                        "kind": f.kind,
                        "owner": f.owner,
                        "assets": str(f.assets),
                        "shares": str(f.shares),
                    }
                )
                status = await conn.execute(
                    _UPSERT_EVENT,
                    network_id,
                    _hexb(f.tx_hash),
                    f.log_index,
                    self.vault_address.lower(),
                    _hexb(f.topic0),
                    decoded,
                    f.block_number,
                )
                if status.endswith("1"):
                    written += 1
        return written


@dataclass
class CostBasis:
    """Per-user net-deposited (cost basis) + a flag for whether any flow was indexed yet."""

    deposited: int  # Σ Deposit.assets(owner)
    withdrawn: int  # Σ Withdraw.assets(owner)
    event_count: int

    @property
    def net_deposited(self) -> int:
        """Cost basis = deposits - withdrawals (can be negative if more withdrawn)."""
        return self.deposited - self.withdrawn

    @property
    def has_history(self) -> bool:
        return self.event_count > 0


@dataclass(frozen=True)
class FlowRow:
    """One indexed Deposit/Withdraw, for the transaction history + value series."""

    kind: str  # 'deposit' | 'withdraw'
    assets: int  # USDC base units (6 dp)
    shares: int  # vault shares (6 dp)
    block_number: int
    log_index: int  # intra-block ordering — the true on-chain execution order within a block
    tx_hash: str  # 0x… hex


@dataclass(frozen=True)
class BasisResult:
    """Moving-average cost-basis PnL over a position's COMPLETE indexed flow history (USDC 6-dp).

    realized = Σ over withdrawals of (assets_received − avg cost of the shares redeemed);
    remaining_cost_basis = average cost of the shares STILL held;
    reconstructed_shares = Σ deposit.shares − Σ withdraw.shares. ``reconciles`` is True iff that
    equals the on-chain share balance — i.e. the indexed history is COMPLETE (no gap, no share
    transfer). Callers surface the figures ONLY when ``reconciles`` (else honest null). Coherent:
    realized + (value − remaining_cost_basis) == lifetime PnL == value + Σwithdrawn − Σdeposited.
    """

    realized: int
    remaining_cost_basis: int
    reconstructed_shares: int
    reconciles: bool


def replay_basis(flows: Sequence[FlowRow], current_shares: int) -> BasisResult | None:
    """Average-cost replay → realized PnL + remaining cost basis (exact integer math, never float).

    Deposits add USDC cost (assets, at $1 par) and shares; each withdrawal realizes
    (assets_received − avg_cost × shares_redeemed) and removes that cost pro-rata (redeemed cost
    rounds DOWN, mirroring the vault's own rounding — sub-unit dust is bounded by the withdrawal
    count). None on no history. Never raises on a partial history: a withdrawal that would over-draw
    the reconstructed share balance flips ``reconciles`` False (caller shows null), never crashes.
    """
    if not flows:
        return None
    ordered = sorted(flows, key=lambda f: (f.block_number, f.log_index))
    cost = 0  # USDC cost basis of currently-held shares (6-dp base units)
    held = 0  # reconstructed shares held
    realized = 0  # cumulative realized PnL (signed USDC base units)
    intact = True  # False once a withdrawal over-draws the reconstructed share balance (a gap)
    for f in ordered:
        if f.kind == "deposit":
            cost += f.assets
            held += f.shares
            continue
        # withdraw
        if f.shares <= 0 or f.shares > held:
            intact = False  # a gap: a withdraw precedes its funding deposit in the indexed set
            held -= f.shares
            continue
        redeemed_cost = cost * f.shares // held
        realized += f.assets - redeemed_cost
        cost -= redeemed_cost
        held -= f.shares
    return BasisResult(
        realized=realized,
        remaining_cost_basis=max(0, cost),
        reconstructed_shares=held,
        reconciles=intact and held == current_shares,
    )


@dataclass
class VaultFlowReader:
    """Reads the indexed flows to derive a user's cost basis (drives GET /portfolio PnL)."""

    db: Database

    async def cost_basis(self, network_id: str, vault: str, owner: str) -> CostBasis:
        row = await self.db.fetchrow(_COST_BASIS, network_id, vault.lower(), owner)
        if row is None:
            return CostBasis(0, 0, 0)
        return CostBasis(
            deposited=int(row["deposited"]),
            withdrawn=int(row["withdrawn"]),
            event_count=int(row["n"]),
        )

    async def list_flows(
        self, network_id: str, vault: str, owner: str, limit: int = 50
    ) -> list[FlowRow]:
        """The owner's indexed Deposit/Withdraw rows (newest first) — the transaction history."""
        rows = await self.db.fetch(_LIST_FLOWS, network_id, vault.lower(), owner, limit)
        return [
            FlowRow(
                kind=str(r["kind"]),
                assets=int(r["assets"]),
                shares=int(r["shares"]),
                block_number=int(r["block_number"]),
                log_index=int(r["log_index"]),
                tx_hash="0x" + str(r["tx_hash"]),
            )
            for r in rows
        ]
