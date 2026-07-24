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

from . import rpc
from .models import IntentStep, PackedUserOperation

#: EntryPoint v0.7 singleton (Base Sepolia + mainnet) — matches the pin in SparkPointAccount.
ENTRYPOINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"
_EXECUTE_SELECTOR = "0xb61d27f6"  # execute(address,uint256,bytes)

# Gas envelope proven live on Base Sepolia (feature 022). The client MAY re-estimate before signing;
# the values are what the session key signs over (part of the userOpHash), so they must be sane.
_VERIFICATION_GAS_LIMIT = 150_000
_CALL_GAS_LIMIT = 500_000
_PRE_VERIFICATION_GAS = 200_000
_MAX_PRIORITY_FEE = 1_000_000  # 0.001 gwei
_MAX_FEE = 50_000_000  # 0.05 gwei (Base Sepolia base fee ~0.01 gwei)


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
    """Build the unsigned session-key UserOp for `step` (execute(target,0,inner)). None if the
    account's EntryPoint nonce can't be read (the caller then fails closed, never fabricates)."""
    nonce = await rpc.get_nonce(rpc_url, ENTRYPOINT, sender)
    if nonce is None:
        return None
    return PackedUserOperation(
        sender=sender,
        nonce=hex(nonce),
        factory=None,
        factoryData=None,
        callData=call_data_for(step.to, step.value, step.data),
        callGasLimit=hex(_CALL_GAS_LIMIT),
        verificationGasLimit=hex(_VERIFICATION_GAS_LIMIT),
        preVerificationGas=hex(_PRE_VERIFICATION_GAS),
        maxFeePerGas=hex(_MAX_FEE),
        maxPriorityFeePerGas=hex(_MAX_PRIORITY_FEE),
        paymaster=None,
        paymasterData=None,
        # signature stays null (N3) — only the client's wallet adds it.
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
