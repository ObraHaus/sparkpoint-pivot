# ruff: noqa: S101, S105, S106
"""T- the SRK payment-verifier receipt matrix (feature 012). Keyless; the RPC is a FAKE.

Proves the security-critical contract: a full-price SRK Transfer FROM the buyer TO the treasury
verifies; a different sender, under-price, reverted, wrong-token, or wrong-recipient are refused;
an unmined or under-confirmation tx is Pending (retryable); an RPC outage propagates (never a false
"invalid"); the amount comparison is in base units. NON-CUSTODY: read-only, keyless (N1).
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.chain.payment_verifier import (
    ERC20_TRANSFER_TOPIC0,
    PaymentInvalid,
    PaymentVerifier,
    Pending,
    VerifiedPayment,
)

_SRK = "0x1111111111111111111111111111111111111111"
_TREASURY = "0x2222222222222222222222222222222222222222"
_BUYER = "0x3333333333333333333333333333333333333333"
_OTHER = "0x4444444444444444444444444444444444444444"
_OTHER_TOKEN = "0x9999999999999999999999999999999999999999"
_PRICE = 500 * 10**18


def _topic_addr(addr: str) -> str:
    return "0x" + addr[2:].rjust(64, "0")


def _uint(value: int) -> str:
    return "0x" + format(value, "064x")


def _transfer_log(token: str, frm: str, to: str, value: int) -> dict[str, Any]:
    return {
        "address": token,
        "topics": [ERC20_TRANSFER_TOPIC0, _topic_addr(frm), _topic_addr(to)],
        "data": _uint(value),
    }


def _receipt(*, status: str = "0x1", block: int = 90, logs: list[dict[str, Any]]) -> dict[str, Any]:
    return {"status": status, "blockNumber": hex(block), "logs": logs}


class _FakeRpc:
    def __init__(self, receipt: Any, *, head: int = 100, raise_on: str | None = None) -> None:
        self._receipt = receipt
        self._head = head
        self._raise_on = raise_on

    async def call(self, method: str, params: list[Any]) -> Any:
        if method == self._raise_on:
            raise RuntimeError("rpc down")
        if method == "eth_getTransactionReceipt":
            return self._receipt
        if method == "eth_blockNumber":
            return hex(self._head)
        raise AssertionError(f"unexpected method {method}")


def _verifier(rpc: _FakeRpc, *, min_conf: int = 3) -> PaymentVerifier:
    return PaymentVerifier(
        rpc=rpc,  # type: ignore[arg-type]
        srk_address=_SRK,
        treasury=_TREASURY,
        price_raw=_PRICE,
        min_confirmations=min_conf,
    )


async def test_valid_full_price_from_buyer_verifies() -> None:
    rpc = _FakeRpc(_receipt(logs=[_transfer_log(_SRK, _BUYER, _TREASURY, _PRICE)]))
    out = await _verifier(rpc).verify(tx_hash="0xABC", buyer=_BUYER.upper())
    assert isinstance(out, VerifiedPayment)
    assert out.buyer == _BUYER and out.token == _SRK and out.amount_raw == _PRICE
    assert out.tx_hash == "0xabc" and out.block_number == 90


async def test_over_price_verifies_with_actual_amount() -> None:
    rpc = _FakeRpc(_receipt(logs=[_transfer_log(_SRK, _BUYER, _TREASURY, _PRICE * 2)]))
    out = await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)
    assert isinstance(out, VerifiedPayment) and out.amount_raw == _PRICE * 2


async def test_different_sender_is_refused() -> None:
    rpc = _FakeRpc(_receipt(logs=[_transfer_log(_SRK, _OTHER, _TREASURY, _PRICE)]))
    with pytest.raises(PaymentInvalid, match="sender is not the buyer"):
        await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)


async def test_under_price_is_refused() -> None:
    rpc = _FakeRpc(_receipt(logs=[_transfer_log(_SRK, _BUYER, _TREASURY, _PRICE - 1)]))
    with pytest.raises(PaymentInvalid, match="below the Premium price"):
        await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)


async def test_reverted_is_refused() -> None:
    rpc = _FakeRpc(_receipt(status="0x0", logs=[_transfer_log(_SRK, _BUYER, _TREASURY, _PRICE)]))
    with pytest.raises(PaymentInvalid, match="reverted"):
        await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)


async def test_wrong_token_is_refused() -> None:
    rpc = _FakeRpc(_receipt(logs=[_transfer_log(_OTHER_TOKEN, _BUYER, _TREASURY, _PRICE)]))
    with pytest.raises(PaymentInvalid, match="no SRK transfer"):
        await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)


async def test_wrong_recipient_is_refused() -> None:
    rpc = _FakeRpc(_receipt(logs=[_transfer_log(_SRK, _BUYER, _OTHER, _PRICE)]))
    with pytest.raises(PaymentInvalid, match="no SRK transfer"):
        await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)


async def test_unmined_is_pending() -> None:
    out = await _verifier(_FakeRpc(None)).verify(tx_hash="0xabc", buyer=_BUYER)
    assert isinstance(out, Pending) and "not yet mined" in out.reason


async def test_under_confirmation_is_pending() -> None:
    # block 99, head 100 => 1 confirmation < 3
    logs = [_transfer_log(_SRK, _BUYER, _TREASURY, _PRICE)]
    rpc = _FakeRpc(_receipt(block=99, logs=logs), head=100)
    out = await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)
    assert isinstance(out, Pending) and "awaiting confirmations" in out.reason


async def test_rpc_outage_propagates() -> None:
    rpc = _FakeRpc(None, raise_on="eth_getTransactionReceipt")
    with pytest.raises(RuntimeError, match="rpc down"):
        await _verifier(rpc).verify(tx_hash="0xabc", buyer=_BUYER)
