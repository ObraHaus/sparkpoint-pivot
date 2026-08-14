# ruff: noqa: S101
"""Tests for the broker ledger (feature 044).

The theme: **a log is a candidate, the chain is the verdict.** Most of these assert that a stale or
misleading log does not become a wrong answer, because that is the failure this module exists to
prevent — and because every one of those failures is silent. A holder dropped from an allocation
does not raise; they just get nothing.
"""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path
from typing import Any

import pytest

from sparkpoint_agent.chain.broker_ledger import (
    SEL_ACTIVATED_AT,
    SEL_OWNER_OF,
    SEL_WEIGHT_OF,
    TOPIC_ACTIVATED,
    TOPIC_TRANSFER,
    ActivatedBroker,
    BrokerLedger,
    from_block_from_env,
)

BROKER = "0x15D269B1f2c9C4b2f8e0a1c3D5e7F9a1B3c5D7f2"
REGISTRY = "0xf081167b0000000000000000000000000000a88E"
ALICE = "0xAaAaAaAa00000000000000000000000000000001"
BOB = "0xBbBbBbBb00000000000000000000000000000002"

#: Resolved from PATH once. `None` when foundry is absent, which SKIPS rather than fails.
CAST = shutil.which("cast") or "cast"


def _word(v: int) -> str:
    return f"{v:064x}"


def _addr_topic(a: str) -> str:
    return "0x" + _word(int(a, 16))


def _transfer_log(to: str, token_id: int) -> dict[str, Any]:
    return {
        "topics": [TOPIC_TRANSFER, _addr_topic(ALICE), _addr_topic(to), "0x" + _word(token_id)]
    }


def _activated_log(holder: str, token_id: int) -> dict[str, Any]:
    return {"topics": [TOPIC_ACTIVATED, _addr_topic(holder), "0x" + _word(token_id)]}


class FakeRpc:
    """Scriptable RPC. `owners`/`activated`/`weights` are the CHAIN — the authority."""

    def __init__(
        self,
        *,
        head: int = 1_000,
        transfer_logs: list[dict[str, Any]] | None = None,
        activated_logs: list[dict[str, Any]] | None = None,
        owners: dict[int, str] | None = None,
        activated: dict[int, int] | None = None,
        weights: dict[int, int] | None = None,
        fail_logs: bool = False,
        fail_head: bool = False,
    ) -> None:
        self.head = head
        self.transfer_logs = transfer_logs or []
        self.activated_logs = activated_logs or []
        self.owners = owners or {}
        self.activated = activated or {}
        self.weights = weights or {}
        self.fail_logs = fail_logs
        self.fail_head = fail_head
        self.log_calls: list[dict[str, Any]] = []

    async def call(self, method: str, params: list[Any]) -> Any:
        if method == "eth_blockNumber":
            if self.fail_head:
                raise RuntimeError("node down")
            return hex(self.head)

        if method == "eth_getLogs":
            if self.fail_logs:
                raise RuntimeError("log range rejected")
            spec = params[0]
            self.log_calls.append(spec)
            topics = spec.get("topics") or []
            if topics and topics[0] == TOPIC_TRANSFER:
                wanted = topics[2] if len(topics) > 2 else None
                return [
                    lg
                    for lg in self.transfer_logs
                    if wanted is None or lg["topics"][2].lower() == wanted.lower()
                ]
            return list(self.activated_logs)

        if method == "eth_call":
            data = params[0]["data"]
            selector, arg = data[:10], int(data[10:], 16)
            if selector == SEL_OWNER_OF:
                owner = self.owners.get(arg)
                if owner is None:
                    raise RuntimeError("TokenDoesNotExist")
                return "0x" + _word(int(owner, 16))
            if selector == SEL_ACTIVATED_AT:
                return "0x" + _word(self.activated.get(arg, 0))
            if selector == SEL_WEIGHT_OF:
                return "0x" + _word(self.weights.get(arg, 0))
        raise AssertionError(f"unexpected call {method} {params}")


def _ledger(rpc: FakeRpc, **kw: Any) -> BrokerLedger:
    return BrokerLedger(
        rpc=rpc, broker=BROKER, registries=kw.pop("registries", [REGISTRY]), from_block=0, **kw
    )


# ── the selectors are computed, not trusted ────────────────────────────────────────────────────


def test_selectors_match_the_compiled_abi() -> None:
    """Recompute every selector from the contract ABI.

    ⚠️ Two of these were WRONG when first hand-written, and nothing failed: a bad selector makes
    `eth_call` return empty, which degrades to "weight 0", which silently drops that holder from
    the split. There is no error to notice — so the constants are derived here instead.
    """
    root = Path(__file__).resolve().parents[4] / "contracts"
    if not root.exists():  # pragma: no cover - contracts absent in some CI shards
        pytest.skip("contracts not checked out")

    def selector(sig: str) -> str:
        out = subprocess.run(  # noqa: S603 - fixed argv, no shell, developer tool only
            [CAST, "sig", sig], capture_output=True, text=True, cwd=root, timeout=60
        )
        if out.returncode != 0:  # pragma: no cover - foundry not installed
            pytest.skip("cast unavailable")
        return out.stdout.strip()

    assert SEL_OWNER_OF == selector("ownerOf(uint256)")
    assert SEL_ACTIVATED_AT == selector("activatedAt(uint256)")
    assert SEL_WEIGHT_OF == selector("weightOf(uint256)")


def test_event_topics_match_the_compiled_abi() -> None:
    root = Path(__file__).resolve().parents[4] / "contracts"
    if not root.exists():  # pragma: no cover
        pytest.skip("contracts not checked out")

    def topic(sig: str) -> str:
        out = subprocess.run(  # noqa: S603 - fixed argv, no shell, developer tool only
            [CAST, "keccak", sig], capture_output=True, text=True, cwd=root, timeout=60
        )
        if out.returncode != 0:  # pragma: no cover
            pytest.skip("cast unavailable")
        return out.stdout.strip()

    assert TOPIC_TRANSFER == topic("Transfer(address,address,uint256)")
    assert TOPIC_ACTIVATED == topic("Activated(address,uint256,uint8,uint256,uint32)")


# ── question 1: what does a wallet hold ────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_token_that_arrived_and_is_still_held_is_returned() -> None:
    rpc = FakeRpc(transfer_logs=[_transfer_log(BOB, 7)], owners={7: BOB})
    assert await _ledger(rpc).tokens_owned_by(BOB) == [7]


@pytest.mark.asyncio
async def test_a_token_that_was_received_then_sold_is_NOT_returned() -> None:
    """The inbound Transfer log is permanent; ownership is not.

    This is the whole reason live reads exist. The log says Bob received #7 and that never stops
    being true, so a log-only implementation shows a broker Bob no longer owns.
    """
    rpc = FakeRpc(transfer_logs=[_transfer_log(BOB, 7)], owners={7: ALICE})
    assert await _ledger(rpc).tokens_owned_by(BOB) == []


@pytest.mark.asyncio
async def test_an_unreadable_chain_is_None_and_never_an_empty_list() -> None:
    """"I could not tell you" must not render as "you own nothing"."""
    assert await _ledger(FakeRpc(fail_head=True)).tokens_owned_by(BOB) is None
    assert await _ledger(FakeRpc(fail_logs=True)).tokens_owned_by(BOB) is None


@pytest.mark.asyncio
async def test_results_are_deduped_and_sorted() -> None:
    rpc = FakeRpc(
        transfer_logs=[_transfer_log(BOB, 9), _transfer_log(BOB, 2), _transfer_log(BOB, 9)],
        owners={9: BOB, 2: BOB},
    )
    assert await _ledger(rpc).tokens_owned_by(BOB) == [2, 9]


@pytest.mark.asyncio
async def test_a_non_erc721_transfer_log_is_ignored() -> None:
    """An ERC-20 `Transfer` has 3 topics, not 4 — its `value` is data, not an indexed tokenId."""
    rpc = FakeRpc(
        transfer_logs=[{"topics": [TOPIC_TRANSFER, _addr_topic(ALICE), _addr_topic(BOB)]}],
        owners={},
    )
    assert await _ledger(rpc).tokens_owned_by(BOB) == []


@pytest.mark.asyncio
async def test_a_malformed_wallet_is_refused_rather_than_scanned() -> None:
    assert await _ledger(FakeRpc()).tokens_owned_by("not-an-address") is None


# ── question 2: the allocation input ───────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_activated_brokers_returns_holder_and_weight() -> None:
    rpc = FakeRpc(
        activated_logs=[_activated_log(ALICE, 1), _activated_log(BOB, 2)],
        owners={1: ALICE, 2: BOB},
        activated={1: 111, 2: 222},
        weights={1: 10_000, 2: 33_000},
    )
    assert await _ledger(rpc).activated_brokers() == [
        ActivatedBroker(token_id=1, holder=ALICE.lower(), weight_bps=10_000),
        ActivatedBroker(token_id=2, holder=BOB.lower(), weight_bps=33_000),
    ]


@pytest.mark.asyncio
async def test_a_broker_activated_then_SOLD_is_excluded() -> None:
    """The `Activated` log survives the sale; the activation does not.

    Including this broker would allocate real money against a weight the chain says is zero.
    """
    rpc = FakeRpc(
        activated_logs=[_activated_log(ALICE, 1)],
        owners={1: BOB},  # sold to Bob, which cleared it
        activated={1: 0},
        weights={1: 0},
    )
    assert await _ledger(rpc).activated_brokers() == []


@pytest.mark.asyncio
async def test_a_partial_log_scan_refuses_rather_than_returning_a_short_list() -> None:
    """A short allocation list is not a degraded answer, it is a wrong one.

    Every holder missing from it silently receives nothing, and the published root makes that
    permanent. Refusing is the only safe direction.
    """
    rpc = FakeRpc(fail_logs=True)
    assert await _ledger(rpc).activated_brokers() is None


@pytest.mark.asyncio
async def test_activations_are_unioned_across_every_registry_ever_wired() -> None:
    """Re-pointing `setActivator` orphans the old registry's records with no on-chain recovery.

    A holder who paid to activate under the previous registry must keep counting, so the scan
    reads all of them and takes the first non-zero weight.
    """
    old = "0x1111111111111111111111111111111111111111"
    rpc = FakeRpc(
        activated_logs=[_activated_log(ALICE, 5)],
        owners={5: ALICE},
        activated={5: 99},
        weights={5: 20_000},
    )
    got = await _ledger(rpc, registries=[REGISTRY, old]).activated_brokers()
    assert got == [ActivatedBroker(token_id=5, holder=ALICE.lower(), weight_bps=20_000)]


@pytest.mark.asyncio
async def test_a_burned_token_is_skipped_not_crashed() -> None:
    rpc = FakeRpc(
        activated_logs=[_activated_log(ALICE, 3)], owners={}, activated={3: 1}, weights={3: 10_000}
    )
    assert await _ledger(rpc).activated_brokers() == []


@pytest.mark.asyncio
async def test_the_holder_is_lowercased_so_one_wallet_is_never_two_leaves() -> None:
    """Grouping by a mixed-case string splits one person's allocation across two leaves.

    Both leaves are then wrong: neither matches the amount the holder is told they are owed, and
    the claim proves against neither.
    """
    rpc = FakeRpc(
        activated_logs=[_activated_log(ALICE, 1)],
        owners={1: ALICE},
        activated={1: 5},
        weights={1: 10_000},
    )
    got = await _ledger(rpc).activated_brokers()
    assert got is not None and got[0].holder == got[0].holder.lower()


# ── scanning bounds ────────────────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_the_scan_is_chunked_rather_than_one_unbounded_request() -> None:
    rpc = FakeRpc(head=12_000, owners={}, transfer_logs=[])
    await _ledger(rpc).tokens_owned_by(BOB)
    assert len(rpc.log_calls) == 3
    assert rpc.log_calls[0]["fromBlock"] == hex(0)
    # Contiguous, no gap: a skipped block is a dropped holder.
    assert int(rpc.log_calls[1]["fromBlock"], 16) == int(rpc.log_calls[0]["toBlock"], 16) + 1
    assert int(rpc.log_calls[-1]["toBlock"], 16) == 12_000


@pytest.mark.asyncio
async def test_a_scan_that_would_run_forever_refuses() -> None:
    """`from_block` left at 0 on a 100M-block chain is a config error, not a slow path."""
    rpc = FakeRpc(head=100_000_000)
    assert await _ledger(rpc).tokens_owned_by(BOB) is None


def test_from_block_env_falls_back_on_junk() -> None:
    assert from_block_from_env(default=42) == 42
