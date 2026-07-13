# ruff: noqa: S101  (pytest asserts)
"""Vault chain-read client — ABI round-trip + fail-closed behaviour (chain/vault_reader.py).

Everything runs against a MOCKED JSON-RPC transport (no live vault / no live RPC):
  - encode/decode round-trips against the REAL eth-abi codec and the REAL selectors +
    types from the compiled SparkPointVault artifact;
  - the registry is view/pure-only (a state-changing selector can never be built);
  - reads fail closed (typed VaultUnavailable) when the vault is undeployed, the RPC is
    unreachable, or the call returns no data — never a fabricated value;
  - the httpx-backed transport maps HTTP/JSON-RPC/transport errors to VaultUnavailable.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from typing import Any

import httpx
import pytest
from eth_abi import decode as abi_decode
from eth_abi import encode as abi_encode

from sparkpoint_agent.chain.vault_reader import (
    HttpxJsonRpcTransport,
    VaultReader,
    VaultUnavailable,
    VaultUnavailableReason,
    load_vault_methods,
)
from sparkpoint_agent.config import AgentConfig

_VAULT = "0x00000000000000000000000000000000000000aa"
_OWNER = "0x1111111111111111111111111111111111111111"


def _word(hex_result: bytes) -> str:
    return "0x" + hex_result.hex()


class RecordingTransport:
    """A mock JsonRpcTransport that records calls and returns preset results by method+selector."""

    def __init__(self, results: dict[str, str]) -> None:
        # key: rpc method (e.g. "eth_blockNumber") OR the 10-char call selector for eth_call.
        self._results = results
        self.calls: list[tuple[str, list[Any]]] = []

    async def call(self, method: str, params: Sequence[Any]) -> str:
        self.calls.append((method, list(params)))
        if method == "eth_call":
            selector = params[0]["data"][:10]
            return self._results[selector]
        return self._results[method]


def _reader(results: dict[str, str], *, vault: str | None = _VAULT) -> VaultReader:
    return VaultReader(vault_address=vault, transport=RecordingTransport(results))


# ── ABI registry: authoritative selectors, view/pure only ────────────────────────


def test_registry_has_known_selector_and_is_view_only() -> None:
    methods = load_vault_methods()
    # Selector is the authoritative one from the compiled artifact's methodIdentifiers.
    assert methods["previewDeposit"].selector == "0xef8b30f7"
    assert methods["previewDeposit"].output_types == ("uint256",)
    # Non-custody: state-changing methods are NOT registered (cannot be encoded here).
    for mutating in ("deposit", "mint", "redeem", "withdraw", "approve", "transfer", "accrueFee"):
        assert mutating not in methods


# ── Encode/decode round-trips through the real codec ─────────────────────────────


async def test_preview_deposit_round_trip() -> None:
    method = load_vault_methods()["previewDeposit"]
    transport = RecordingTransport({method.selector: _word(abi_encode(["uint256"], [98_765_432]))})
    reader = VaultReader(vault_address=_VAULT, transport=transport)

    out = await reader.preview_deposit(100_000_000)
    assert out == 98_765_432

    # The outbound calldata is selector + the abi-encoded argument (decodes back exactly).
    rpc_method, params = transport.calls[0]
    assert rpc_method == "eth_call"
    assert params[0]["to"] == _VAULT
    calldata = bytes.fromhex(params[0]["data"][2:])
    assert "0x" + calldata[:4].hex() == method.selector
    (decoded_arg,) = abi_decode(["uint256"], calldata[4:])
    assert decoded_arg == 100_000_000


async def test_uint16_bool_and_address_decoding() -> None:
    m = load_vault_methods()
    results = {
        m["performanceFeeBps"].selector: _word(abi_encode(["uint16"], [1000])),
        m["paused"].selector: _word(abi_encode(["bool"], [True])),
        m["feeRecipient"].selector: _word(abi_encode(["address"], [_OWNER])),
        m["highWaterMark"].selector: _word(abi_encode(["uint256"], [10_423_000])),
    }
    reader = _reader(results)
    assert await reader.performance_fee_bps() == 1000
    assert await reader.paused() is True
    assert await reader.fee_recipient() == _OWNER  # lowercased 0x address
    assert await reader.high_water_mark() == 10_423_000


async def test_address_argument_is_encoded() -> None:
    m = load_vault_methods()
    transport = RecordingTransport(
        {m["balanceOf"].selector: _word(abi_encode(["uint256"], [42]))}
    )
    reader = VaultReader(vault_address=_VAULT, transport=transport)
    assert await reader.balance_of(_OWNER) == 42
    calldata = bytes.fromhex(transport.calls[0][1][0]["data"][2:])
    (decoded_addr,) = abi_decode(["address"], calldata[4:])
    assert decoded_addr == _OWNER


async def test_block_number_decodes_hex_quantity() -> None:
    reader = _reader({"eth_blockNumber": "0x1a2b3c"})
    assert await reader.block_number() == 0x1A2B3C


# ── Fail-closed behaviour (never a fabricated value) ─────────────────────────────


async def test_undeployed_vault_fails_closed_without_calling_rpc() -> None:
    transport = RecordingTransport({})
    reader = VaultReader(vault_address=None, transport=transport)
    with pytest.raises(VaultUnavailable) as exc:
        await reader.preview_deposit(1)
    assert exc.value.reason is VaultUnavailableReason.NOT_DEPLOYED
    assert transport.calls == []  # never even reached the RPC


async def test_empty_eth_call_result_is_not_deployed() -> None:
    m = load_vault_methods()
    reader = _reader({m["totalAssets"].selector: "0x"})
    with pytest.raises(VaultUnavailable) as exc:
        await reader.total_assets()
    assert exc.value.reason is VaultUnavailableReason.NOT_DEPLOYED


async def test_transport_error_propagates_as_unavailable() -> None:
    class DownTransport:
        async def call(self, method: str, params: Sequence[Any]) -> str:
            raise VaultUnavailable(VaultUnavailableReason.RPC_UNREACHABLE, "rpc down")

    reader = VaultReader(vault_address=_VAULT, transport=DownTransport())
    with pytest.raises(VaultUnavailable) as exc:
        await reader.total_supply()
    assert exc.value.reason is VaultUnavailableReason.RPC_UNREACHABLE


async def test_undecodable_result_fails_closed() -> None:
    m = load_vault_methods()
    reader = _reader({m["totalAssets"].selector: "0x1234"})  # too short for a uint256 word
    with pytest.raises(VaultUnavailable) as exc:
        await reader.total_assets()
    assert exc.value.reason is VaultUnavailableReason.RPC_UNREACHABLE


# ── from_config wiring ───────────────────────────────────────────────────────────


async def test_from_config_uses_configured_transport_and_reads() -> None:
    m = load_vault_methods()
    cfg = AgentConfig.from_env(
        {"SPARKPOINT_VAULT_ADDRESS": _VAULT, "SIM_FORK_RPC_URL": "http://fork.local:8545"}
    )
    transport = RecordingTransport({m["asset"].selector: _word(abi_encode(["address"], [_OWNER]))})
    reader = VaultReader.from_config(cfg, transport=transport)
    assert await reader.asset() == _OWNER


def test_from_config_without_rpc_fails_closed() -> None:
    cfg = AgentConfig.from_env({"SPARKPOINT_VAULT_ADDRESS": _VAULT})  # no RPC url anywhere
    with pytest.raises(VaultUnavailable) as exc:
        VaultReader.from_config(cfg)
    assert exc.value.reason is VaultUnavailableReason.RPC_UNREACHABLE


# ── httpx-backed JSON-RPC transport (mocked HTTP, no network) ─────────────────────


def _mock_client(handler: Any) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


async def test_httpx_transport_success_and_eth_call_shape() -> None:
    method = load_vault_methods()["totalAssets"]
    captured: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["payload"] = json.loads(request.content)
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "result": _word(abi_encode(["uint256"], [777]))}
        )

    async with _mock_client(handler) as client:
        transport = HttpxJsonRpcTransport("http://rpc.local", client=client)
        reader = VaultReader(vault_address=_VAULT, transport=transport)
        assert await reader.total_assets() == 777

    assert captured["payload"]["method"] == "eth_call"
    assert captured["payload"]["params"][0]["data"][:10] == method.selector


async def test_httpx_transport_jsonrpc_error_is_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32000, "message": "boom"}}
        )

    async with _mock_client(handler) as client:
        transport = HttpxJsonRpcTransport("http://rpc.local", client=client)
        reader = VaultReader(vault_address=_VAULT, transport=transport)
        with pytest.raises(VaultUnavailable) as exc:
            await reader.total_assets()
    assert exc.value.reason is VaultUnavailableReason.RPC_UNREACHABLE


async def test_httpx_transport_connect_error_is_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    async with _mock_client(handler) as client:
        transport = HttpxJsonRpcTransport("http://rpc.local", client=client)
        with pytest.raises(VaultUnavailable) as exc:
            await transport.call("eth_blockNumber", [])
    assert exc.value.reason is VaultUnavailableReason.RPC_UNREACHABLE


async def test_httpx_transport_non_200_is_unavailable() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, text="upstream down")

    async with _mock_client(handler) as client:
        transport = HttpxJsonRpcTransport("http://rpc.local", client=client)
        with pytest.raises(VaultUnavailable) as exc:
            await transport.call("eth_blockNumber", [])
    assert exc.value.reason is VaultUnavailableReason.RPC_UNREACHABLE
