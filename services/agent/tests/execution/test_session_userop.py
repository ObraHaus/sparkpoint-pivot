# ruff: noqa: S101
"""Session-key UserOp builder + scope-match (feature 022 US6, N3/SC-005).

The service builds an UNSIGNED userOp (``signature`` stays null, N3), and ``signed_matches_scope``
refuses to record a client op whose sender/callData drifts from what the spine built — so a client
cannot smuggle a different target/amount/recipient under a bundle's id. Nonce read failing → None
(fail closed, never fabricate).
"""

from __future__ import annotations

import pytest

from sparkpoint_agent.execution import rpc, session_userop
from sparkpoint_agent.execution.models import IntentStep
from sparkpoint_agent.execution.session_userop import (
    ENTRYPOINT,
    build_session_userop,
    call_data_for,
    signed_matches_scope,
)

_VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
_ACCOUNT = "0x1111111111111111111111111111111111111111"
# vault deposit(100_000000, account) inner calldata (selector 0x6e553f65).
_INNER = "0x6e553f65"


def _stub_gas(monkeypatch: pytest.MonkeyPatch) -> None:
    """023 — the builder now also reads live fees + a bundler gas estimate (FR-023-007), so a test
    that exercises the build must stub all three reads. Fixture-only change: the assertions below
    are unchanged (sender / nonce / null signature / callData byte-match)."""

    async def _fees(url: str) -> tuple[int, int]:
        return 50_000_000, 1_000_000

    async def _estimate(url: str, op: dict[str, object], entry_point: str) -> dict[str, str]:
        return {
            "callGasLimit": hex(500_000),
            "verificationGasLimit": hex(150_000),
            "preVerificationGas": hex(200_000),
        }

    monkeypatch.setattr(session_userop.bundler, "fee_per_gas", _fees)
    monkeypatch.setattr(session_userop.bundler, "estimate_user_op_gas", _estimate)


def _step() -> IntentStep:
    return IntentStep(
        chainId=84532, opType="userop", to=_VAULT, value="0", data=_INNER, label="deposit"
    )


def test_call_data_for_is_deterministic_execute_wrap() -> None:
    cd = call_data_for(_VAULT, "0", _INNER)
    # execute(address,uint256,bytes) selector, and identical inputs → identical calldata.
    assert cd.startswith("0xb61d27f6")
    assert call_data_for(_VAULT, "0", _INNER) == cd
    # the pinned target address appears (right-padded) in the head word.
    assert _VAULT[2:].lower() in cd.lower()


def test_call_data_for_accepts_bare_hex_and_empty_value() -> None:
    # non-0x-prefixed inner + empty value string must not raise and must match the 0x form.
    assert call_data_for(_VAULT, "", "6e553f65") == call_data_for(_VAULT, "0", _INNER)


def test_signed_matches_scope_true_case_insensitive() -> None:
    cd = call_data_for(_VAULT, "0", _INNER)
    signed = {"sender": _ACCOUNT.upper(), "callData": cd.upper(), "signature": "0xabcd"}
    assert signed_matches_scope(signed, sender=_ACCOUNT, call_data=cd) is True


def test_signed_matches_scope_false_on_calldata_drift() -> None:
    cd = call_data_for(_VAULT, "0", _INNER)
    # a client swapping in a different inner selector (different move) must NOT match.
    drift = call_data_for(_VAULT, "0", "0xb460af94")
    signed = {"sender": _ACCOUNT, "callData": drift, "signature": "0xabcd"}
    assert signed_matches_scope(signed, sender=_ACCOUNT, call_data=cd) is False


def test_signed_matches_scope_false_on_sender_drift() -> None:
    cd = call_data_for(_VAULT, "0", _INNER)
    signed = {"sender": "0x9999999999999999999999999999999999999999", "callData": cd}
    assert signed_matches_scope(signed, sender=_ACCOUNT, call_data=cd) is False


@pytest.mark.asyncio
async def test_build_session_userop_none_when_nonce_unreadable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _no_nonce(url: str, entry_point: str, sender: str) -> int | None:
        return None

    monkeypatch.setattr(rpc, "get_nonce", _no_nonce)
    op = await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc")
    assert op is None  # fail closed — never fabricate a nonce


@pytest.mark.asyncio
async def test_build_session_userop_unsigned_matches_scope(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _nonce(url: str, entry_point: str, sender: str) -> int | None:
        assert entry_point == ENTRYPOINT
        return 7

    monkeypatch.setattr(session_userop.rpc, "get_nonce", _nonce)
    _stub_gas(monkeypatch)
    op = await build_session_userop(_step(), sender=_ACCOUNT, rpc_url="http://rpc")
    assert op is not None
    assert op.signature is None  # N3 — service never signs
    assert op.sender == _ACCOUNT
    assert op.nonce == "0x7"
    # the built op's callData is exactly what submit_signed will match against (SC-005).
    dumped = op.model_dump()
    assert signed_matches_scope(
        dumped, sender=_ACCOUNT, call_data=call_data_for(_VAULT, "0", _INNER)
    )
