"""Feature 013 — the swap-routing-fee indexer (DISPLAY/DERIVED-ONLY).

Walks ``eth_getLogs`` for ERC-20 ``Transfer`` logs whose ``from == the swap router`` AND
``to ∈ the fee-recipient set`` — i.e. exactly the 0.20% routing fees the router sweeps to the
fee recipient — and records them into ``swap_fee_events`` (migration 0018). The ``from == router``
filter is applied AT THE RPC (a topic filter) AND re-asserted at ingest, so a membership
(``from == buyer``) or a performance-fee transfer to a SHARED treasury address is never counted as
swap revenue (FR-010 / SC-004 / D7).

Keyless + keccak-free: reuses ``data/log_source.py``'s ``HttpxLogsRpc`` + ``_addr_from_topic`` and
the fixed ``ERC20_TRANSFER_TOPIC0`` constant. The token is ``log.address`` (no need to enumerate
output tokens — the from/to topic filter finds the fee transfer whatever token it was paid in).

Non-custody (N2): off the request path, fail-open, never on the withdraw/exit path — a stalled
indexer only makes the admin revenue figure momentarily incomplete.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import eth_abi

from ..chain.payment_verifier import ERC20_TRANSFER_TOPIC0
from ..db.swap_fees import SwapFeeEvent, SwapFeeEventStore
from .log_source import LogsRpc, _addr_from_topic

#: ERC-20 ``decimals()`` selector — keccak256("decimals()")[:4]. A fixed constant (keccak-free).
_DECIMALS_SELECTOR = "0x313ce567"

#: Blocks kept unfinalized: the cursor stops at ``head - FINALITY_MARGIN`` and the tail is
#: re-scanned every run, so a reorged-out block leaves zero retained rows (FR-008 / SC-009 / D5).
FINALITY_MARGIN = 5

_WINDOW = 2000
_MIN_WINDOW = 10
_MAX_WINDOWS_PER_RUN = 60
_PACING_S = 0.05


def _topic_for_addr(addr: str) -> str:
    """Left-pad a 20-byte address into its 32-byte indexed-topic form (lowercased)."""
    return "0x" + "0" * 24 + addr.lower().replace("0x", "")


def _decode_uint256(data: str) -> int:
    raw = bytes.fromhex(data[2:] if data.startswith("0x") else data)
    (value,) = eth_abi.decode(["uint256"], raw)
    return int(value)


@dataclass(frozen=True, slots=True)
class SwapIndexResult:
    """Outcome of a :meth:`SwapFeeIndexer.index_once` run."""

    inserted: int
    skipped: int  # already-present (idempotent) OR could-not-decode → skipped
    last_processed_block: int


@dataclass
class SwapFeeIndexer:
    """Records the router's fee ``Transfer``s into ``swap_fee_events`` (idempotent, finality-gated).

    ``recipients`` is a SET so a 014 fee-recipient cutover unions the old EOA + the new Safe — both
    are honestly counted from inception (D14). ``start_block`` floors the first run to the
    fee-recipient-inception (vault-deploy) block so the first cumulative reflects inception (D6).
    """

    transport: LogsRpc
    store: SwapFeeEventStore
    router: str
    recipients: frozenset[str]
    network_id: str = "base"
    start_block: int = 0
    window: int = _WINDOW

    async def _rpc(self, method: str, params: list[Any]) -> Any:
        return await self.transport.call(method, params)

    async def _head(self) -> int:
        return int(str(await self._rpc("eth_blockNumber", [])), 16)

    async def _get_logs(self, from_block: int, to_block: int) -> list[dict[str, object]]:
        # No `address` filter — the from/to topic filter matches the fee Transfer on any token.
        params = [
            {
                "fromBlock": hex(from_block),
                "toBlock": hex(to_block),
                "topics": [
                    ERC20_TRANSFER_TOPIC0,
                    _topic_for_addr(self.router),
                    [_topic_for_addr(r) for r in sorted(self.recipients)],
                ],
            }
        ]
        result = await self._rpc("eth_getLogs", params)
        return result if isinstance(result, list) else []

    async def _block_time(self, block_hex: str, cache: dict[str, datetime]) -> datetime:
        if block_hex in cache:
            return cache[block_hex]
        block = await self._rpc("eth_getBlockByNumber", [block_hex, False])
        ts = int(str(block["timestamp"]), 16) if isinstance(block, dict) else 0
        when = datetime.fromtimestamp(ts, tz=UTC)
        cache[block_hex] = when
        return when

    async def _decimals(self, token: str, cache: dict[str, int]) -> int:
        if token in cache:
            return cache[token]
        dec = 18  # fail-open default (display scaling only; value_raw is authoritative)
        try:
            raw = await self._rpc("eth_call", [{"to": token, "data": _DECIMALS_SELECTOR}, "latest"])
            if isinstance(raw, str) and raw not in ("0x", ""):
                dec = int(raw, 16)
        except Exception:  # noqa: BLE001 — a decimals read must never crash the loop (fail-open)
            dec = 18
        cache[token] = dec
        return dec

    async def _tx_sender(self, tx_hash: str, cache: dict[str, str | None]) -> str | None:
        """028: the swap's SIGNER (tx ``from``) — one cached eth_getTransactionByHash per tx.
        ``None`` on any failure: the fee row is still written, just never attributed (honest)."""
        if tx_hash in cache:
            return cache[tx_hash]
        sender: str | None = None
        try:
            tx = await self._rpc("eth_getTransactionByHash", [tx_hash])
            raw = tx.get("from") if isinstance(tx, dict) else None
            if isinstance(raw, str) and raw.startswith("0x") and len(raw) == 42:
                sender = raw.lower()
        except Exception:  # noqa: BLE001 — attribution is best-effort, ingestion never fails on it
            sender = None
        cache[tx_hash] = sender
        return sender

    async def index_once(self, network_id: str | None = None) -> SwapIndexResult:
        """Catch up from the cursor to ``head - FINALITY_MARGIN`` in bounded windows."""
        net = network_id or self.network_id
        try:
            head = await self._head()
        except Exception:  # noqa: BLE001 — head unavailable → no-op this tick
            return SwapIndexResult(0, 0, 0)
        ceiling = head - FINALITY_MARGIN
        raw_cursor = await self.store.get_cursor(net)
        frm = self.start_block if raw_cursor <= 0 else max(raw_cursor + 1, self.start_block)
        if frm > ceiling:
            return SwapIndexResult(0, 0, raw_cursor)

        inserted = skipped = 0
        attempts = 0
        window = max(_MIN_WINDOW, self.window)
        block_cache: dict[str, datetime] = {}
        decimals_cache: dict[str, int] = {}
        sender_cache: dict[str, str | None] = {}
        last = raw_cursor
        router = self.router.lower()

        while frm <= ceiling and attempts < _MAX_WINDOWS_PER_RUN:
            attempts += 1
            to = min(frm + window - 1, ceiling)
            try:
                logs = await self._get_logs(frm, to)
            except Exception:  # noqa: BLE001 — too-large range / provider blip → shrink + retry frm
                if window > _MIN_WINDOW:
                    window = max(_MIN_WINDOW, window // 4)
                    continue
                break  # at the floor and still failing → stop; cursor holds the last good block
            for log in logs:
                ev = await self._decode(log, net, router, block_cache, decimals_cache, sender_cache)
                if ev is None:
                    skipped += 1
                    continue
                if await self.store.record(ev):
                    inserted += 1
                else:
                    skipped += 1
            await self.store.set_cursor(net, to)
            last = to
            frm = to + 1
            if frm <= ceiling:
                await asyncio.sleep(_PACING_S)
        return SwapIndexResult(inserted, skipped, last)

    async def _decode(
        self,
        log: dict[str, object],
        net: str,
        router: str,
        block_cache: dict[str, datetime],
        decimals_cache: dict[str, int],
        sender_cache: dict[str, str | None],
    ) -> SwapFeeEvent | None:
        topics = log.get("topics") or []
        if not isinstance(topics, list) or len(topics) < 3:
            return None
        if str(topics[0]).lower() != ERC20_TRANSFER_TOPIC0:
            return None
        frm = _addr_from_topic(str(topics[1]))
        to = _addr_from_topic(str(topics[2]))
        # Re-assert attribution at ingest (defense in depth vs the RPC topic filter): a fee is ONLY
        # a Transfer FROM the router TO a configured recipient (D7 disambiguation).
        if frm != router or to not in self.recipients:
            return None
        token = str(log.get("address", "")).lower()
        if not token:
            return None
        try:
            value = _decode_uint256(str(log.get("data", "0x")))
            block_hex = str(log.get("blockNumber"))
            block_number = int(block_hex, 16)
            block_time = await self._block_time(block_hex, block_cache)
            decimals = await self._decimals(token, decimals_cache)
            log_index = int(str(log.get("logIndex")), 16)
        except Exception:  # noqa: BLE001 — an undecodable log is skipped, never crashes the loop
            return None
        tx_hash = str(log.get("transactionHash", "")).lower()
        # 028: attribute the swap to its SIGNER (best-effort, cached; None = unattributed).
        swapper = await self._tx_sender(tx_hash, sender_cache) if tx_hash else None
        return SwapFeeEvent(
            network_id=net,
            tx_hash=tx_hash,
            log_index=log_index,
            block_number=block_number,
            block_time=block_time,
            token_address=token,
            token_decimals=decimals,
            fee_value_raw=value,
            from_address=frm,
            to_address=to,
            swapper_address=swapper,
        )
