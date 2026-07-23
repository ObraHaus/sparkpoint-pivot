"""Build the UNSIGNED calldata step(s) for a vault action (feature 019 US2).

Emits inert ``eoa_call`` calldata (recipient forced to the connected user, ``signature`` never
present — N1/N3). The selectors are the SAME 4-byte entrypoints the 018 dry-run and the on-chain
PolicyModule use (verified vs the compiled artifact + policy/constants.py). Calldata is built to be
signed BY THE USER'S WALLET verbatim — the byte-match the ``/submit-signed-tx`` relay asserts.
"""

from __future__ import annotations

import eth_abi

from ..policy import Action, ActionType
from .models import IntentStep

_DEPOSIT_SELECTOR = "0x6e553f65"  # deposit(uint256 assets, address receiver)
_REDEEM_SELECTOR = "0xba087652"  # redeem(uint256 shares, address receiver, address owner)
_WITHDRAW_SELECTOR = "0xb460af94"  # withdraw(uint256 assets, address receiver, address owner)


def _encode_deposit(assets: int, receiver: str) -> str:
    return _DEPOSIT_SELECTOR + eth_abi.encode(["uint256", "address"], [assets, receiver]).hex()


def _encode_redeem(shares: int, receiver: str, owner: str) -> str:
    return (
        _REDEEM_SELECTOR
        + eth_abi.encode(["uint256", "address", "address"], [shares, receiver, owner]).hex()
    )


def _encode_withdraw(assets: int, receiver: str, owner: str) -> str:
    return (
        _WITHDRAW_SELECTOR
        + eth_abi.encode(["uint256", "address", "address"], [assets, receiver, owner]).hex()
    )


def build_steps(action: Action, *, chain_id: int) -> tuple[IntentStep, ...]:
    """Build the ordered UNSIGNED steps for a vault ``action`` (recipient == ``action.recipient``).

    For deposit ``amount`` is USDC assets; for redeem it is shares; for withdraw it is USDC assets.
    The receiver/owner in the calldata are forced to the user's own account (N1).
    """
    to = action.target
    user = action.recipient
    if action.action_type is ActionType.VAULT_DEPOSIT:
        data = _encode_deposit(action.amount, user)
        label = "Deposit USDC into the SparkPoint Aave Yield Vault"
    elif action.action_type is ActionType.VAULT_REDEEM:
        data = _encode_redeem(action.amount, user, user)
        label = "Redeem your SparkPoint vault shares to USDC"
    elif action.action_type is ActionType.VAULT_WITHDRAW:
        data = _encode_withdraw(action.amount, user, user)
        label = "Withdraw USDC from the SparkPoint vault"
    else:  # pragma: no cover — decode() only admits the three vault actions
        raise ValueError(f"unbuildable action type {action.action_type}")

    return (
        IntentStep(chainId=chain_id, opType="eoa_call", to=to, value="0", data=data, label=label),
    )
