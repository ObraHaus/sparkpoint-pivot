# ruff: noqa: S101
"""§B2 vault-flows indexer — log decode + windowed catch-up (hermetic, no network)."""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.data.log_source import (
    DEPOSIT_TOPIC0,
    WITHDRAW_TOPIC0,
    VaultFlow,
    VaultFlowIndexer,
    decode_flow_log,
)

OWNER = "0x00000000000000000000000000000000000000aa"
SENDER = "0x00000000000000000000000000000000000000bb"


def _topic_addr(a: str) -> str:
    return "0x" + a[2:].rjust(64, "0")


def _data(assets: int, shares: int) -> str:
    return "0x" + f"{assets:064x}{shares:064x}"


def test_decode_deposit() -> None:
    log = {
        "topics": [DEPOSIT_TOPIC0, _topic_addr(SENDER), _topic_addr(OWNER)],
        "data": _data(250_000_000, 125_000_000),
        "blockNumber": hex(44_248_630),
        "transactionHash": "0x" + "ab" * 32,
        "logIndex": hex(5),
    }
    flow = decode_flow_log(log)
    assert flow is not None
    assert flow.kind == "deposit"
    assert flow.owner == OWNER  # topic 2 (the position owner), not the sender
    assert flow.assets == 250_000_000
    assert flow.shares == 125_000_000
    assert flow.block_number == 44_248_630


def test_decode_withdraw_owner_is_third_topic() -> None:
    log = {
        "topics": [WITHDRAW_TOPIC0, _topic_addr(SENDER), _topic_addr(SENDER), _topic_addr(OWNER)],
        "data": _data(100_000_000, 50_000_000),
        "blockNumber": hex(1000),
        "transactionHash": "0x" + "cd" * 32,
        "logIndex": hex(1),
    }
    flow = decode_flow_log(log)
    assert flow is not None
    assert flow.kind == "withdraw"
    assert flow.owner == OWNER  # topic 3
    assert flow.assets == 100_000_000


def test_decode_ignores_unrelated_topic0() -> None:
    assert decode_flow_log({"topics": ["0x" + "00" * 32], "data": "0x"}) is None
    assert decode_flow_log({"topics": []}) is None


class _FakeStore:
    def __init__(self) -> None:
        self.cursor = 0
        self.flows: list[VaultFlow] = []

    async def get_cursor(self, network_id: str) -> int:
        return self.cursor

    async def set_cursor(self, network_id: str, block: int) -> None:
        self.cursor = block

    async def upsert_flows(self, network_id: str, flows: Any) -> int:
        self.flows.extend(flows)
        return len(flows)


class _FakeTransport:
    """Serves eth_blockNumber + eth_getLogs; records the requested windows."""

    def __init__(self, head: int, logs_at: dict[tuple[int, int], list[dict[str, Any]]]) -> None:
        self._head = head
        self._logs = logs_at
        self.windows: list[tuple[int, int]] = []
        self.filters: list[Any] = []

    async def call(self, method: str, params: Any) -> Any:
        if method == "eth_blockNumber":
            return hex(self._head)
        if method == "eth_getLogs":
            frm = int(params[0]["fromBlock"], 16)
            to = int(params[0]["toBlock"], 16)
            self.windows.append((frm, to))
            self.filters.append(params[0]["address"])
            return self._logs.get((frm, to), [])
        raise AssertionError(method)


@pytest.mark.asyncio
async def test_indexer_walks_windows_and_advances_cursor() -> None:
    # head is 3500 blocks past the start floor → 2 windows (≤2000 each); the cursor lands on head.
    start = 44_240_000
    head = start + 3500
    dep = {
        "topics": [DEPOSIT_TOPIC0, _topic_addr(SENDER), _topic_addr(OWNER)],
        "data": _data(250_000_000, 125_000_000),
        "blockNumber": hex(start + 100),
        "transactionHash": "0x" + "ab" * 32,
        "logIndex": hex(5),
    }
    transport = _FakeTransport(head, {(start, start + 1999): [dep]})
    store = _FakeStore()
    idx = VaultFlowIndexer(
        transport=transport, store=store, vault_address="0xVault",
        network_id="base", start_block=start,
    )
    written = await idx.run_once()
    assert written == 1
    assert store.cursor == head  # advanced to head
    assert len(transport.windows) == 2  # 2000 + the remaining ~1500
    assert store.flows[0].owner == OWNER


@pytest.mark.asyncio
async def test_indexer_noop_when_caught_up() -> None:
    transport = _FakeTransport(100, {})
    store = _FakeStore()
    store.cursor = 100
    idx = VaultFlowIndexer(transport=transport, store=store, vault_address="0xV", start_block=0)
    assert await idx.run_once() == 0


class _CappedTransport:
    """Simulates a provider that REJECTS getLogs windows larger than ``cap`` blocks (Alchemy Free
    returns HTTP 400 → the transport raises). Serves the deposit in whatever window contains it."""

    def __init__(self, head: int, cap: int, deposit_block: int) -> None:
        self._head = head
        self._cap = cap
        self._dep = deposit_block
        self.windows: list[tuple[int, int]] = []
        self.rejects = 0

    async def call(self, method: str, params: Any) -> Any:
        if method == "eth_blockNumber":
            return hex(self._head)
        if method == "eth_getLogs":
            frm = int(params[0]["fromBlock"], 16)
            to = int(params[0]["toBlock"], 16)
            if to - frm + 1 > self._cap:
                self.rejects += 1
                raise RuntimeError(f"query exceeds max block range {self._cap}")
            self.windows.append((frm, to))
            if frm <= self._dep <= to:
                return [{
                    "topics": [DEPOSIT_TOPIC0, _topic_addr(SENDER), _topic_addr(OWNER)],
                    "data": _data(250_000_000, 125_000_000),
                    "blockNumber": hex(self._dep),
                    "transactionHash": "0x" + "ab" * 32,
                    "logIndex": hex(5),
                }]
            return []
        raise AssertionError(method)


@pytest.mark.asyncio
async def test_indexer_shrinks_window_to_provider_cap_and_still_indexes() -> None:
    # Alchemy Free (10-block cap): the 2000-block window must SHRINK to <=10 (not hard-fail), then
    # walk the range and still index the deposit + advance the cursor to head.
    dep = 1000
    transport = _CappedTransport(head=1030, cap=10, deposit_block=dep)
    store = _FakeStore()
    idx = VaultFlowIndexer(
        transport=transport, store=store, vault_address="0xVault",
        network_id="base", start_block=dep - 5, window=2000,
    )
    written = await idx.run_once()
    assert written == 1  # the deposit was found despite the tight cap
    assert transport.rejects >= 1  # it actually hit the cap and shrank
    assert all(to - frm + 1 <= 10 for frm, to in transport.windows)  # served windows fit the cap
    assert store.cursor == 1030  # advanced to head
    assert store.flows[0].owner == OWNER


# ── 053 — the wrapper fleet: multi-address watching + per-contract stamping ──


def test_decode_stamps_the_emitting_contract() -> None:
    log = {
        "address": "0xAbC0000000000000000000000000000000000001",
        "topics": [DEPOSIT_TOPIC0, _topic_addr(SENDER), _topic_addr(OWNER)],
        "data": _data(1_000_000, 1_000_000),
        "blockNumber": hex(10),
        "transactionHash": "0x" + "ef" * 32,
        "logIndex": hex(0),
    }
    flow = decode_flow_log(log)
    assert flow is not None
    assert flow.contract == "0xabc0000000000000000000000000000000000001"


@pytest.mark.asyncio
async def test_indexer_watches_every_address_and_stamps_each_contract() -> None:
    start = 1_000
    head = 1_100
    vault = "0x00000000000000000000000000000000000000dd"
    wrapper = "0x00000000000000000000000000000000000000cc"
    dep = {
        "address": wrapper,
        "topics": [DEPOSIT_TOPIC0, _topic_addr(SENDER), _topic_addr(OWNER)],
        "data": _data(100_000_000, 100_000_000),
        "blockNumber": hex(1_050),
        "transactionHash": "0x" + "11" * 32,
        "logIndex": hex(2),
    }
    transport = _FakeTransport(head, {(start, head): [dep]})
    store = _FakeStore()
    idx = VaultFlowIndexer(
        transport=transport,
        store=store,
        vault_address=vault,
        addresses=[vault, wrapper],
        network_id="base",
        start_block=start,
    )
    assert await idx.run_once() == 1
    assert transport.filters == [[vault, wrapper]]
    assert store.flows[0].contract == wrapper


@pytest.mark.asyncio
async def test_indexer_with_nothing_to_watch_issues_no_getlogs() -> None:
    transport = _FakeTransport(100, {})
    store = _FakeStore()
    idx = VaultFlowIndexer(transport=transport, store=store, start_block=0)
    assert await idx.run_once() == 0
    assert transport.filters == []
