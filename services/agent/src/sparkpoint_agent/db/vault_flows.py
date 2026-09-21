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
from datetime import datetime

from ..data.log_source import VaultFlow
from .pool import Database

# 053 — the cursor STREAM is per indexer, not one global name: two chains sharing the mirror
# network id ("base") must NOT share a watermark, or the chain with the higher blocks would drag
# the other's cursor past its head and silently stop indexing it.
_GET_CURSOR = (
    "SELECT last_processed_block FROM indexer_cursors "
    "WHERE network_id = $1 AND stream = $2"
)
_SET_CURSOR = """
INSERT INTO indexer_cursors (network_id, stream, last_processed_block)
VALUES ($1, $2, $3)
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
# 028 activity fold — the OLDEST-first delta strictly after a (block, log) high-water mark.
_LIST_FLOWS_SINCE = """
SELECT decoded->>'kind' AS kind,
       decoded->>'assets' AS assets,
       decoded->>'shares' AS shares,
       block_number,
       encode(tx_hash, 'hex') AS tx_hash,
       log_index,
       created_at
FROM onchain_events
WHERE network_id = $1 AND address = $2 AND lower(decoded->>'owner') = lower($3)
  AND decoded->>'kind' IN ('deposit', 'withdraw')
  AND (block_number, log_index) > ($4, $5)
ORDER BY block_number ASC, log_index ASC
LIMIT $6
""".strip()


def _hexb(h: str) -> bytes:
    return bytes.fromhex(h[2:] if h.startswith("0x") else h)


@dataclass
class PgVaultFlowStore:
    """asyncpg-backed :class:`~sparkpoint_agent.data.log_source.VaultFlowStore`."""

    db: Database
    # 053 — the fallback contract for rows that carry none; each flow now stamps its OWN emitting
    # address (the launch vault or a curated wrapper).
    vault_address: str = ""
    #: The ``indexer_cursors.stream`` this store reads/writes. Defaults to the launch-vault
    #: stream; a second chain (4663 wrappers under the shared "base" mirror id) MUST pass its own
    #: stream so the two watermarks never collide.
    stream: str = "vault_flows"

    async def get_cursor(self, network_id: str) -> int:
        v = await self.db.fetchval(_GET_CURSOR, network_id, self.stream)
        return int(v) if v is not None else 0

    async def set_cursor(self, network_id: str, block: int) -> None:
        await self.db.execute(_SET_CURSOR, network_id, self.stream, block)

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
                , ensure_ascii=False)
                status = await conn.execute(
                    _UPSERT_EVENT,
                    network_id,
                    _hexb(f.tx_hash),
                    f.log_index,
                    (f.contract or self.vault_address).lower(),
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
    #: Indexer receipt time (028 fold reads carry it for day-granular line dates); ``None`` on
    #: the pre-028 projections that never selected it.
    created_at: datetime | None = None


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


@dataclass(frozen=True)
class RealizedOutcome:
    """One realized WITHDRAWAL — the atom of the §018/US5 outcomes ledger (USDC 6-dp).

    ``realized = assets_received − avg cost of the shares redeemed`` at the moment of THIS
    withdrawal (exact integer average-cost, mirroring :func:`replay_basis`). ``tx_hash`` is the
    withdrawal's own on-chain transaction — its verifiable proof. Position-level, NOT linked to a
    specific recommendation.
    """

    tx_hash: str
    block_number: int
    log_index: int
    assets_received: int  # USDC base units withdrawn in this event
    shares_redeemed: int
    realized: int  # signed USDC base units: assets_received − redeemed cost basis


@dataclass(frozen=True)
class OutcomeReplay:
    """The per-withdrawal realized-outcomes ledger over a position's COMPLETE indexed history.

    ``outcomes`` is one :class:`RealizedOutcome` per withdrawal, in on-chain execution order.
    ``reconciles`` is True iff the reconstructed share balance equals the on-chain balance (a
    complete, untransferred history) — the caller surfaces the ledger ONLY when it reconciles
    (else an honest empty state, never a partial-history guess). Same gate as
    :class:`BasisResult`; ``Σ outcome.realized == BasisResult.realized`` for the same flows.
    """

    outcomes: tuple[RealizedOutcome, ...]
    reconciles: bool


def replay_outcomes(flows: Sequence[FlowRow], current_shares: int) -> OutcomeReplay | None:
    """Average-cost replay → one realized outcome per withdrawal (exact integer math, never float).

    Same algorithm as :func:`replay_basis` — deposits add USDC cost + shares; each withdrawal
    realizes ``assets_received − avg_cost × shares_redeemed`` (redeemed cost rounds DOWN, mirroring
    the vault) — but RETAINS each withdrawal as its own row (with its ``tx_hash``) instead of only
    the running sum. None on no history. Never raises on a partial history: a withdrawal that would
    over-draw the reconstructed share balance flips ``reconciles`` False (caller shows empty).
    """
    if not flows:
        return None
    ordered = sorted(flows, key=lambda f: (f.block_number, f.log_index))
    cost = 0  # USDC cost basis of currently-held shares (6-dp base units)
    held = 0  # reconstructed shares held
    intact = True  # False once a withdrawal over-draws the reconstructed share balance (a gap)
    outcomes: list[RealizedOutcome] = []
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
        outcomes.append(
            RealizedOutcome(
                tx_hash=f.tx_hash,
                block_number=f.block_number,
                log_index=f.log_index,
                assets_received=f.assets,
                shares_redeemed=f.shares,
                realized=f.assets - redeemed_cost,
            )
        )
        cost -= redeemed_cost
        held -= f.shares
    return OutcomeReplay(outcomes=tuple(outcomes), reconciles=intact and held == current_shares)


@dataclass
class _LotState:
    """Mutable working state for one deposit lot during the FIFO replay (internal)."""

    deposit_tx: str
    entry_block: int
    cost_total: int
    cost_remaining: int
    shares_remaining: int
    realized: int
    exit_block: int = 0  # block of the last withdrawal that consumed this lot (0 while open)


@dataclass(frozen=True)
class Lot:
    """One deposit's realized+unrealized PnL — the atom of §020/US5 per-advice attribution (6-dp).

    ``realized`` is FIFO-attributed from later withdrawals against THIS deposit's shares;
    ``unrealized`` is the current mark of the lot's remaining shares minus their remaining cost.
    ``deposit_tx`` is the on-chain deposit — the join key from a rec's linked execution to its
    outcome. ``shared`` is True when the position is blended across ≥2 deposit lots (an honest
    "share of a shared position", not a fabricated split).
    """

    deposit_tx: str
    entry_block: int
    entry_cost: int  # USDC deposited (this lot's cost basis, $1 par)
    realized: int  # signed USDC base units, FIFO-realized on this lot
    unrealized: int  # signed USDC base units, current mark − remaining cost
    shares_remaining: int
    shared: bool
    exit_block: int = 0  # last withdrawal block that realized this lot (0 while any shares remain)


@dataclass(frozen=True)
class LotReplay:
    """Per-deposit-lot FIFO attribution over a position's COMPLETE indexed history.

    ``lots`` is one :class:`Lot` per deposit, in on-chain order. ``reconciles`` uses the SAME gate
    as :class:`OutcomeReplay` (reconstructed shares == on-chain balance, no gap) — the caller
    attributes a recommendation's outcome ONLY when it reconciles (else honest empty). ``Σ
    lot.realized`` equals :class:`BasisResult.realized` up to bounded per-lot rounding dust.
    """

    lots: tuple[Lot, ...]
    reconciles: bool


def replay_lots(
    flows: Sequence[FlowRow], current_shares: int, current_value: int
) -> LotReplay | None:
    """FIFO per-deposit lot replay → realized+unrealized PnL per deposit (exact integer math).

    Each deposit is a lot; each withdrawal consumes lots FIFO, realizing (assets attributed to the
    consumed shares − their cost basis) per lot (both round DOWN, mirroring the vault). A lot's
    unrealized marks its remaining shares to the live position value (``current_value`` =
    convertToAssets(current_shares); proportional, faithful to ERC-4626 linearity at a block). None
    on no history; never raises on a partial history — an over-draw flips ``reconciles``.
    """
    if not flows:
        return None
    ordered = sorted(flows, key=lambda f: (f.block_number, f.log_index))
    lots: list[_LotState] = []
    intact = True
    for f in ordered:
        if f.kind == "deposit":
            lots.append(
                _LotState(
                    deposit_tx=f.tx_hash,
                    entry_block=f.block_number,
                    cost_total=f.assets,
                    cost_remaining=f.assets,
                    shares_remaining=f.shares,
                    realized=0,
                )
            )
            continue
        # withdraw — consume lots FIFO
        if f.shares <= 0:
            intact = False
            continue
        remaining = f.shares
        for lot in lots:
            if remaining <= 0:
                break
            if lot.shares_remaining <= 0:
                continue
            k = min(remaining, lot.shares_remaining)
            assets_attr = f.assets * k // f.shares  # this withdrawal's assets for these k shares
            cost_rel = lot.cost_remaining * k // lot.shares_remaining
            lot.realized += assets_attr - cost_rel
            lot.cost_remaining -= cost_rel
            lot.shares_remaining -= k
            lot.exit_block = f.block_number  # last withdrawal to realize this lot
            remaining -= k
        if remaining > 0:
            intact = False  # a gap: over-drew the reconstructed share balance

    shared = len(lots) > 1
    result = tuple(
        Lot(
            deposit_tx=lot.deposit_tx,
            entry_block=lot.entry_block,
            entry_cost=lot.cost_total,
            realized=lot.realized,
            unrealized=(
                (current_value * lot.shares_remaining // current_shares if current_shares else 0)
                - lot.cost_remaining
            ),
            shares_remaining=lot.shares_remaining,
            shared=shared,
            exit_block=lot.exit_block,
        )
        for lot in lots
    )
    reconciles = intact and sum(lot.shares_remaining for lot in lots) == current_shares
    return LotReplay(lots=result, reconciles=reconciles)


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

    async def list_flows_since(
        self,
        network_id: str,
        vault: str,
        owner: str,
        after: tuple[int, int] | None,
        limit: int = 25,
    ) -> list[FlowRow]:
        """The owner's flows STRICTLY AFTER ``after`` = (block_number, log_index), OLDEST first —
        the 028 activity-fold delta read. ``None`` reads from the beginning (first fold; the fold
        itself samples/caps, this just bounds the scan). Includes ``created_at`` so the fold can
        date lines (day-granular; indexer receipt time, minutes of lag at most)."""
        block, log = after if after is not None else (-1, -1)
        rows = await self.db.fetch(
            _LIST_FLOWS_SINCE, network_id, vault.lower(), owner, block, log, limit
        )
        return [
            FlowRow(
                kind=str(r["kind"]),
                assets=int(r["assets"]),
                shares=int(r["shares"]),
                block_number=int(r["block_number"]),
                log_index=int(r["log_index"]),
                tx_hash="0x" + str(r["tx_hash"]),
                created_at=r["created_at"],
            )
            for r in rows
        ]
