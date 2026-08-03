"""T110 — the performance-fee event indexer (DISPLAY/DERIVED-ONLY).

Replays the SparkPointVault's fee-accrual events into the ``fee_events`` ledger
(migration 0002 / data-model.md sec.8a) so the admin revenue dashboard + the Trust
Center can show cumulative realized performance-fee revenue, per-period revenue, and the
current fee-rate / high-water mark. The fee itself is realized ON CHAIN as share
DILUTION — fee shares minted to a non-privileged ``feeRecipient`` — and this module only
INDEXES that fact.

Non-custody boundary (VR-FE3 / N2 — LOAD-BEARING)
-------------------------------------------------
This module is provably OFF the withdraw/redeem path:

  - it imports NOTHING from ``policy/`` (the deterministic decision path stays index-free)
    and is NEVER imported by ``policy/`` — a test asserts both directions;
  - it holds no key and issues no state-changing call; it only READS decoded logs + the
    Postgres mirror. Fee accrual on-chain is FAIL-OPEN (a failed accrual is swallowed so a
    redemption is never blocked); this indexer inherits that: it can only ever DROP or
    FLAG a row (a ``risk_event``), never block, delay, or revert a redemption, and a
    missing/late ``fee_events`` row can never gate a withdraw (VR-FE3);
  - the full fee history is reconstructable from chain alone (VR-FE5), so the ledger is an
    accelerator, never a dependency.

Reconstruction from chain (data-model.md sec.8a)
------------------------------------------------
``accrueFee()`` emits, in the same tx and at adjacent log indexes::

    PerformanceFeeAccrued(feeRecipient indexed, feeShares, yieldAssets, newHighWaterMark)
    HighWaterMarkUpdated(oldHighWaterMark, newHighWaterMark)

The accrual event carries the post-mint HWM (``newHighWaterMark`` == ``hwm_after``); the
paired ``HighWaterMarkUpdated`` at ``log_index + 1`` carries the mark this accrual
advanced FROM (``oldHighWaterMark`` == ``hwm_before``). A standalone
``HighWaterMarkUpdated`` (deposit-time ``_settleHighWaterMark``) advances the HWM without a
fee and produces NO ``fee_events`` row. ``FeeRateUpdated(oldRateBps, newRateBps)`` moves
the rate timeline that stamps ``fee_rate_bps_at_event``.

Topic0 (keccak of the event signature) identification is the LOG SOURCE's job, not this
module's: like ``chain/vault_reader.py``, this surface stays keccak-free (the pure
``eth-abi`` codec decodes the indexed topics + data words once a log is identified). The
canonical signature strings are exported as :data:`EVENT_SIGNATURES` for the source to hash.

Validation rules enforced (data-model.md sec.8a)
------------------------------------------------
  - VR-FE2: ``fee_shares_minted_raw`` reconciles to ``fee_rate_bps_at_event x
    yield_realized_raw`` at the event share price; drift beyond an integer-rounding
    tolerance raises a ``risk_event`` (the row is still indexed — display/derived).
  - VR-FE2 / VR-V1a: ``fee_rate_bps_at_event`` <= 2000 (hard cap); a rate above the cap is a
    critical ``risk_event`` and the row is DROPPED (fail-open, never crash).
  - VR-FE4: ``hwm_after_ray`` >= ``hwm_before_ray`` (monotonic); a retreat is a ``risk_event``
    and the row is dropped.
  - Idempotent replay: insert is ``ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING``
    — indexing the same log twice yields one row.
"""

from __future__ import annotations

import json
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any, Protocol

import eth_abi

# ─────────────────────────────────────────────────────────────────────────────
# On-chain constants (mirror contracts/src/vault/SparkPointVault.sol; NOT imported
# from policy/ — this display module must stay decoupled from the decision path).
# ─────────────────────────────────────────────────────────────────────────────

#: Hard cap on the performance fee (smart-contracts.md §6.1 / VR-V1a). The vault reverts
#: any ``setPerformanceFeeBps`` above this, so a stamped rate above it is a critical breach.
MAX_PERFORMANCE_FEE_BPS = 2000

#: basis-point denominator (feeAssets = gain * rateBps / 10_000, per accrueFee()).
_BPS_DENOMINATOR = 10_000

#: Share-price scale: the vault's HWM / pps is ``convertToAssets(1e18)`` — assets per 1e18
#: shares. The fee shares' asset-claim at the event price is ``feeShares * hwm / 1e18``.
_SHARE_SCALE = 10**18

#: Default lazy-accrual trigger when the co-located ERC-4626 event is unknown (a bare
#: ``accrueFee()`` / ``harvest()`` call). Never load-bearing for custody.
_DEFAULT_TRIGGER = "harvest"
_TRIGGER_KINDS: frozenset[str] = frozenset({"deposit", "withdraw", "harvest"})

#: Canonical event signatures. topic0 = keccak256(signature) is computed by the LOG SOURCE
#: (which owns a keccak backend); this keyless/keccak-free module never hashes them.
EVENT_SIGNATURES: Mapping[str, str] = {
    "PerformanceFeeAccrued": "PerformanceFeeAccrued(address,uint256,uint256,uint256)",
    "HighWaterMarkUpdated": "HighWaterMarkUpdated(uint256,uint256)",
    "FeeRateUpdated": "FeeRateUpdated(uint16,uint16)",
}


# ─────────────────────────────────────────────────────────────────────────────
# Decoded log types (reconstructed EXACTLY from chain logs)
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class LogMeta:
    """Chain coordinates common to every decoded log (reproducibility + idempotency key)."""

    network_id: str
    block_number: int
    block_time: datetime
    tx_hash: bytes  # 32-byte tx hash (stored as BYTEA)
    log_index: int


@dataclass(frozen=True, slots=True)
class PerformanceFeeAccrued:
    """``PerformanceFeeAccrued(feeRecipient indexed, feeShares, yieldAssets, newHighWaterMark)``.

    ``yield_assets`` is the yield realized ABOVE the HWM (never principal; VR-FE1);
    ``new_high_water_mark`` is the post-mint pps (== ``hwm_after``). ``trigger_kind`` is the
    co-located ERC-4626 trigger if the source resolved it, else ``None`` (→ 'harvest').
    """

    meta: LogMeta
    fee_recipient: str  # lowercased 0x address
    fee_shares: int
    yield_assets: int
    new_high_water_mark: int
    trigger_kind: str | None = None


@dataclass(frozen=True, slots=True)
class HighWaterMarkUpdated:
    """``HighWaterMarkUpdated(oldHighWaterMark, newHighWaterMark)`` — fee-paired or standalone."""

    meta: LogMeta
    old_high_water_mark: int
    new_high_water_mark: int


@dataclass(frozen=True, slots=True)
class FeeRateUpdated:
    """``FeeRateUpdated(oldRateBps, newRateBps)`` — moves the fee-rate timeline (VR-V1a)."""

    meta: LogMeta
    old_rate_bps: int
    new_rate_bps: int


VaultFeeLog = PerformanceFeeAccrued | HighWaterMarkUpdated | FeeRateUpdated


# ─────────────────────────────────────────────────────────────────────────────
# Pure eth-abi decoders (keccak-free; topic0 identification is the source's job)
# ─────────────────────────────────────────────────────────────────────────────


def _to_bytes(hex_str: str) -> bytes:
    return bytes.fromhex(hex_str[2:] if hex_str.startswith("0x") else hex_str)


def _decode_data(types: Sequence[str], data: str) -> tuple[Any, ...]:
    decoded: tuple[Any, ...] = eth_abi.decode(list(types), _to_bytes(data))
    return decoded


def _decode_indexed_address(topic: str) -> str:
    """Decode an indexed ``address`` from its 32-byte topic word (lowercased 0x)."""
    (addr,) = eth_abi.decode(["address"], _to_bytes(topic))
    return str(addr).lower()


def decode_performance_fee_accrued(
    *, topics: Sequence[str], data: str, meta: LogMeta, trigger_kind: str | None = None
) -> PerformanceFeeAccrued:
    """Decode a raw ``PerformanceFeeAccrued`` log (``topics[1]`` = indexed feeRecipient)."""
    if len(topics) < 2:
        raise ValueError("PerformanceFeeAccrued requires an indexed feeRecipient topic")
    fee_shares, yield_assets, new_hwm = _decode_data(["uint256", "uint256", "uint256"], data)
    return PerformanceFeeAccrued(
        meta=meta,
        fee_recipient=_decode_indexed_address(topics[1]),
        fee_shares=int(fee_shares),
        yield_assets=int(yield_assets),
        new_high_water_mark=int(new_hwm),
        trigger_kind=trigger_kind,
    )


def decode_high_water_mark_updated(*, data: str, meta: LogMeta) -> HighWaterMarkUpdated:
    """Decode a raw ``HighWaterMarkUpdated`` log (both args non-indexed)."""
    old_hwm, new_hwm = _decode_data(["uint256", "uint256"], data)
    return HighWaterMarkUpdated(
        meta=meta, old_high_water_mark=int(old_hwm), new_high_water_mark=int(new_hwm)
    )


def decode_fee_rate_updated(*, data: str, meta: LogMeta) -> FeeRateUpdated:
    """Decode a raw ``FeeRateUpdated`` log (both args non-indexed uint16)."""
    old_rate, new_rate = _decode_data(["uint16", "uint16"], data)
    return FeeRateUpdated(meta=meta, old_rate_bps=int(old_rate), new_rate_bps=int(new_rate))


# ─────────────────────────────────────────────────────────────────────────────
# Persisted row + risk event + aggregate result types
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True, slots=True)
class FeeEventRow:
    """One ``fee_events`` row (data-model.md sec.8a). Amounts are raw base units (int)."""

    network_id: str
    vault_address: str
    fee_recipient: str
    trigger_kind: str
    block_number: int
    block_time: datetime
    as_of_block: int
    tx_hash: bytes
    log_index: int
    fee_rate_bps_at_event: int
    yield_realized_raw: int
    fee_shares_minted_raw: int
    hwm_before_ray: int
    hwm_after_ray: int


class RiskKind(StrEnum):
    """Why the indexer raised a ``risk_event`` (audit_logs.event_type='risk_event')."""

    FEE_RECONCILE_DRIFT = "fee_reconcile_drift"  # VR-FE2: feeShares != rate x yield (± rounding)
    FEE_RATE_OVER_CAP = "fee_rate_over_cap"  # VR-FE2 / VR-V1a: rate > 2000 bps (hard cap)
    HWM_RETREAT = "hwm_retreat"  # VR-FE4: hwm_after < hwm_before
    UNPAIRED_ACCRUAL = "unpaired_accrual"  # no paired HighWaterMarkUpdated found for hwm_before
    HWM_PAIR_MISMATCH = "hwm_pair_mismatch"  # paired update's new HWM != accrual's new HWM
    ZERO_FEE_ANOMALY = "zero_fee_anomaly"  # accrual emitted with zero yield or zero fee shares


@dataclass(frozen=True, slots=True)
class RiskEvent:
    """A flagged integrity anomaly. NEVER blocks a redemption (VR-FE3) — a side-channel log."""

    kind: RiskKind
    network_id: str
    tx_hash: bytes
    log_index: int
    detail: Mapping[str, Any]
    critical: bool = False


@dataclass(frozen=True, slots=True)
class IndexResult:
    """Outcome of an :meth:`FeeIndexer.index` run."""

    inserted: int
    skipped: int  # already-present (idempotent) OR dropped-on-integrity-breach
    dropped: int  # dropped because a DB CHECK would fail (rate>cap / hwm retreat)
    risk_events: tuple[RiskEvent, ...]
    last_processed_block: int


@dataclass(frozen=True, slots=True)
class PeriodBucket:
    """A per-period revenue bucket for the dashboard time series."""

    period_start: datetime
    fee_shares_minted_raw: int
    yield_realized_raw: int
    event_count: int


@dataclass(frozen=True, slots=True)
class FeeRevenueSummary:
    """Aggregate performance-fee revenue for the admin dashboard (all raw base units)."""

    network_id: str
    vault_address: str
    cumulative_fee_shares_minted_raw: int
    cumulative_yield_realized_raw: int
    event_count: int
    first_event_time: datetime | None
    last_event_time: datetime | None
    current_fee_rate_bps: int | None
    current_high_water_mark_ray: int | None
    periods: tuple[PeriodBucket, ...]


# ─────────────────────────────────────────────────────────────────────────────
# Ports (mockable): the persistence store + the live current-state reader
# ─────────────────────────────────────────────────────────────────────────────


class FeeEventStore(Protocol):
    """Persistence port for the fee ledger (mockable; the deterministic path never sees it)."""

    async def insert_fee_event(self, row: FeeEventRow) -> bool:
        """Insert idempotently; return True iff a new row was written (False on conflict)."""
        ...

    async def record_risk_event(self, risk: RiskEvent) -> None:
        """Append a ``risk_event`` to the audit spine. MUST NEVER raise into the caller path."""
        ...

    async def get_cursor(self, network_id: str, stream: str) -> int:
        """Last processed block for ``(network_id, stream)`` (0 if unseen)."""
        ...

    async def set_cursor(self, network_id: str, stream: str, block: int) -> None:
        """Advance the replay cursor for ``(network_id, stream)``."""
        ...

    async def fetch_fee_events(
        self,
        network_id: str,
        vault_address: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[FeeEventRow]:
        """Fetch ledger rows for a vault (optionally windowed), ordered oldest-first."""
        ...


class CurrentFeeStateReader(Protocol):
    """The live on-chain current fee-rate / HWM (structurally satisfied by chain.VaultReader).

    Optional: when absent, the summary derives current values from the latest ledger row.
    Kept as a Protocol so this module never imports ``chain/`` (decoupled by construction).
    """

    async def performance_fee_bps(self) -> int: ...
    async def high_water_mark(self) -> int: ...


#: The indexer_cursors.stream name for the fee replay (reuses the 0001 table).
FEE_STREAM = "vault_fee"


# ─────────────────────────────────────────────────────────────────────────────
# The indexer
# ─────────────────────────────────────────────────────────────────────────────


def _sort_key(log: VaultFeeLog) -> tuple[int, int]:
    return (log.meta.block_number, log.meta.log_index)


@dataclass(slots=True)
class _Reconciliation:
    ok: bool
    expected_fee_assets: int
    implied_fee_assets: int
    drift: int
    tolerance: int


class FeeIndexer:
    """Replays decoded vault fee logs into the ``fee_events`` ledger + exposes the aggregate.

    Stateless across runs except through the injected :class:`FeeEventStore` (the cursor +
    the rows). Construct with an optional live :class:`CurrentFeeStateReader` for the
    dashboard's current fee-rate / HWM.
    """

    def __init__(
        self,
        store: FeeEventStore,
        *,
        current_state: CurrentFeeStateReader | None = None,
        reconcile_abs_tolerance: int = 2,
    ) -> None:
        self._store = store
        self._current_state = current_state
        # Absolute floor added to the per-event integer-rounding tolerance (VR-FE2).
        self._reconcile_abs_tolerance = max(0, reconcile_abs_tolerance)

    # ── replay ────────────────────────────────────────────────────────────────

    async def index(
        self,
        network_id: str,
        vault_address: str,
        logs: Iterable[VaultFeeLog],
        *,
        as_of_block: int,
        initial_rate_bps: int = 1000,
        initial_hwm_ray: int = _SHARE_SCALE,
    ) -> IndexResult:
        """Replay ``logs`` into the ledger (idempotent, fail-open, reconstructable).

        ``initial_rate_bps`` / ``initial_hwm_ray`` seed the rate / HWM in effect just BEFORE
        the first log (defaults: the constructor-seeded 1000 bps and 1e18 pps). A run that
        starts mid-history should pass the values read at its start block. Order-independent
        input: logs are sorted by ``(block_number, log_index)`` first.
        """
        vault_address = vault_address.lower()
        ordered = sorted(logs, key=_sort_key)
        hwm_by_key = self._index_hwm_updates(ordered)

        current_rate = initial_rate_bps
        current_hwm = initial_hwm_ray
        inserted = skipped = dropped = 0
        risks: list[RiskEvent] = []
        last_block = 0

        for log in ordered:
            last_block = max(last_block, log.meta.block_number)

            if isinstance(log, FeeRateUpdated):
                current_rate = log.new_rate_bps
                if log.new_rate_bps > MAX_PERFORMANCE_FEE_BPS:
                    risks.append(
                        self._risk(
                            RiskKind.FEE_RATE_OVER_CAP, log.meta,
                            {"new_rate_bps": log.new_rate_bps, "cap": MAX_PERFORMANCE_FEE_BPS},
                            critical=True,
                        )
                    )
                continue

            if isinstance(log, HighWaterMarkUpdated):
                current_hwm = log.new_high_water_mark
                continue

            # PerformanceFeeAccrued → build + persist a row (with per-event validation).
            row, event_risks, was_dropped = self._build_row(
                log, network_id, vault_address, current_rate, current_hwm, as_of_block, hwm_by_key
            )
            risks.extend(event_risks)
            if was_dropped:
                dropped += 1
            elif row is not None:
                if await self._store.insert_fee_event(row):
                    inserted += 1
                else:
                    skipped += 1  # already indexed (idempotent replay)

        for risk in risks:
            await self._store.record_risk_event(risk)

        cursor_block = max(last_block, as_of_block)
        await self._store.set_cursor(network_id, FEE_STREAM, cursor_block)
        return IndexResult(
            inserted=inserted,
            skipped=skipped,
            dropped=dropped,
            risk_events=tuple(risks),
            last_processed_block=cursor_block,
        )

    @staticmethod
    def _index_hwm_updates(
        ordered: Sequence[VaultFeeLog],
    ) -> dict[tuple[bytes, int], HighWaterMarkUpdated]:
        """Index HighWaterMarkUpdated logs by ``(tx_hash, log_index)`` for accrual pairing."""
        by_key: dict[tuple[bytes, int], HighWaterMarkUpdated] = {}
        for log in ordered:
            if isinstance(log, HighWaterMarkUpdated):
                by_key[(log.meta.tx_hash, log.meta.log_index)] = log
        return by_key

    def _build_row(
        self,
        log: PerformanceFeeAccrued,
        network_id: str,
        vault_address: str,
        current_rate: int,
        current_hwm: int,
        as_of_block: int,
        hwm_by_key: Mapping[tuple[bytes, int], HighWaterMarkUpdated],
    ) -> tuple[FeeEventRow | None, list[RiskEvent], bool]:
        """Assemble one fee_events row from an accrual, applying VR-FE1/2/4 checks.

        Returns ``(row, risk_events, dropped)``. ``dropped`` is True when a DB CHECK would
        reject the row (rate>cap / hwm retreat) — the indexer fails open and skips the write
        rather than crash. A drifted-but-storable row is still returned (display/derived).
        """
        risks: list[RiskEvent] = []
        hwm_after = log.new_high_water_mark

        # hwm_before ← the paired HighWaterMarkUpdated at the NEXT log index in the same tx
        # (authoritative; carries oldHWM). Fall back to the running HWM if the pair is absent.
        pair = hwm_by_key.get((log.meta.tx_hash, log.meta.log_index + 1))
        if pair is None:
            hwm_before = current_hwm
            risks.append(
                self._risk(
                    RiskKind.UNPAIRED_ACCRUAL, log.meta,
                    {"fallback_hwm_before_ray": str(hwm_before)},
                )
            )
        else:
            hwm_before = pair.old_high_water_mark
            if pair.new_high_water_mark != hwm_after:
                risks.append(
                    self._risk(
                        RiskKind.HWM_PAIR_MISMATCH, log.meta,
                        {
                            "accrual_new_hwm": str(hwm_after),
                            "pair_new_hwm": str(pair.new_high_water_mark),
                        },
                    )
                )

        trigger = log.trigger_kind if log.trigger_kind in _TRIGGER_KINDS else _DEFAULT_TRIGGER

        # VR-FE2 / VR-V1a: a rate above the hard cap is impossible on-chain → drop the row
        # (the DB CHECK would reject it) and flag critical. The FeeRateUpdated pass already
        # flags the rate change itself; this guards the stamped accrual.
        if current_rate > MAX_PERFORMANCE_FEE_BPS:
            risks.append(
                self._risk(
                    RiskKind.FEE_RATE_OVER_CAP, log.meta,
                    {"rate_bps": current_rate, "cap": MAX_PERFORMANCE_FEE_BPS},
                    critical=True,
                )
            )
            return None, risks, True

        # VR-FE4: the HWM only advances. A retreat would violate the CHECK → drop + flag.
        if hwm_after < hwm_before:
            risks.append(
                self._risk(
                    RiskKind.HWM_RETREAT, log.meta,
                    {"hwm_before_ray": str(hwm_before), "hwm_after_ray": str(hwm_after)},
                )
            )
            return None, risks, True

        # VR-FE1 anomaly: a real accrual always mints on positive yield; zero on either side
        # is emitted only if something is off. Flag (still storable — 0 satisfies the CHECKs).
        if log.yield_assets <= 0 or log.fee_shares <= 0:
            risks.append(
                self._risk(
                    RiskKind.ZERO_FEE_ANOMALY, log.meta,
                    {"yield_assets": log.yield_assets, "fee_shares": log.fee_shares},
                )
            )

        # VR-FE2: feeShares reconcile to rate × yield at the event share price.
        recon = self._reconcile(log.fee_shares, log.yield_assets, current_rate, hwm_after)
        if not recon.ok:
            risks.append(
                self._risk(
                    RiskKind.FEE_RECONCILE_DRIFT, log.meta,
                    {
                        "expected_fee_assets": str(recon.expected_fee_assets),
                        "implied_fee_assets": str(recon.implied_fee_assets),
                        "drift": str(recon.drift),
                        "tolerance": str(recon.tolerance),
                        "rate_bps": current_rate,
                    },
                )
            )

        row = FeeEventRow(
            network_id=network_id,
            vault_address=vault_address,
            fee_recipient=log.fee_recipient.lower(),
            trigger_kind=trigger,
            block_number=log.meta.block_number,
            block_time=log.meta.block_time,
            as_of_block=as_of_block,
            tx_hash=log.meta.tx_hash,
            log_index=log.meta.log_index,
            fee_rate_bps_at_event=current_rate,
            yield_realized_raw=log.yield_assets,
            fee_shares_minted_raw=log.fee_shares,
            hwm_before_ray=hwm_before,
            hwm_after_ray=hwm_after,
        )
        return row, risks, False

    def _reconcile(
        self, fee_shares: int, yield_assets: int, rate_bps: int, hwm_after: int
    ) -> _Reconciliation:
        """VR-FE2: reconcile minted fee shares to ``rate × yield`` at the post-mint pps.

        On-chain: ``feeAssets = yield * rate / 10_000``; the fee shares' claim at the post-mint
        price (``hwm_after`` = ``convertToAssets(1e18)`` after the mint) is
        ``feeShares * hwm_after / 1e18``. Both legs round DOWN, so allow a tolerance of one
        share's asset value (``hwm_after // 1e18``) plus a small absolute floor.
        """
        expected_fee_assets = (yield_assets * rate_bps) // _BPS_DENOMINATOR
        implied_fee_assets = (fee_shares * hwm_after) // _SHARE_SCALE
        drift = abs(expected_fee_assets - implied_fee_assets)
        tolerance = (hwm_after // _SHARE_SCALE) + self._reconcile_abs_tolerance
        return _Reconciliation(
            ok=drift <= tolerance,
            expected_fee_assets=expected_fee_assets,
            implied_fee_assets=implied_fee_assets,
            drift=drift,
            tolerance=tolerance,
        )

    @staticmethod
    def _risk(
        kind: RiskKind, meta: LogMeta, detail: Mapping[str, Any], *, critical: bool = False
    ) -> RiskEvent:
        return RiskEvent(
            kind=kind,
            network_id=meta.network_id,
            tx_hash=meta.tx_hash,
            log_index=meta.log_index,
            detail=dict(detail),
            critical=critical,
        )

    # ── aggregate (admin revenue dashboard) ─────────────────────────────────────

    async def revenue_summary(
        self,
        network_id: str,
        vault_address: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
        period: str = "day",
    ) -> FeeRevenueSummary:
        """Cumulative + per-period realized performance-fee revenue and current rate/HWM.

        Aggregation runs in Python over the fetched ledger rows so the numbers are provable
        from the same rows the dashboard shows. ``period`` buckets by ``day``/``month``/
        ``year`` (truncating ``block_time``). Current rate/HWM come from the live reader when
        injected, else from the most recent ledger row.
        """
        rows = await self._store.fetch_fee_events(
            network_id, vault_address.lower(), since=since, until=until
        )
        cumulative_shares = sum(r.fee_shares_minted_raw for r in rows)
        cumulative_yield = sum(r.yield_realized_raw for r in rows)
        times = [r.block_time for r in rows]
        periods = self._bucket_periods(rows, period)
        current_rate, current_hwm = await self._current_rate_hwm(rows)

        return FeeRevenueSummary(
            network_id=network_id,
            vault_address=vault_address.lower(),
            cumulative_fee_shares_minted_raw=cumulative_shares,
            cumulative_yield_realized_raw=cumulative_yield,
            event_count=len(rows),
            first_event_time=min(times) if times else None,
            last_event_time=max(times) if times else None,
            current_fee_rate_bps=current_rate,
            current_high_water_mark_ray=current_hwm,
            periods=periods,
        )

    @staticmethod
    def _truncate(when: datetime, period: str) -> datetime:
        if period == "year":
            return when.replace(month=1, day=1, hour=0, minute=0, second=0, microsecond=0)
        if period == "month":
            return when.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        if period == "day":
            return when.replace(hour=0, minute=0, second=0, microsecond=0)
        raise ValueError(f"unsupported period {period!r} (expected day|month|year)")

    def _bucket_periods(self, rows: Sequence[FeeEventRow], period: str) -> tuple[PeriodBucket, ...]:
        shares: dict[datetime, int] = defaultdict(int)
        realized: dict[datetime, int] = defaultdict(int)
        counts: dict[datetime, int] = defaultdict(int)
        for r in rows:
            key = self._truncate(r.block_time, period)
            shares[key] += r.fee_shares_minted_raw
            realized[key] += r.yield_realized_raw
            counts[key] += 1
        return tuple(
            PeriodBucket(
                period_start=key,
                fee_shares_minted_raw=shares[key],
                yield_realized_raw=realized[key],
                event_count=counts[key],
            )
            for key in sorted(shares)
        )

    async def _current_rate_hwm(self, rows: Sequence[FeeEventRow]) -> tuple[int | None, int | None]:
        if self._current_state is not None:
            rate = await self._current_state.performance_fee_bps()
            hwm = await self._current_state.high_water_mark()
            return rate, hwm
        if not rows:
            return None, None
        latest = max(rows, key=lambda r: (r.block_number, r.log_index))
        return latest.fee_rate_bps_at_event, latest.hwm_after_ray


# ─────────────────────────────────────────────────────────────────────────────
# Concrete Postgres store (out-of-band; unit tests use an in-memory fake)
# ─────────────────────────────────────────────────────────────────────────────


class PgFeeEventStore:
    """asyncpg-backed :class:`FeeEventStore` over the ``fee_events`` ledger (migration 0002).

    Parameterized SQL only (asyncpg binds server-side — no interpolation). Idempotent insert
    via ``ON CONFLICT DO NOTHING``; ``record_risk_event`` appends to the ``audit_logs``
    provability spine as ``(actor_kind='indexer', event_type='risk_event')`` and swallows any
    error so a logging failure can never disturb the caller (VR-FE3 fail-open).
    """

    def __init__(self, db: _Executor) -> None:
        self._db = db

    async def insert_fee_event(self, row: FeeEventRow) -> bool:
        status = await self._db.execute(
            """
            INSERT INTO fee_events (
                network_id, vault_address, fee_recipient, trigger_kind,
                block_number, block_time, as_of_block, tx_hash, log_index,
                fee_rate_bps_at_event, yield_realized_raw, fee_shares_minted_raw,
                hwm_before_ray, hwm_after_ray
            ) VALUES (
                $1, $2, $3, $4::fee_trigger, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
            )
            ON CONFLICT (network_id, tx_hash, log_index) DO NOTHING
            """,
            row.network_id,
            row.vault_address,
            row.fee_recipient,
            row.trigger_kind,
            row.block_number,
            row.block_time,
            row.as_of_block,
            row.tx_hash,
            row.log_index,
            row.fee_rate_bps_at_event,
            row.yield_realized_raw,
            row.fee_shares_minted_raw,
            row.hwm_before_ray,
            row.hwm_after_ray,
        )
        # asyncpg returns "INSERT 0 1" on write, "INSERT 0 0" when the conflict was a no-op.
        return status.strip().endswith(" 1")

    async def record_risk_event(self, risk: RiskEvent) -> None:
        payload = {
            "kind": str(risk.kind),
            "network_id": risk.network_id,
            "tx_hash": "0x" + risk.tx_hash.hex(),
            "log_index": risk.log_index,
            "critical": risk.critical,
            "detail": dict(risk.detail),
        }
        try:
            await self._db.execute(
                """
                INSERT INTO audit_logs (actor_kind, actor_ref, event_type, subject_table, payload)
                VALUES ('indexer', 'fee_indexer', 'risk_event', 'fee_events', $1::jsonb)
                """,
                _json_dumps(payload),
            )
        except Exception:  # noqa: BLE001, S110 — a risk-log failure must never block indexing (VR-FE3)
            pass

    async def get_cursor(self, network_id: str, stream: str) -> int:
        value = await self._db.fetchval(
            "SELECT last_processed_block FROM indexer_cursors "
            "WHERE network_id = $1 AND stream = $2",
            network_id,
            stream,
        )
        return int(value) if value is not None else 0

    async def set_cursor(self, network_id: str, stream: str, block: int) -> None:
        await self._db.execute(
            """
            INSERT INTO indexer_cursors (network_id, stream, last_processed_block, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (network_id, stream)
            DO UPDATE SET last_processed_block = GREATEST(
                indexer_cursors.last_processed_block, EXCLUDED.last_processed_block
            ), updated_at = now()
            """,
            network_id,
            stream,
            block,
        )

    async def fetch_fee_events(
        self,
        network_id: str,
        vault_address: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[FeeEventRow]:
        rows = await self._db.fetch(
            """
            SELECT network_id, vault_address, fee_recipient, trigger_kind,
                   block_number, block_time, as_of_block, tx_hash, log_index,
                   fee_rate_bps_at_event, yield_realized_raw, fee_shares_minted_raw,
                   hwm_before_ray, hwm_after_ray
            FROM fee_events
            WHERE network_id = $1 AND vault_address = $2
              AND ($3::timestamptz IS NULL OR block_time >= $3)
              AND ($4::timestamptz IS NULL OR block_time <  $4)
            ORDER BY block_number, log_index
            """,
            network_id,
            vault_address,
            since,
            until,
        )
        return [_row_from_record(r) for r in rows]


class _Executor(Protocol):
    """The subset of ``db.pool.Database`` the store needs (keeps this module import-light)."""

    async def execute(self, query: str, *args: Any) -> str: ...
    async def fetch(self, query: str, *args: Any) -> list[Any]: ...
    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any: ...


def _row_from_record(record: Any) -> FeeEventRow:
    """Map an asyncpg Record → FeeEventRow (NUMERIC → int, bytea → bytes)."""
    return FeeEventRow(
        network_id=str(record["network_id"]),
        vault_address=str(record["vault_address"]),
        fee_recipient=str(record["fee_recipient"]),
        trigger_kind=str(record["trigger_kind"]),
        block_number=int(record["block_number"]),
        block_time=record["block_time"],
        as_of_block=int(record["as_of_block"]),
        tx_hash=bytes(record["tx_hash"]),
        log_index=int(record["log_index"]),
        fee_rate_bps_at_event=int(record["fee_rate_bps_at_event"]),
        yield_realized_raw=int(record["yield_realized_raw"]),
        fee_shares_minted_raw=int(record["fee_shares_minted_raw"]),
        hwm_before_ray=int(record["hwm_before_ray"]),
        hwm_after_ray=int(record["hwm_after_ray"]),
    )


def _json_dumps(payload: Mapping[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), sort_keys=True, ensure_ascii=False)
