"""046 — the vault fee-event LOG SOURCE: the missing half of the T110 fee indexer.

Why this module exists
----------------------
:class:`~.fee_indexer.FeeIndexer` has always been able to *replay* decoded vault fee logs into
``fee_events`` — but it takes an ``Iterable[VaultFeeLog]`` and **nothing in the runtime ever
produced one**. ``FeeIndexer.index()`` had no caller outside tests; only the read side
(``revenue_summary``) was wired, from ``api/admin_revenue.py``. The visible consequence, measured
on develop 2026-08-18: ``fee_events`` held **0 rows** and the ``(base, vault_fee)`` cursor was still
at block **0**, stamped the day the table was created (2026-07-14), while the ``swap_fee`` and
``vault_flows`` cursors were minutes fresh.

So the performance-fee half of ``/admin/revenue`` could only ever read zero — not because the vault
earned nothing, but because nobody was listening. This module is the listener: it walks
``eth_getLogs`` for the vault's own three fee events, decodes them with the decoders that already
existed, and hands them to ``FeeIndexer.index()``.

⚠️ topic0 is DERIVED, never written down
----------------------------------------
The topic0 of each event is computed with keccak from :data:`~.fee_indexer.EVENT_SIGNATURES` at
import time. This is deliberate and it is the lesson of feature 044: two of four **hand-written**
selectors there were wrong, and a wrong topic does **not** raise — ``eth_getLogs`` simply matches
nothing, the stream stays empty, and the surface degrades to "no revenue" while looking healthy.
An empty result is indistinguishable from a correct one, so the derivation must not be trusted to a
human transcription. ``fee_indexer``'s own docstring anticipated this: the signatures are exported
"for the source to hash".

Non-custody (N2 / VR-FE3)
-------------------------
Inherits the whole posture of the module it feeds: off the request path, fail-open, holds no key,
issues no state-changing call. A stalled or broken run can only leave the admin revenue figure
momentarily incomplete — it can never block, delay or revert a redemption.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from eth_utils import keccak

from .fee_indexer import (
    EVENT_SIGNATURES,
    FEE_STREAM,
    FeeEventStore,
    FeeIndexer,
    IndexResult,
    LogMeta,
    VaultFeeLog,
    decode_fee_rate_updated,
    decode_high_water_mark_updated,
    decode_performance_fee_accrued,
)
from .log_source import LogsRpc

logger = logging.getLogger(__name__)


def _topic0(signature: str) -> str:
    """keccak256 of a canonical event signature, as a lowercase 0x topic."""
    return "0x" + keccak(text=signature).hex()


#: event name → topic0, derived (never transcribed). See the module docstring.
TOPIC0_BY_EVENT: dict[str, str] = {
    name: _topic0(signature) for name, signature in EVENT_SIGNATURES.items()
}
#: The reverse map the decoder dispatch uses.
EVENT_BY_TOPIC0: dict[str, str] = {topic: name for name, topic in TOPIC0_BY_EVENT.items()}

#: ``performanceFeeBps()`` / ``highWaterMark()`` — derived the same way, for the same reason.
_SEL_FEE_BPS = "0x" + keccak(text="performanceFeeBps()").hex()[:8]
_SEL_HWM = "0x" + keccak(text="highWaterMark()").hex()[:8]

#: Blocks left unindexed at the head so a reorged-out block never leaves a retained row.
#: Matches ``swap_fee_indexer.FINALITY_MARGIN`` — same chain, same reasoning.
FINALITY_MARGIN = 5

#: Starting ``eth_getLogs`` span. ⚠️ Measured, not guessed, and the numbers differ wildly by
#: provider — the same lesson feature 044 learned against eRPC:
#:
#:   * ``sepolia.base.org`` (public)  accepts **10,000** blocks
#:   * **Alchemy's free tier**        accepts **10** — and it is what ``BASE_SEPOLIA_RPC_URL``
#:                                    points at, so this narrows to the floor in production
#:
#: Starting high and narrowing costs a handful of wasted requests on the first tick and then
#: nothing; starting at the floor would cripple a provider that could do 1,000x better.
WINDOW = 2000
MIN_WINDOW = 10

#: Request budget for ONE tick. Bounds the work a single loop iteration can do, so a stream that
#: starts far behind catches up over several ticks instead of hanging one for minutes.
MAX_WINDOWS_PER_RUN = 60

#: Politeness delay between windows against a shared public endpoint.
PACING_S = 0.05

#: Fallbacks used only when the live seed read fails. 1000 bps is the vault's deployed rate and
#: 1e18 is a share price of exactly 1.0 — the same defaults ``FeeIndexer.index`` documents.
DEFAULT_RATE_BPS = 1000
DEFAULT_HWM_RAY = 10**18


@dataclass(frozen=True, slots=True)
class VaultFeeIndexResult:
    """Outcome of one :meth:`VaultFeeLogSource.index_once` tick."""

    inserted: int
    skipped: int
    dropped: int
    logs_seen: int
    last_processed_block: int
    #: True when the tick stopped on its window budget rather than reaching the head.
    more_to_do: bool = False


@dataclass
class VaultFeeLogSource:
    """Walks the vault's fee logs and feeds :class:`FeeIndexer`.

    ``transport`` is the same keyless raw-result JSON-RPC surface the other indexers use, so this
    needs no key and no new dependency.
    """

    transport: LogsRpc
    store: FeeEventStore
    vault_address: str
    network_id: str = "base"
    start_block: int = 0
    window: int = WINDOW
    #: Injectable for tests; constructed from ``store`` when absent. ``FeeIndexer`` is stateless
    #: across runs except through the store, so building one per tick costs nothing.
    indexer: FeeIndexer | None = None

    def __post_init__(self) -> None:
        self.vault_address = self.vault_address.lower()

    # ── raw RPC ───────────────────────────────────────────────────────────────

    async def _rpc(self, method: str, params: list[Any]) -> Any:
        return await self.transport.call(method, params)

    async def _head(self) -> int:
        return int(str(await self._rpc("eth_blockNumber", [])), 16)

    async def _get_logs(self, from_block: int, to_block: int) -> list[dict[str, Any]]:
        """All three fee events for this vault, in one filter.

        The ``address`` filter is what makes this cheap — unlike the swap-fee indexer, which
        cannot use one because the fee ``Transfer`` is emitted by whichever token was paid.
        """
        params = [
            {
                "address": self.vault_address,
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "topics": [sorted(TOPIC0_BY_EVENT.values())],
            }
        ]
        result = await self._rpc("eth_getLogs", params)
        return result if isinstance(result, list) else []

    async def _block_time(self, block_hex: str, cache: dict[str, datetime]) -> datetime:
        if block_hex in cache:
            return cache[block_hex]
        try:
            block = await self._rpc("eth_getBlockByNumber", [block_hex, False])
            stamp = int(str(block["timestamp"]), 16) if isinstance(block, dict) else 0
        except Exception:  # noqa: BLE001 — a timestamp read must never fail ingestion (fail-open)
            stamp = 0
        when = datetime.fromtimestamp(stamp, tz=UTC)
        cache[block_hex] = when
        return when

    async def _call_uint(self, selector: str) -> int | None:
        """One ``eth_call`` returning a single uint, or ``None`` if it cannot be read."""
        try:
            call = [{"to": self.vault_address, "data": selector}, "latest"]
            raw = await self._rpc("eth_call", call)
        except Exception:  # noqa: BLE001 — a seed read must never crash the loop (fail-open)
            return None
        if isinstance(raw, str) and raw not in ("0x", ""):
            return int(raw, 16)
        return None

    async def _seed_state(self) -> tuple[int, int]:
        """Read the vault's CURRENT fee rate + HWM, to seed the values in effect before the batch.

        ⚠️ This is the state at the HEAD, not at ``start_block``. That is correct for the live
        loop (which is always at the head) and is the reason a deep historical backfill should be
        run as an explicit one-shot with a known start block rather than by rewinding this cursor.
        In practice it barely matters: ``FeeIndexer`` takes ``hwm_before`` from the
        ``HighWaterMarkUpdated`` paired in the *same transaction* and only falls back to this seed
        when the accrual is unpaired — which it flags as a risk event either way.
        """
        rate = await self._call_uint(_SEL_FEE_BPS)
        hwm = await self._call_uint(_SEL_HWM)
        return (
            DEFAULT_RATE_BPS if rate is None else rate,
            DEFAULT_HWM_RAY if hwm is None else hwm,
        )

    # ── decode ────────────────────────────────────────────────────────────────

    def _decode(self, log: dict[str, Any], block_time: datetime) -> VaultFeeLog | None:
        """Raw log → a typed :data:`VaultFeeLog`, or ``None`` when it is not ours / is malformed."""
        topics = log.get("topics") or []
        if not isinstance(topics, list) or not topics:
            return None
        event = EVENT_BY_TOPIC0.get(str(topics[0]).lower())
        if event is None:
            return None
        try:
            meta = LogMeta(
                network_id=self.network_id,
                block_number=int(str(log["blockNumber"]), 16),
                block_time=block_time,
                tx_hash=bytes.fromhex(str(log["transactionHash"])[2:]),
                log_index=int(str(log["logIndex"]), 16),
            )
            data = str(log.get("data") or "0x")
            if event == "PerformanceFeeAccrued":
                return decode_performance_fee_accrued(topics=topics, data=data, meta=meta)
            if event == "HighWaterMarkUpdated":
                return decode_high_water_mark_updated(data=data, meta=meta)
            return decode_fee_rate_updated(data=data, meta=meta)
        except Exception:  # noqa: BLE001 — one undecodable log must not stop the batch
            return None

    # ── the tick ──────────────────────────────────────────────────────────────

    async def index_once(self) -> VaultFeeIndexResult:
        """Catch up from the cursor to ``head - FINALITY_MARGIN``, in bounded windows.

        Every window's logs are accumulated and handed to ``FeeIndexer.index()`` **once**, rather
        than per window. That keeps the rate/HWM timeline continuous across the whole batch (the
        indexer is order-independent and sorts internally), and it is affordable precisely because
        vault fee logs are rare — a busy month produces a handful, not thousands.
        """
        try:
            head = await self._head()
        except Exception:  # noqa: BLE001 — head unavailable → no-op this tick
            return VaultFeeIndexResult(0, 0, 0, 0, 0)

        ceiling = head - FINALITY_MARGIN
        raw_cursor = await self.store.get_cursor(self.network_id, FEE_STREAM)
        frm = self.start_block if raw_cursor <= 0 else max(raw_cursor + 1, self.start_block)
        if frm > ceiling:
            return VaultFeeIndexResult(0, 0, 0, 0, raw_cursor)

        collected: list[VaultFeeLog] = []
        block_cache: dict[str, datetime] = {}
        window = max(MIN_WINDOW, self.window)
        attempts = 0
        covered = raw_cursor
        logs_seen = 0

        while frm <= ceiling and attempts < MAX_WINDOWS_PER_RUN:
            attempts += 1
            to = min(frm + window - 1, ceiling)
            try:
                logs = await self._get_logs(frm, to)
            except Exception:  # noqa: BLE001 — range cap / provider blip → shrink and retry `frm`
                if window > MIN_WINDOW:
                    window = max(MIN_WINDOW, window // 4)
                    continue
                break  # at the floor and still failing → stop; the cursor holds the last good block
            for raw in logs:
                logs_seen += 1
                when = await self._block_time(str(raw.get("blockNumber")), block_cache)
                decoded = self._decode(raw, when)
                if decoded is not None:
                    collected.append(decoded)
            covered = to
            frm = to + 1
            if frm <= ceiling:
                await asyncio.sleep(PACING_S)

        if covered <= raw_cursor:
            # Nothing was successfully read — do NOT advance the cursor past unread blocks.
            #
            # ⚠️ And SAY SO. The first version returned here silently, which produced exactly the
            # failure this module was written to prevent: a frozen cursor, no error anywhere, and a
            # revenue surface reading zero indistinguishably from an idle vault. A tick that reads
            # nothing is the single most important thing this loop can report, because it is the
            # only state that looks identical to success from the outside.
            logger.warning(
                "vault_fee_read_nothing network=%s cursor=%d attempts=%d window=%d "
                "— every getLogs window was refused; the cursor is holding",
                self.network_id, raw_cursor, attempts, window,
            )
            return VaultFeeIndexResult(0, 0, 0, logs_seen, raw_cursor, more_to_do=True)

        rate, hwm = await self._seed_state()
        indexer = self.indexer or FeeIndexer(self.store)
        result: IndexResult = await indexer.index(
            self.network_id,
            self.vault_address,
            collected,
            as_of_block=covered,
            initial_rate_bps=rate,
            initial_hwm_ray=hwm,
        )
        return VaultFeeIndexResult(
            inserted=result.inserted,
            skipped=result.skipped,
            dropped=result.dropped,
            logs_seen=logs_seen,
            last_processed_block=result.last_processed_block,
            more_to_do=covered < ceiling,
        )
