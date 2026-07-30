# ruff: noqa: S101  (pytest asserts)
"""023 T014 — the session-key gas envelope is estimated, clamped, and fail-closed.

FR-023-007/008/009. The envelope used to be five constants proven on Base Sepolia
(``maxFeePerGas`` 0.05 gwei, ``preVerificationGas`` 200k). On Base mainnet ``preVerificationGas``
tracks the L1 data-posting cost and a fee cap below the base fee gets the op rejected or stranded —
and because the envelope is inside the ``userOpHash``, the client signs it and cannot repair it. So
it must come from a live fee read plus the bundler's estimator, be bounded at BOTH ends, and yield
NO op at all when either read fails.
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.execution import session_userop
from sparkpoint_agent.execution.models import IntentStep
from sparkpoint_agent.execution.session_userop import (
    SESSION_SIGNATURE_BYTES,
    SESSION_SIGNATURE_MODE,
    build_session_userop,
)

_VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
_ACCOUNT = "0x1111111111111111111111111111111111111111"
_INNER = "0x6e553f65"


def _step() -> IntentStep:
    return IntentStep(
        chainId=84532, opType="userop", to=_VAULT, value="0", data=_INNER, label="deposit"
    )


_DEFAULT_ESTIMATE = {
    "callGasLimit": hex(500_000),
    "verificationGasLimit": hex(150_000),
    "preVerificationGas": hex(200_000),
}
#: Distinguishes "not overridden" from an explicit ``None`` (an estimator FAILURE) — the second is a
#: case under test, so a plain ``None`` default would silently swallow it.
_UNSET = object()


def _wire(
    monkeypatch: pytest.MonkeyPatch,
    *,
    nonce: int | None = 7,
    fees: tuple[int, int] | None = (50_000_000, 1_000_000),
    estimate: Any = _UNSET,
    capture: dict[str, Any] | None = None,
) -> None:
    """Stub the three reads the builder makes; ``capture`` records the estimate draft."""
    if estimate is _UNSET:
        estimate = dict(_DEFAULT_ESTIMATE)

    async def _nonce(url: str, entry_point: str, sender: str) -> int | None:
        return nonce

    async def _fees(url: str) -> tuple[int, int] | None:
        return fees

    async def _estimate(url: str, op: dict[str, Any], entry_point: str) -> dict[str, Any] | None:
        if capture is not None:
            capture.update(op)
        return estimate

    monkeypatch.setattr(session_userop.rpc, "get_nonce", _nonce)
    monkeypatch.setattr(session_userop.bundler, "fee_per_gas", _fees)
    monkeypatch.setattr(session_userop.bundler, "estimate_user_op_gas", _estimate)


async def test_envelope_comes_from_the_estimator_and_the_live_fee_read(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _wire(
        monkeypatch,
        fees=(1_234_567, 222_222),
        estimate={
            "callGasLimit": hex(444_444),
            "verificationGasLimit": hex(333_333),
            "preVerificationGas": hex(555_555),
        },
    )
    op = await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc")

    assert op is not None
    assert int(op.callGasLimit, 16) == 444_444
    assert int(op.verificationGasLimit, 16) == 333_333
    assert int(op.preVerificationGas, 16) == 555_555
    assert int(op.maxFeePerGas, 16) == 1_234_567
    assert int(op.maxPriorityFeePerGas, 16) == 222_222
    assert op.signature is None  # N3 — the service still never signs


async def test_estimates_are_clamped_up_to_the_floor(monkeypatch: pytest.MonkeyPatch) -> None:
    """Clamping UP matters as much as down: a bundler returning a limit below a known-good floor
    would otherwise produce an op that cannot execute."""
    _wire(
        monkeypatch,
        fees=(1, 1),
        estimate={
            "callGasLimit": hex(1),
            "verificationGasLimit": hex(1),
            "preVerificationGas": hex(1),
        },
    )
    op = await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc")

    assert op is not None
    assert int(op.callGasLimit, 16) == session_userop._MIN_CALL_GAS
    assert int(op.verificationGasLimit, 16) == session_userop._MIN_VERIFICATION_GAS
    assert int(op.preVerificationGas, 16) == session_userop._MIN_PRE_VERIFICATION_GAS
    assert int(op.maxFeePerGas, 16) == session_userop._MIN_MAX_FEE


async def test_estimates_are_clamped_down_to_the_ceiling(monkeypatch: pytest.MonkeyPatch) -> None:
    """A bundler quirk or a gas spike must be bounded, not unbounded."""
    huge = 10**18
    _wire(
        monkeypatch,
        fees=(huge, huge),
        estimate={
            "callGasLimit": hex(huge),
            "verificationGasLimit": hex(huge),
            "preVerificationGas": hex(huge),
        },
    )
    op = await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc")

    assert op is not None
    assert int(op.callGasLimit, 16) == session_userop._MAX_CALL_GAS
    assert int(op.verificationGasLimit, 16) == session_userop._MAX_VERIFICATION_GAS
    assert int(op.preVerificationGas, 16) == session_userop._MAX_PRE_VERIFICATION_GAS
    assert int(op.maxFeePerGas, 16) == session_userop._MAX_MAX_FEE
    # The priority fee can never exceed the total cap.
    assert int(op.maxPriorityFeePerGas, 16) <= int(op.maxFeePerGas, 16)


async def test_estimate_draft_carries_a_correct_length_dummy_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The drift guard. ``eth_estimateUserOperationGas`` validates the signature field's shape and
    charges ``preVerificationGas`` on calldata bytes, so the dummy must be exactly as long as a REAL
    session signature: mode(0x01) ‖ r(32) ‖ s(32) ‖ v(1) = 66 bytes. Asserted against the scheme
    rather than a literal, so changing the scheme without changing the dummy fails here."""
    draft: dict[str, Any] = {}
    _wire(monkeypatch, capture=draft)
    await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc")

    signature = draft["signature"]
    assert signature.startswith(SESSION_SIGNATURE_MODE)
    assert SESSION_SIGNATURE_BYTES == 1 + 32 + 32 + 1 == 66
    body = signature[2:] if signature.startswith("0x") else signature
    assert len(body) // 2 == SESSION_SIGNATURE_BYTES
    # The fees must be populated on the draft too, or the estimate is rejected/mis-sized.
    assert draft["maxFeePerGas"] and draft["maxPriorityFeePerGas"]


async def test_no_userop_when_the_fee_read_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """FR-023-009 — fail closed, never a fallback envelope: a wrong value is signed over and
    unrecoverable, so emitting nothing is the honest outcome."""
    _wire(monkeypatch, fees=None)
    assert await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc") is None


async def test_no_userop_when_the_estimator_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    _wire(monkeypatch, estimate=None)
    assert await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc") is None


async def test_no_userop_when_the_estimate_is_missing_a_field(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A partial estimate is not a usable envelope — no silent default for the missing field."""
    _wire(monkeypatch, estimate={"callGasLimit": hex(500_000)})
    assert await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc") is None


async def test_no_userop_when_the_nonce_read_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    """The pre-existing contract, unchanged by 023."""
    _wire(monkeypatch, nonce=None)
    assert await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc") is None


async def test_fee_read_applies_the_base_fee_multiplier() -> None:
    """``max_fee = multiplier × pending base fee + priority`` — pinned so the headroom convention is
    a visible decision rather than an accident."""
    from sparkpoint_agent.execution import bundler

    calls: list[str] = []

    async def _rpc(url: str, method: str, params: list[Any]) -> tuple[Any, None]:
        calls.append(method)
        if method == "eth_maxPriorityFeePerGas":
            return hex(1_000), None
        return {"baseFeePerGas": hex(10_000)}, None

    original = bundler._bundler_rpc
    bundler._bundler_rpc = _rpc  # type: ignore[assignment]
    try:
        fees = await bundler.fee_per_gas("http://rpc")
    finally:
        bundler._bundler_rpc = original  # type: ignore[assignment]

    assert fees == (bundler.BASE_FEE_MULTIPLIER * 10_000 + 1_000, 1_000)
    assert calls == ["eth_maxPriorityFeePerGas", "eth_getBlockByNumber"]
