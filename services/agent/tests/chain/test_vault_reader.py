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

from sparkpoint_agent.chain.vault_factory import VaultFactoryChain
from sparkpoint_agent.chain.vault_reader import (
    _ERC4626_CORE_METHODS,
    _REQUIRED_METHODS,
    _SPARKPOINT_EXTRA_METHODS,
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


# ── T027: the ERC-4626 reader method SPLIT (010 data-model §2) ────────────────────


def test_required_methods_split_core_plus_extras() -> None:
    # The SparkPoint superset is EXACTLY core | extras (back-compat drift guard, unchanged posture).
    assert _REQUIRED_METHODS == _ERC4626_CORE_METHODS | _SPARKPOINT_EXTRA_METHODS
    # core and extras are DISJOINT namespaces.
    assert _ERC4626_CORE_METHODS.isdisjoint(_SPARKPOINT_EXTRA_METHODS)
    # The core is the standard EIP-4626 (+ERC-20) surface a generic Morpho vault must expose.
    core_sample = {"asset", "totalAssets", "decimals", "convertToAssets", "maxWithdraw"}
    assert core_sample <= _ERC4626_CORE_METHODS
    # The extras are the SparkPoint-only fee/pause/HWM views — NOT part of a generic 4626 vault.
    assert _SPARKPOINT_EXTRA_METHODS == {
        "paused",
        "performanceFeeBps",
        "highWaterMark",
        "feeRecipient",
    }


def test_erc4626_mode_requires_core_only_fee_pause_optional() -> None:
    # abiKind='erc4626' validates ONLY the core: a generic vault missing paused/fee/HWM is still
    # readable (fail-OPEN for extras) — those SparkPoint views are simply absent for external ones.
    for extra in _SPARKPOINT_EXTRA_METHODS:
        assert extra not in _ERC4626_CORE_METHODS
    core = load_vault_methods("erc4626")
    superset = load_vault_methods("sparkpoint")
    # Both load off the SparkPoint artifact (which exposes the superset), so the returned registry
    # is identical; the modes differ only in which method set the drift guard requires.
    assert _ERC4626_CORE_METHODS <= core.keys()
    assert _REQUIRED_METHODS <= superset.keys()
    # Still view/pure-only in BOTH modes — no state-changing selector for ANY vault (non-custody).
    for mutating in ("deposit", "redeem", "withdraw", "approve"):
        assert mutating not in core
        assert mutating not in superset


def test_unknown_abi_kind_rejected() -> None:
    with pytest.raises(ValueError):
        load_vault_methods("erc777")


async def test_wrapper_read_with_sparkpoint_abikind_round_trip() -> None:
    # A SparkPointMorphoVault WRAPPER registers abiKind='sparkpoint' (it exposes the full superset),
    # so it reads through the SAME split reader with no ABI change — its fee/pause/HWM + 4626 views
    # all round-trip exactly as the launch vault's do.
    m = load_vault_methods("sparkpoint")
    results = {
        m["performanceFeeBps"].selector: _word(abi_encode(["uint16"], [1000])),
        m["paused"].selector: _word(abi_encode(["bool"], [False])),
        m["asset"].selector: _word(abi_encode(["address"], [_OWNER])),
        m["totalAssets"].selector: _word(abi_encode(["uint256"], [7_000_000])),
    }
    wrapper = VaultReader(
        vault_address=_VAULT, transport=RecordingTransport(results), abi_kind="sparkpoint"
    )
    assert await wrapper.performance_fee_bps() == 1000
    assert await wrapper.paused() is False
    assert await wrapper.asset() == _OWNER
    assert await wrapper.total_assets() == 7_000_000


# ── T027: wrapper provenance — render ONLY when factory.isSparkPointVault attests (fail-closed) ──


def _factory(results: dict[str, str], *, factory: str | None = _VAULT) -> VaultFactoryChain:
    return VaultFactoryChain(factory_address=factory, transport=RecordingTransport(results))


async def test_wrapper_provenance_attested_renders() -> None:
    # factory.isSparkPointVault(wrapper) == true ⇒ the wrapper row is trusted and rendered.
    from sparkpoint_agent.chain.vault_factory import _FACTORY_ARTIFACT, _load_registry

    sel = _load_registry(_FACTORY_ARTIFACT)["isSparkPointVault"].selector
    factory = _factory({sel: _word(abi_encode(["bool"], [True]))})
    assert await factory.is_sparkpoint_vault(_OWNER) is True


async def test_wrapper_provenance_unverified_is_refused() -> None:
    # An address the factory does NOT attest ⇒ isSparkPointVault false ⇒ refused (not rendered).
    from sparkpoint_agent.chain.vault_factory import _FACTORY_ARTIFACT, _load_registry

    sel = _load_registry(_FACTORY_ARTIFACT)["isSparkPointVault"].selector
    factory = _factory({sel: _word(abi_encode(["bool"], [False]))})
    assert await factory.is_sparkpoint_vault(_OWNER) is False


async def test_wrapper_provenance_no_factory_fails_closed() -> None:
    # No factory on this chain ⇒ provenance cannot be attested ⇒ fail-closed VaultUnavailable
    # (never a fabricated "trusted" verdict).
    factory = _factory({}, factory=None)
    with pytest.raises(VaultUnavailable) as exc:
        await factory.is_sparkpoint_vault(_OWNER)
    assert exc.value.reason is VaultUnavailableReason.NOT_DEPLOYED


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
    # 8453 now has Base's own public default; 4663 deliberately has no public fallback, so it is
    # the chain that still proves the fail-closed construction path.
    cfg = AgentConfig.from_env(
        {"CHAIN_ID": "4663", "SPARKPOINT_VAULT_ADDRESS": _VAULT}
    )  # no RPC url anywhere
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
