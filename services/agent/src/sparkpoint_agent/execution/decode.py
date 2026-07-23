"""Decode a wire ProposedAction into the policy ``Action`` (feature 019 US2).

The reverse of ``coordinator.chat_blocks.proposed_action_wire``: a wire ``action`` dict (token
ADDRESS asset, base-unit amount string) → the canonical policy
:class:`~sparkpoint_agent.policy.Action`
(symbolic ``Asset``, int amount, recipient PINNED to the connected user — N1). Vault actions only on
testnet (US2 scope); an unsupported type/asset is refused honestly (never faked).
"""

from __future__ import annotations

from ..policy import Action, ActionType, Asset, ReasonCode, get_policy_constants
from .models import BuildActionRequest

# US2 testnet scope — the vault action path only. Direct-Aave + Aerodrome swaps are refused
# honestly.
_VAULT_ACTIONS: frozenset[ActionType] = frozenset(
    {ActionType.VAULT_DEPOSIT, ActionType.VAULT_WITHDRAW, ActionType.VAULT_REDEEM}
)


class DecodeError(Exception):
    """A wire action could not be decoded into a valid, supported policy Action (fail-closed)."""

    def __init__(self, code: ReasonCode, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def decode_action(
    wire: BuildActionRequest,
    *,
    account: str,
    chain_id: int,
    vault: str,
    usdc: str,
) -> Action:
    """Decode a build-tx ``action`` into a policy ``Action`` (recipient pinned to ``account``).

    :raises DecodeError: unknown/unsupported action type, missing allowlist entry,
        or a non-USDC asset — each fail-closed (never a silently-permitted or fabricated action).
    """
    try:
        atype = ActionType(wire.type)
    except ValueError as exc:
        raise DecodeError(ReasonCode.SCHEMA_INVALID, f"unknown action type {wire.type!r}") from exc

    if atype not in _VAULT_ACTIONS:
        raise DecodeError(
            ReasonCode.SCHEMA_INVALID,
            f"{wire.type} is not buildable on this network yet (vault actions only).",
        )

    try:
        constants = get_policy_constants(chain_id)
    except ValueError as exc:
        raise DecodeError(ReasonCode.SCHEMA_INVALID, str(exc)) from exc

    entry = next((e for e in constants.allowlist if e.action is atype), None)
    if entry is None:
        raise DecodeError(
            ReasonCode.PROTOCOL_NOT_ALLOWLISTED,
            f"{wire.type} is not allowlisted on chain {chain_id}.",
        )

    # The vault asset is USDC only; the wire carries a token ADDRESS → resolve to the symbolic
    # Asset.
    if wire.asset.lower() != usdc.lower():
        raise DecodeError(
            ReasonCode.ASSET_NOT_ALLOWLISTED,
            "The vault asset must be USDC on this chain.",
        )

    return Action(
        action_type=atype,
        target=vault,
        selector=entry.selector,
        asset=Asset.USDC,
        amount=wire.amount_int,
        decimals=wire.decimals,
        # N1 — recipient PINNED to the connected user's account (the vault receiver / owner).
        recipient=account,
    )
