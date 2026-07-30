# ruff: noqa: S101
"""ERC-4337 bundler client (feature 022) — submit surfaces rejections verbatim; the receipt read is
best-effort.

Non-custody: submit/read only, holds no key. A bundler rejection (e.g. ERC-7562) is a
``BundlerError``
with the verbatim message (honest, never a fabricated success); a not-yet-bundled receipt is None.
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.execution import bundler

_EP = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
_OP: dict[str, Any] = {"sender": "0xacc", "nonce": "0x0", "callData": "0x", "signature": "0x01"}


@pytest.mark.asyncio
async def test_send_user_op_returns_hash_on_accept(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake(url: str, method: str, params: list[Any]) -> tuple[Any, dict | None]:
        assert method == "eth_sendUserOperation"
        return "0xdeadbeef", None

    monkeypatch.setattr(bundler, "_bundler_rpc", _fake)
    assert await bundler.send_user_op("http://b", _OP, _EP) == "0xdeadbeef"


@pytest.mark.asyncio
async def test_send_user_op_strips_null_v07_fields(monkeypatch: pytest.MonkeyPatch) -> None:
    # A client op carries factory/factoryData/paymaster/paymasterData as null (v0.7 "absent"). The
    # client signed the userOpHash with those slots absent (initCode/paymasterAndData = 0x); sending
    # them as JSON null makes the bundler hash a DIFFERENT op → "Invalid account signature". They
    # MUST
    # be omitted on the wire (proven live on Base Sepolia). A non-null factory/paymaster is kept.
    sent: dict[str, Any] = {}

    async def _fake(url: str, method: str, params: list[Any]) -> tuple[Any, dict | None]:
        sent.update(params[0])
        return "0xok", None

    monkeypatch.setattr(bundler, "_bundler_rpc", _fake)
    op = {
        "sender": "0xacc",
        "nonce": "0x0",
        "factory": None,
        "factoryData": None,
        "callData": "0x",
        "paymaster": None,
        "paymasterData": None,
        "signature": "0x01",
    }
    assert await bundler.send_user_op("http://b", op, _EP) == "0xok"
    for null_key in ("factory", "factoryData", "paymaster", "paymasterData"):
        assert null_key not in sent
    assert sent["sender"] == "0xacc" and sent["signature"] == "0x01"


@pytest.mark.asyncio
async def test_send_user_op_raises_verbatim_on_rejection(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake(url: str, method: str, params: list[Any]) -> tuple[Any, dict | None]:
        return None, {"code": -32602, "message": "AA24 signature error"}

    monkeypatch.setattr(bundler, "_bundler_rpc", _fake)
    with pytest.raises(bundler.BundlerError) as ei:
        await bundler.send_user_op("http://b", _OP, _EP)
    assert ei.value.message == "AA24 signature error"
    assert ei.value.code == -32602


@pytest.mark.asyncio
async def test_get_user_op_receipt_returns_none_when_unbundled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _fake(url: str, method: str, params: list[Any]) -> tuple[Any, dict | None]:
        return None, None  # not yet bundled → result is null

    monkeypatch.setattr(bundler, "_bundler_rpc", _fake)
    assert await bundler.get_user_op_receipt("http://b", "0xhash") is None


@pytest.mark.asyncio
async def test_get_user_op_receipt_returns_receipt(monkeypatch: pytest.MonkeyPatch) -> None:
    receipt = {"success": True, "receipt": {"transactionHash": "0xtx", "blockNumber": "0x1"}}

    async def _fake(url: str, method: str, params: list[Any]) -> tuple[Any, dict | None]:
        return receipt, None

    monkeypatch.setattr(bundler, "_bundler_rpc", _fake)
    assert await bundler.get_user_op_receipt("http://b", "0xhash") == receipt
