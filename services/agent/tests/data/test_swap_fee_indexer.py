# ruff: noqa: S101  (pytest asserts)
"""Feature 013 — the swap-fee indexer (data/swap_fee_indexer.py).

Assert the on-chain-attribution + finality invariants:
  - a Transfer(from == router, to == recipient) on the output token → exactly one row, right value;
  - a re-run over the same range records ZERO duplicates (SC-003);
  - the cursor advances only to head - FINALITY_MARGIN; a log inside it is NOT indexed (SC-009);
  - a Transfer whose `from` is NOT the router, or to a NON-recipient, is rejected at ingest
    even if the RPC hands it over (defense in depth vs a shared treasury — D7 / SC-004);
  - the first run backfills from the configured start (inception) block, not a recent window (D6).
"""

from __future__ import annotations

from typing import Any

from sparkpoint_agent.chain.payment_verifier import ERC20_TRANSFER_TOPIC0
from sparkpoint_agent.data.swap_fee_indexer import (
    FINALITY_MARGIN,
    SwapFeeIndexer,
    _topic_for_addr,
)
from sparkpoint_agent.db.swap_fees import SwapFeeEvent

ROUTER = "0x94cc0aac535ccdb3c01d6787d6413c739ae12bc4"
RECIP = "0xcb135893c84876aab9e10792b56e5bea91dc578f"
BUYER = "0x1111111111111111111111111111111111111111"
STRANGER = "0x2222222222222222222222222222222222222222"
USDC = "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f"


def _log(
    *,
    frm: str,
    to: str,
    token: str,
    value: int,
    block: int,
    log_index: int = 0,
    tx: str | None = None,
) -> dict[str, Any]:
    return {
        "topics": [ERC20_TRANSFER_TOPIC0, _topic_for_addr(frm), _topic_for_addr(to)],
        "data": "0x" + f"{value:064x}",
        "address": token,
        "blockNumber": hex(block),
        "logIndex": hex(log_index),
        "transactionHash": tx or ("0x" + f"{block:064x}"),
    }


class _FakeRpc:
    def __init__(self, head: int, logs: list[dict[str, Any]], *, decimals: int = 6) -> None:
        self.head = head
        self.logs = logs
        self.decimals = decimals
        self.getlogs_ranges: list[tuple[int, int]] = []

    async def call(self, method: str, params: list[Any]) -> Any:
        if method == "eth_blockNumber":
            return hex(self.head)
        if method == "eth_getLogs":
            f = int(params[0]["fromBlock"], 16)
            t = int(params[0]["toBlock"], 16)
            self.getlogs_ranges.append((f, t))
            return [x for x in self.logs if f <= int(x["blockNumber"], 16) <= t]
        if method == "eth_getBlockByNumber":
            return {"timestamp": hex(1_700_000_000)}
        if method == "eth_call":
            return "0x" + f"{self.decimals:064x}"
        return None


class _FakeStore:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str, int], SwapFeeEvent] = {}
        self.cursor = 0

    async def record(self, ev: SwapFeeEvent) -> bool:
        key = (ev.network_id, ev.tx_hash, ev.log_index)
        if key in self.rows:
            return False
        self.rows[key] = ev
        return True

    async def get_cursor(self, network_id: str) -> int:
        return self.cursor

    async def set_cursor(self, network_id: str, block: int) -> None:
        self.cursor = max(self.cursor, block)

    async def fetch(
        self, network_id: str, *, since: Any = None, until: Any = None
    ) -> list[SwapFeeEvent]:
        return [r for r in self.rows.values() if r.network_id == network_id]


def _indexer(rpc: _FakeRpc, store: _FakeStore, *, start_block: int = 0) -> SwapFeeIndexer:
    return SwapFeeIndexer(
        transport=rpc,
        store=store,
        router=ROUTER,
        recipients=frozenset({RECIP}),
        network_id="base",
        start_block=start_block,
        window=2000,
    )


async def test_router_fee_transfer_is_recorded_once() -> None:
    rpc = _FakeRpc(head=100, logs=[_log(frm=ROUTER, to=RECIP, token=USDC, value=50_000, block=90)])
    store = _FakeStore()
    result = await _indexer(rpc, store).index_once()
    assert result.inserted == 1
    (row,) = list(store.rows.values())
    assert row.token_address == USDC and row.fee_value_raw == 50_000
    assert row.from_address == ROUTER and row.to_address == RECIP and row.token_decimals == 6


async def test_rerun_records_zero_duplicates() -> None:
    logs = [_log(frm=ROUTER, to=RECIP, token=USDC, value=50_000, block=90)]
    store = _FakeStore()
    first = await _indexer(_FakeRpc(head=100, logs=logs), store).index_once()
    # Re-run over an overlapping range (cursor rewound to force a re-scan of block 90).
    store.cursor = 80
    second = await _indexer(_FakeRpc(head=100, logs=logs), store).index_once()
    assert first.inserted == 1 and second.inserted == 0
    assert len(store.rows) == 1


async def test_cursor_advances_only_to_finality_ceiling() -> None:
    rpc = _FakeRpc(head=100, logs=[_log(frm=ROUTER, to=RECIP, token=USDC, value=1, block=90)])
    store = _FakeStore()
    await _indexer(rpc, store).index_once()
    assert store.cursor == 100 - FINALITY_MARGIN  # never past the unfinalized tail


async def test_log_inside_finality_margin_is_not_indexed() -> None:
    # head=100, margin=5 → ceiling 95; a fee at block 98 is unfinalized → must NOT be recorded yet.
    rpc = _FakeRpc(head=100, logs=[_log(frm=ROUTER, to=RECIP, token=USDC, value=1, block=98)])
    store = _FakeStore()
    result = await _indexer(rpc, store).index_once()
    assert result.inserted == 0 and len(store.rows) == 0
    # Once it finalizes (head advances) it is picked up.
    rpc2 = _FakeRpc(head=110, logs=[_log(frm=ROUTER, to=RECIP, token=USDC, value=1, block=98)])
    result2 = await _indexer(rpc2, store).index_once()
    assert result2.inserted == 1


async def test_non_router_sender_is_rejected_at_ingest() -> None:
    # A membership transfer (from == buyer) to the SAME recipient address the RPC hands over anyway.
    rpc = _FakeRpc(head=100, logs=[_log(frm=BUYER, to=RECIP, token=USDC, value=500, block=90)])
    store = _FakeStore()
    result = await _indexer(rpc, store).index_once()
    assert result.inserted == 0 and len(store.rows) == 0  # never counted as swap revenue (D7)


async def test_non_recipient_destination_is_rejected() -> None:
    rpc = _FakeRpc(head=100, logs=[_log(frm=ROUTER, to=STRANGER, token=USDC, value=500, block=90)])
    store = _FakeStore()
    result = await _indexer(rpc, store).index_once()
    assert result.inserted == 0 and len(store.rows) == 0


async def test_first_run_backfills_from_inception_block() -> None:
    rpc = _FakeRpc(head=1000, logs=[])
    store = _FakeStore()  # cursor 0 → first run
    await _indexer(rpc, store, start_block=500).index_once()
    assert (
        rpc.getlogs_ranges[0][0] == 500
    )  # begins at the configured inception, not a recent window
