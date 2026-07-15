# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""Pre-trade Simulator unit tests (sim/simulator.py) — revert detection + gas-estimate shape.

Everything runs against a MOCKED JSON-RPC transport (``httpx.MockTransport`` injected into the
simulator's own ``httpx.AsyncClient``) — no bundler RPC, no Anvil fork, no live chain:

  - ``BundlerGasEstimator`` (the ERC-4337 UserOp path) reports ``willRevert=True`` with the decoded
    reason when ``eth_estimateUserOperationGas`` answers with a JSON-RPC error (EntryPoint
    simulateHandleOp rejects / the op would revert) — it must NEVER hardcode ``willRevert=False``;
  - on success it sums the three UserOp gas legs into a single 0x-hex estimate of the right shape;
  - a *transport* failure (backend down) fails CLOSED (``SimulatorUnavailableError``), which is a
    different animal from a revert and must not be mistaken for a clean zero-cost success;
  - misconfig (no bundler RPC) / missing user_op+entry_point are surfaced as typed errors;
  - the PRIMARY ``AnvilForkSimulator`` likewise flips ``willRevert`` from an ``eth_call`` revert and
    skips the gas estimate for a reverting call.

These are the FIRST tests over sim/ (it previously had zero), closing the willRevert stub gap.
"""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from eth_abi import encode as abi_encode

from sparkpoint_agent.policy.enums import ActionType
from sparkpoint_agent.sim.simulator import (
    AnvilForkSimulator,
    BundlerGasEstimator,
    PackedUserOp,
    SimulationRequest,
    SimulationResult,
    SimulatorUnavailableError,
)

_ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"  # ERC-4337 v0.7 EntryPoint
_SENDER = "0x00000000000000000000000000000000000000aa"


# ─────────────────────────────────────────────────────────────────────────────
# Mock JSON-RPC transport
# ─────────────────────────────────────────────────────────────────────────────


def _error_string_payload(reason: str) -> str:
    """A canonical Solidity ``Error(string)`` revert payload (selector + abi-encoded string)."""
    return "0x08c379a0" + abi_encode(["string"], [reason]).hex()


class FakeJsonRpc:
    """An ``httpx.MockTransport`` handler that answers JSON-RPC 2.0 POSTs from a method→outcome map.

    An outcome is one of:
      - ``{"result": <any>}``     → a normal JSON-RPC success reply;
      - ``{"error": {...}}``      → a JSON-RPC error object (backend ANSWERED, e.g. a revert);
      - an ``Exception`` instance → raised as a transport failure (backend DOWN / fail-closed).
    """

    def __init__(self, outcomes: dict[str, Any]) -> None:
        self._outcomes = outcomes
        self.methods: list[str] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        payload = json.loads(request.content)
        method = payload["method"]
        self.methods.append(method)
        outcome = self._outcomes.get(method)
        if isinstance(outcome, Exception):
            raise outcome
        body: dict[str, Any] = {"jsonrpc": "2.0", "id": payload.get("id")}
        if isinstance(outcome, dict) and "error" in outcome:
            body["error"] = outcome["error"]
        elif isinstance(outcome, dict) and "result" in outcome:
            body["result"] = outcome["result"]
        else:
            body["result"] = outcome
        return httpx.Response(200, json=body)


def _client(handler: FakeJsonRpc) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def _userop_request(*, min_out: int | None = None) -> SimulationRequest:
    return SimulationRequest(
        chain_id=8453,
        sender=_SENDER,
        op_type="userop",
        action=ActionType.AERODROME_SWAP,
        min_out=min_out,
        user_op=PackedUserOp(fields={"sender": _SENDER, "nonce": "0x0", "callData": "0x"}),
        entry_point=_ENTRY_POINT,
    )


# ─────────────────────────────────────────────────────────────────────────────
# BundlerGasEstimator — success / gas-estimate shape
# ─────────────────────────────────────────────────────────────────────────────


async def test_bundler_estimate_success_sums_gas_legs() -> None:
    """A successful estimate sums the three UserOp gas legs into one 0x-hex estimate; no revert."""
    handler = FakeJsonRpc(
        {
            "eth_blockNumber": "0x100",
            "eth_estimateUserOperationGas": {
                "result": {
                    "preVerificationGas": "0x1000",  # 4096
                    "verificationGasLimit": "0x2000",  # 8192
                    "callGasLimit": "0x4000",  # 16384
                    # extra keys the summation ignores (paymaster leg) — must not break shape.
                    "paymasterVerificationGasLimit": "0x100",
                }
            },
        }
    )
    async with BundlerGasEstimator("http://bundler.invalid", client=_client(handler)) as estimator:
        result = await estimator.estimate(_userop_request(min_out=990_000_000))

    assert isinstance(result, SimulationResult)
    assert result.provider == "bundler_gas_estimate"
    assert result.willRevert is False
    assert result.revertReason is None
    # Gas-estimate SHAPE: 0x-prefixed hex quantity equal to the sum of the three summed legs.
    assert result.gas.estimate == "0x7000"  # 4096 + 8192 + 16384 == 28672
    assert int(result.gas.estimate, 16) == 4096 + 8192 + 16384
    # minOut echoed as a base-unit integer string; no balance deltas on the bundler path.
    assert result.minOut == "990000000"
    assert result.balanceDeltas == []
    assert result.asOfBlock == 0x100


# ─────────────────────────────────────────────────────────────────────────────
# BundlerGasEstimator — revert detection (the willRevert stub fix)
# ─────────────────────────────────────────────────────────────────────────────


async def test_bundler_estimate_reverting_op_reports_will_revert() -> None:
    """A UserOp the bundler rejects (JSON-RPC error w/ Error(string) data) ⇒ willRevert True.

    RED against the old hardcoded ``willRevert=False``: a reverting op must never look like a clean,
    zero-cost success. The gas estimate collapses to ``0x0`` because no legs were returned.
    """
    reason = "AA23 reverted: SLIPPAGE"
    handler = FakeJsonRpc(
        {
            "eth_blockNumber": "0x100",
            "eth_estimateUserOperationGas": {
                "error": {
                    "code": -32521,
                    "message": "execution reverted",
                    "data": _error_string_payload(reason),
                }
            },
        }
    )
    async with BundlerGasEstimator("http://bundler.invalid", client=_client(handler)) as estimator:
        result = await estimator.estimate(_userop_request())

    assert result.willRevert is True
    assert result.revertReason == reason
    assert result.gas.estimate == "0x0"
    assert result.provider == "bundler_gas_estimate"


async def test_bundler_estimate_revert_without_data_falls_back_to_message() -> None:
    """A revert error with no decodable ``data`` fails closed with the RPC message as reason."""
    handler = FakeJsonRpc(
        {
            "eth_blockNumber": "0x100",
            "eth_estimateUserOperationGas": {
                "error": {"code": -32000, "message": "AA13 initCode failed or OOG"}
            },
        }
    )
    async with BundlerGasEstimator("http://bundler.invalid", client=_client(handler)) as estimator:
        result = await estimator.estimate(_userop_request())

    assert result.willRevert is True
    assert result.revertReason == "AA13 initCode failed or OOG"
    assert result.gas.estimate == "0x0"


# ─────────────────────────────────────────────────────────────────────────────
# BundlerGasEstimator — fail-closed / typed-error guards
# ─────────────────────────────────────────────────────────────────────────────


async def test_bundler_transport_failure_fails_closed() -> None:
    """A transport failure (backend unreachable) fails CLOSED — NOT a willRevert=False success."""
    handler = FakeJsonRpc(
        {
            "eth_blockNumber": "0x100",
            "eth_estimateUserOperationGas": httpx.ConnectError("bundler down"),
        }
    )
    async with BundlerGasEstimator("http://bundler.invalid", client=_client(handler)) as estimator:
        with pytest.raises(SimulatorUnavailableError):
            await estimator.estimate(_userop_request())


async def test_bundler_no_rpc_configured_raises() -> None:
    """No bundler URL ⇒ the seam fails closed (SimulatorUnavailableError), never a fake success."""
    async with BundlerGasEstimator(None) as estimator:
        with pytest.raises(SimulatorUnavailableError):
            await estimator.estimate(_userop_request())


async def test_bundler_requires_user_op_and_entry_point() -> None:
    """The bundler path requires a user_op + entry_point; a bare request is a programming error."""
    handler = FakeJsonRpc({"eth_blockNumber": "0x100"})
    async with BundlerGasEstimator("http://bundler.invalid", client=_client(handler)) as estimator:
        bad = SimulationRequest(chain_id=8453, sender=_SENDER, op_type="userop")
        with pytest.raises(ValueError, match="user_op"):
            await estimator.estimate(bad)


# ─────────────────────────────────────────────────────────────────────────────
# AnvilForkSimulator — the PRIMARY provider's revert detection + gas shape
# ─────────────────────────────────────────────────────────────────────────────


def _fork_base(extra: dict[str, Any]) -> FakeJsonRpc:
    base: dict[str, Any] = {
        "eth_blockNumber": "0x2a",
        "eth_getBlockByNumber": {"result": {"timestamp": "0x64"}},
    }
    base.update(extra)
    return FakeJsonRpc(base)


async def test_anvil_simulate_success_reports_gas_and_no_revert() -> None:
    """A non-reverting eoa_call (no tracked assets) ⇒ willRevert False + the gas estimate."""
    handler = _fork_base(
        {
            "eth_call": "0x",  # returns cleanly ⇒ no revert
            "eth_estimateGas": "0x5208",  # 21000
        }
    )
    async with AnvilForkSimulator("http://fork.invalid", client=_client(handler)) as sim:
        req = SimulationRequest(
            chain_id=8453, sender=_SENDER, to=_SENDER, data="0x", action=ActionType.VAULT_DEPOSIT
        )
        result = await sim.simulate(req)

    assert result.provider == "anvil_fork"
    assert result.willRevert is False
    assert result.revertReason is None
    assert result.gas.estimate == "0x5208"
    assert result.asOfBlock == 0x2A


async def test_anvil_simulate_detects_revert_and_skips_gas() -> None:
    """A reverting eth_call ⇒ willRevert True + decoded reason, and eth_estimateGas is skipped."""
    reason = "CapExceeded"
    handler = _fork_base(
        {
            "eth_call": {
                "error": {
                    "code": 3,
                    "message": "execution reverted",
                    "data": _error_string_payload(reason),
                }
            },
            "eth_estimateGas": "0x5208",  # present, but must be skipped on a reverting call
        }
    )
    async with AnvilForkSimulator("http://fork.invalid", client=_client(handler)) as sim:
        req = SimulationRequest(
            chain_id=8453, sender=_SENDER, to=_SENDER, data="0x", action=ActionType.VAULT_DEPOSIT
        )
        result = await sim.simulate(req)

    assert result.willRevert is True
    assert result.revertReason == reason
    assert result.gas.estimate == "0x0"
    # A reverting call has no meaningful gas — the estimator must not have been consulted.
    assert "eth_estimateGas" not in handler.methods
