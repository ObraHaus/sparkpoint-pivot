# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""046 — the vault fee-event log source: topic derivation, windowing, and cursor safety.

The tests that carry weight here are the two that guard failure modes which are INVISIBLE at
runtime:

  * **topic0 must match the deployed ABI.** A wrong topic makes ``eth_getLogs`` match nothing.
    Nothing raises, the stream stays empty, and ``/admin/revenue`` reports "no performance-fee
    revenue" — which is exactly what a genuinely idle vault looks like. Feature 044 shipped two
    wrong hand-written selectors for this exact reason, so the topics are recomputed here from
    the COMMITTED ABI rather than compared against another copy of the same literal.

  * **the cursor must not advance over blocks that were never read.** A provider range-cap
    rejection is the normal case on Alchemy's free tier; if a failed window still moved the
    cursor, the fee events in those blocks would be skipped permanently and silently.

Everything runs against a fake transport + the in-memory store — no live chain, no DB.
"""

from __future__ import annotations

import json
import pathlib
from datetime import UTC, datetime
from typing import Any

import pytest
from eth_abi import encode as abi_encode
from eth_utils import keccak

from sparkpoint_agent.data.fee_indexer import FEE_STREAM, PerformanceFeeAccrued
from sparkpoint_agent.data.vault_fee_source import (
    EVENT_BY_TOPIC0,
    MIN_WINDOW,
    TOPIC0_BY_EVENT,
    VaultFeeLogSource,
)

from .test_fee_indexer import FakeStore

_VAULT = "0x00000000000000000000000000000000000000AA"
_RECIPIENT = "0x1111111111111111111111111111111111111111"
_SCALE = 10**18

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_VAULT_ABI = _REPO_ROOT / "packages/shared/src/abis/SparkPointVault.abi.json"


# ─────────────────────────────────────────────────────────────────────────────
# The guard that matters: topic0 recomputed from the committed ABI
# ─────────────────────────────────────────────────────────────────────────────


def _abi_items() -> list[dict[str, Any]]:
    raw = json.loads(_VAULT_ABI.read_text())
    items = raw["abi"] if isinstance(raw, dict) and "abi" in raw else raw
    assert isinstance(items, list)
    return items


def test_topic0_matches_the_deployed_abi() -> None:
    """Recompute each topic from the ABI's own input types — not from our signature strings.

    This is deliberately a DIFFERENT derivation path than the module's: the module hashes
    ``EVENT_SIGNATURES``, this hashes the type list the compiler emitted. If someone edits an
    event's arguments in Solidity and forgets the signature table, these two disagree and the
    test fails — which is the only moment that mistake is ever visible.
    """
    events = {i["name"]: i for i in _abi_items() if i.get("type") == "event"}
    assert set(TOPIC0_BY_EVENT) <= set(events), "an indexed event is missing from the vault ABI"

    for name, topic in TOPIC0_BY_EVENT.items():
        types = ",".join(i["type"] for i in events[name]["inputs"])
        from_abi = "0x" + keccak(text=f"{name}({types})").hex()
        assert topic == from_abi, f"{name}: topic0 disagrees with the deployed ABI"


def test_topic_map_is_bijective() -> None:
    """A collision would silently route one event's logs into another's decoder."""
    assert len(EVENT_BY_TOPIC0) == len(TOPIC0_BY_EVENT) == 3


# ─────────────────────────────────────────────────────────────────────────────
# Fake transport
# ─────────────────────────────────────────────────────────────────────────────


class FakeRpc:
    """A LogsRpc that serves canned logs and can refuse ranges wider than ``max_span``.

    ``max_span=10`` reproduces Alchemy's free tier, which is what production actually talks to.
    """

    def __init__(
        self,
        head: int,
        logs: list[dict[str, Any]] | None = None,
        *,
        max_span: int | None = None,
        fee_bps: int = 1000,
        hwm: int = _SCALE,
    ) -> None:
        self.head = head
        self.logs = logs or []
        self.max_span = max_span
        self.fee_bps = fee_bps
        self.hwm = hwm
        self.log_calls: list[tuple[int, int]] = []
        self.eth_calls = 0

    async def call(self, method: str, params: list[Any]) -> Any:
        if method == "eth_blockNumber":
            return hex(self.head)
        if method == "eth_getBlockByNumber":
            return {"timestamp": hex(1_780_000_000)}
        if method == "eth_call":
            self.eth_calls += 1
            data = params[0]["data"]
            # performanceFeeBps() / highWaterMark() — dispatch on the derived selector.
            sel_bps = "0x" + keccak(text="performanceFeeBps()").hex()[:8]
            return hex(self.fee_bps if data == sel_bps else self.hwm)
        if method == "eth_getLogs":
            frm = int(params[0]["fromBlock"], 16)
            to = int(params[0]["toBlock"], 16)
            self.log_calls.append((frm, to))
            if self.max_span is not None and (to - frm + 1) > self.max_span:
                raise RuntimeError("getLogs RPC HTTP 400")  # provider range cap
            return [
                log for log in self.logs if frm <= int(log["blockNumber"], 16) <= to
            ]
        raise AssertionError(f"unexpected RPC {method}")


def _accrual_log(
    block: int, *, fee_shares: int, yield_assets: int, hwm_after: int
) -> dict[str, Any]:
    topic = TOPIC0_BY_EVENT["PerformanceFeeAccrued"]
    return {
        "address": _VAULT.lower(),
        "blockNumber": hex(block),
        "logIndex": "0x0",
        "transactionHash": "0x" + f"{block:064x}",
        "topics": [topic, "0x" + "0" * 24 + _RECIPIENT[2:].lower()],
        "data": "0x"
        + abi_encode(
            ["uint256", "uint256", "uint256"], [fee_shares, yield_assets, hwm_after]
        ).hex(),
    }


def _hwm_log(block: int, *, old: int, new: int, log_index: int = 1) -> dict[str, Any]:
    return {
        "address": _VAULT.lower(),
        "blockNumber": hex(block),
        "logIndex": hex(log_index),
        "transactionHash": "0x" + f"{block:064x}",
        "topics": [TOPIC0_BY_EVENT["HighWaterMarkUpdated"]],
        "data": "0x" + abi_encode(["uint256", "uint256"], [old, new]).hex(),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Decoding + ingestion
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_an_accrual_reaches_the_ledger() -> None:
    """The end-to-end point of the module: a real-shaped log becomes a fee_events row."""
    hwm_before, hwm_after = _SCALE, _SCALE + 10**16
    # feeShares chosen so VR-FE2 reconciliation passes (10% of yield at the event share price).
    yield_assets = 1_000_000
    fee_shares = yield_assets * 1000 // 10_000 * _SCALE // hwm_after
    logs = [
        _accrual_log(100, fee_shares=fee_shares, yield_assets=yield_assets, hwm_after=hwm_after),
        _hwm_log(100, old=hwm_before, new=hwm_after),
    ]
    store = FakeStore()
    src = VaultFeeLogSource(
        transport=FakeRpc(head=200, logs=logs, hwm=hwm_after),
        store=store,
        vault_address=_VAULT,
        start_block=1,
    )
    result = await src.index_once()

    assert result.inserted == 1, "the accrual should have produced exactly one row"
    (row,) = store.rows.values()
    assert row.vault_address == _VAULT.lower()
    assert row.yield_realized_raw == yield_assets
    assert row.hwm_before_ray == hwm_before, "hwm_before comes from the PAIRED update"
    assert row.hwm_after_ray == hwm_after


@pytest.mark.asyncio
async def test_replay_is_idempotent() -> None:
    """Running twice over the same blocks must not double-count revenue."""
    hwm_after = _SCALE + 10**16
    logs = [
        _accrual_log(100, fee_shares=90, yield_assets=1000, hwm_after=hwm_after),
        _hwm_log(100, old=_SCALE, new=hwm_after),
    ]
    store = FakeStore()

    def build() -> VaultFeeLogSource:
        return VaultFeeLogSource(
            transport=FakeRpc(head=200, logs=logs, hwm=hwm_after),
            store=store,
            vault_address=_VAULT,
            start_block=1,
        )

    first = await build().index_once()
    store.cursors[("base", FEE_STREAM)] = 0  # force a full re-read
    second = await build().index_once()

    assert first.inserted == 1
    assert second.inserted == 0, "a re-read must insert nothing"
    assert len(store.rows) == 1


@pytest.mark.asyncio
async def test_foreign_logs_are_ignored() -> None:
    """A log whose topic0 we do not recognise is skipped, not misdecoded."""
    store = FakeStore()
    stray = {
        "address": _VAULT.lower(),
        "blockNumber": hex(100),
        "logIndex": "0x0",
        "transactionHash": "0x" + "0" * 64,
        "topics": ["0x" + "ab" * 32],
        "data": "0x",
    }
    src = VaultFeeLogSource(
        transport=FakeRpc(head=200, logs=[stray]),
        store=store,
        vault_address=_VAULT,
        start_block=1,
    )
    result = await src.index_once()
    assert result.logs_seen == 1
    assert result.inserted == 0
    assert not store.rows


# ─────────────────────────────────────────────────────────────────────────────
# Windowing + cursor safety
# ─────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_window_narrows_to_a_strict_provider_and_still_indexes() -> None:
    """Alchemy Free caps getLogs at 10 blocks. The source must find the accrual anyway."""
    hwm_after = _SCALE + 10**16
    logs = [
        _accrual_log(120, fee_shares=90, yield_assets=1000, hwm_after=hwm_after),
        _hwm_log(120, old=_SCALE, new=hwm_after),
    ]
    rpc = FakeRpc(head=140, logs=logs, max_span=MIN_WINDOW, hwm=hwm_after)
    store = FakeStore()
    src = VaultFeeLogSource(
        transport=rpc, store=store, vault_address=_VAULT, start_block=100
    )
    result = await src.index_once()

    assert result.inserted == 1, "narrowing must not lose the event"
    widest = max(to - frm + 1 for frm, to in rpc.log_calls if (to - frm + 1) <= MIN_WINDOW)
    assert widest <= MIN_WINDOW


@pytest.mark.asyncio
async def test_cursor_holds_when_every_window_fails() -> None:
    """⚠️ Safety. Nothing could be read, so nothing downstream may run and the cursor must hold.

    ``max_span=1`` is below the floor, so every attempt — including at ``MIN_WINDOW`` — is
    refused. The seed ``eth_call`` is the tell: if it happened, the source went on to call
    ``index()`` with an ``as_of_block`` it never actually read.
    """
    store = FakeStore()
    store.cursors[("base", FEE_STREAM)] = 500
    rpc = FakeRpc(head=9000, logs=[], max_span=1)
    src = VaultFeeLogSource(
        transport=rpc, store=store, vault_address=_VAULT, start_block=1
    )
    result = await src.index_once()

    assert result.last_processed_block == 500, "the cursor must not move past unread blocks"
    assert store.cursors[("base", FEE_STREAM)] == 500
    assert result.more_to_do is True
    assert rpc.eth_calls == 0, "a tick that read nothing must not proceed to index()"


@pytest.mark.asyncio
async def test_no_block_is_skipped_when_a_window_is_refused() -> None:
    """⚠️ The invariant that actually protects revenue: coverage is CONTIGUOUS.

    A refused window must be retried narrower from the SAME start — never abandoned by advancing
    past it. If it were skipped, every fee event in those blocks would be lost permanently and
    silently, because the cursor would sit beyond them forever.

    ``max_span=64`` refuses the opening 2000-block window, so the source is forced through the
    narrowing path and has to re-cover everything it just failed to read.
    """
    rpc = FakeRpc(head=3005, logs=[], max_span=64)
    store = FakeStore()
    store.cursors[("base", FEE_STREAM)] = 999
    src = VaultFeeLogSource(
        transport=rpc, store=store, vault_address=_VAULT, start_block=1
    )
    result = await src.index_once()

    succeeded = sorted(
        (frm, to) for frm, to in rpc.log_calls if (to - frm + 1) <= 64
    )
    assert succeeded, "expected the narrowing path to eventually succeed"

    # Walk the successful ranges: they must start at the old cursor + 1 and leave no gap up to
    # whatever the cursor now claims was processed.
    cursor_now = store.cursors[("base", FEE_STREAM)]
    reached = 999
    for frm, to in succeeded:
        if frm > reached + 1:
            raise AssertionError(f"gap: blocks {reached + 1}..{frm - 1} were never queried")
        reached = max(reached, to)
    assert reached >= cursor_now, "the cursor claims blocks that were never read"
    assert result.last_processed_block == cursor_now


@pytest.mark.asyncio
async def test_head_failure_is_a_no_op() -> None:
    """An unreachable node degrades to doing nothing — never to advancing or crashing."""

    class DeadRpc:
        async def call(self, method: str, params: list[Any]) -> Any:
            raise RuntimeError("connection refused")

    store = FakeStore()
    store.cursors[("base", FEE_STREAM)] = 42
    src = VaultFeeLogSource(transport=DeadRpc(), store=store, vault_address=_VAULT)
    result = await src.index_once()

    assert result.inserted == 0
    assert store.cursors[("base", FEE_STREAM)] == 42


@pytest.mark.asyncio
async def test_finality_margin_is_respected() -> None:
    """The last few blocks are left alone so a reorg cannot strand a retained row."""
    rpc = FakeRpc(head=1000, logs=[])
    store = FakeStore()
    src = VaultFeeLogSource(transport=rpc, store=store, vault_address=_VAULT, start_block=900)
    await src.index_once()
    assert rpc.log_calls, "expected at least one getLogs window"
    assert max(to for _, to in rpc.log_calls) == 995


@pytest.mark.asyncio
async def test_decoder_round_trips_against_the_real_codec() -> None:
    """The decode path is eth-abi's, not ours — assert the values survive it intact."""
    store = FakeStore()
    src = VaultFeeLogSource(
        transport=FakeRpc(head=1), store=store, vault_address=_VAULT
    )
    log = _accrual_log(7, fee_shares=123, yield_assets=456, hwm_after=789)
    decoded = src._decode(log, datetime(2026, 8, 18, tzinfo=UTC))

    assert isinstance(decoded, PerformanceFeeAccrued)
    values = (decoded.fee_shares, decoded.yield_assets, decoded.new_high_water_mark)
    assert values == (123, 456, 789)
    assert decoded.fee_recipient == _RECIPIENT.lower()
