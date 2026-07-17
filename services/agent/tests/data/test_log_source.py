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

    async def call(self, method: str, params: Any) -> Any:
        if method == "eth_blockNumber":
            return hex(self._head)
        if method == "eth_getLogs":
            frm = int(params[0]["fromBlock"], 16)
            to = int(params[0]["toBlock"], 16)
            self.windows.append((frm, to))
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
