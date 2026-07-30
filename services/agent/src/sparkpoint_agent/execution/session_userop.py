"""Build the unsigned session-key UserOp for the 019 spine's submission path (feature 022 US6).

Wraps an allowlisted `IntentStep` in an EntryPoint-v0.7 `execute()` UserOp (`signature` = null, N3).
The CLIENT (holding the session key) signs it; `submit_signed` relays it via the bundler
(`execution/bundler.py` — proven live on Base Sepolia). `build` + the match-check keep the submitted
op honest: the client cannot smuggle different calldata under a bundle's id (SC-005); the service
never signs (N1/N3). The scope is already policy-gated + recipient-pinned at build time (same
`evaluate()` as the eoa path) AND re-enforced on-chain by `SparkPointAccount.validateUserOp`.
"""

from __future__ import annotations

from typing import Any

import eth_abi

from . import bundler, rpc
from .models import IntentStep, PackedUserOperation

#: EntryPoint v0.7 singleton (Base Sepolia + mainnet) — matches the pin in SparkPointAccount.
ENTRYPOINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
_EXECUTE_SELECTOR = "0xb61d27f6"  # execute(address,uint256,bytes)

# ─────────────────────────────────────────────────────────────────────────────────────────────────
# 023 (FR-023-007/008) — the gas envelope is ESTIMATED per request, then clamped.
#
# It used to be five module constants proven live on Base Sepolia, with `maxFeePerGas` at 0.05 gwei
# ("Base Sepolia base fee ~0.01 gwei") and `preVerificationGas` at 200k. On Base mainnet that
# breaks: `preVerificationGas` covers the L1 data-posting cost and moves with ETHEREUM gas, and a
# fee cap below the base fee gets the op rejected or stranded un-mined. Crucially the envelope is
# INSIDE the userOpHash — the client signs it and cannot repair it — so a wrong value is
# unrecoverable without a rebuild. `bundler.estimate_user_op_gas` already existed and was never
# called; now it is, and the fees come from a live read.
#
# The bounds below are named for the bound they express, NOT the chain they were proven on. They are
# STARTING VALUES, not physics: floors sit at or below what was proven on Base Sepolia (feature 022)
# so nothing that works today regresses, ceilings roughly an order of magnitude above observed
# mainnet values so a bundler quirk or a gas spike is bounded rather than unbounded. Adjusting them
# is a visible edit to this block.
# ─────────────────────────────────────────────────────────────────────────────────────────────────
_MIN_CALL_GAS = 100_000
_MAX_CALL_GAS = 2_000_000
_MIN_VERIFICATION_GAS = 100_000
_MAX_VERIFICATION_GAS = 1_000_000
_MIN_PRE_VERIFICATION_GAS = 50_000
_MAX_PRE_VERIFICATION_GAS = 2_000_000
_MIN_MAX_FEE = 1_000_000  # 0.001 gwei
_MAX_MAX_FEE = 5_000_000_000  # 5 gwei
_MIN_PRIORITY_FEE = 100_000  # 0.0001 gwei
_MAX_PRIORITY_FEE = 1_000_000_000  # 1 gwei

#: A dummy signature for the ESTIMATE draft only. `eth_estimateUserOperationGas` wants the fee
#: fields populated and a signature of the RIGHT LENGTH — Rundler validates the field's shape, so a
#: short or absent one is rejected or mis-sizes `preVerificationGas` (charged on calldata bytes).
#: This scheme's signature is exactly 66 bytes: mode(0x01) ‖ r(32) ‖ s(32) ‖ v(1) — see
#: `SESSION_SIGNATURE_MODE` in apps/web/src/lib/automation/sessionSigner.ts and
#: `SessionScopeLib.recoverSessionSigner`. A test pins this length against that scheme so the two
#: cannot drift.
SESSION_SIGNATURE_MODE = "0x01"
SESSION_SIGNATURE_BYTES = 1 + 32 + 32 + 1  # mode ‖ r ‖ s ‖ v
_DUMMY_SIGNATURE = SESSION_SIGNATURE_MODE + "00" * (SESSION_SIGNATURE_BYTES - 1)


def _clamp(value: int, low: int, high: int) -> int:
    """Bound an estimated field. Clamping UP matters as much as down: a bundler that returns a limit
    below a known-good floor would otherwise produce an op that cannot execute."""
    return max(low, min(value, high))


def _as_int(raw: Any) -> int | None:
    """A hex-quantity or int from a bundler reply, or ``None`` if it is neither."""
    if isinstance(raw, int) and not isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        try:
            return int(raw, 16)
        except ValueError:
            return None
    return None


def call_data_for(to: str, value: str, data: str) -> str:
    """The account `execute(to, value, inner)` calldata wrapping an allowlisted step. Deterministic
    from the step, so `submit_signed` can match a client userOp against the built bundle."""
    raw = data[2:] if data.startswith(("0x", "0X")) else data
    inner = bytes.fromhex(raw)
    return _EXECUTE_SELECTOR + eth_abi.encode(
        ["address", "uint256", "bytes"], [to, int(value) if value else 0, inner]
    ).hex()


async def build_session_userop(
    step: IntentStep, *, sender: str, rpc_url: str
) -> PackedUserOperation | None:
    """Build the unsigned session-key UserOp for ``step`` (``execute(target, 0, inner)``).

    Returns ``None`` — so the caller fails closed and never fabricates — when the account's
    EntryPoint nonce cannot be read, the live fee read fails, or the bundler's gas estimate fails.

    023: there is deliberately NO fallback envelope. The gas and fee fields are inside the
    ``userOpHash``, so the client signs whatever is emitted here and cannot correct it; substituting
    a guess would produce an op that is either rejected, stranded, or silently overpaying. Emitting
    nothing is the honest outcome (FR-023-009), and matches the pre-existing contract for an
    unreadable nonce.
    """
    nonce = await rpc.get_nonce(rpc_url, ENTRYPOINT, sender)
    if nonce is None:
        return None

    fees = await bundler.fee_per_gas(rpc_url)
    if fees is None:
        return None
    max_fee = _clamp(fees[0], _MIN_MAX_FEE, _MAX_MAX_FEE)
    priority_fee = _clamp(fees[1], _MIN_PRIORITY_FEE, _MAX_PRIORITY_FEE)
    # A priority fee above the total cap would be nonsensical; the cap wins.
    priority_fee = min(priority_fee, max_fee)

    call_data = call_data_for(step.to, step.value, step.data)
    # The estimate draft: fees populated + a correct-LENGTH dummy signature (see _DUMMY_SIGNATURE).
    draft: dict[str, Any] = {
        "sender": sender,
        "nonce": hex(nonce),
        "callData": call_data,
        "maxFeePerGas": hex(max_fee),
        "maxPriorityFeePerGas": hex(priority_fee),
        "signature": _DUMMY_SIGNATURE,
    }
    estimate = await bundler.estimate_user_op_gas(rpc_url, draft, ENTRYPOINT)
    if not estimate:
        return None
    call_gas = _as_int(estimate.get("callGasLimit"))
    verification_gas = _as_int(estimate.get("verificationGasLimit"))
    pre_verification_gas = _as_int(estimate.get("preVerificationGas"))
    if call_gas is None or verification_gas is None or pre_verification_gas is None:
        return None

    return PackedUserOperation(
        sender=sender,
        nonce=hex(nonce),
        factory=None,
        factoryData=None,
        callData=call_data,
        callGasLimit=hex(_clamp(call_gas, _MIN_CALL_GAS, _MAX_CALL_GAS)),
        verificationGasLimit=hex(
            _clamp(verification_gas, _MIN_VERIFICATION_GAS, _MAX_VERIFICATION_GAS)
        ),
        preVerificationGas=hex(
            _clamp(pre_verification_gas, _MIN_PRE_VERIFICATION_GAS, _MAX_PRE_VERIFICATION_GAS)
        ),
        maxFeePerGas=hex(max_fee),
        maxPriorityFeePerGas=hex(priority_fee),
        paymaster=None,
        paymasterData=None,
        # signature stays null (N3) — only the client's session key adds it.
    )


def signed_matches_scope(signed: dict[str, Any], *, sender: str, call_data: str) -> bool:
    """The client-signed UserOp MUST target the SAME account and carry the SAME callData the spine
    built for this bundle — only `signature` may differ. Blocks smuggling different calldata
    (a different target/amount/recipient) under a bundle's id (SC-005); validateUserOp is the
    ultimate backstop, but we refuse to RECORD a mismatched op against the bundle."""
    return (
        str(signed.get("sender", "")).lower() == sender.lower()
        and str(signed.get("callData", "")).lower() == call_data.lower()
    )
