"""071 Phase C — cross-chain Rhea (Burrow) review/commit helpers.

This module is the reversible, non-custodial slice that sits on top of the existing DRY
Rhea/1Click preview (:mod:`sparkpoint_agent.earn.service`) and the MCA/``customRecipientMsg``
builders (:mod:`sparkpoint_agent.earn.rhea`).

It deliberately does **not** sign, submit or broadcast anything:

* the live (``dry=false``) 1Click commit is gated behind ``EARN_LIVE_RHEA_XCHAIN`` **and** a
  key-presence boolean (``ONECLICK_API_KEY`` set). The key value is never read into a log,
  response or exception — only ``bool`` presence is surfaced.
* the origin leg is an **unsigned** ERC-20 ``transfer(address,uint256)`` plan for the user's own
  wallet to confirm. The agent never holds a key and never sends the plan.
* withdraw is an honest review of the documented Rhea SDK paths, never a fake NEP-413-as-tx and
  never an invented custodian/relayer.

Wire facts are from ``specs/071-rhea-near-earn/research.md`` and
``specs/079-rhea-xchain-mca/research.md``.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any, Final

from ..crosschain.config import CrossChainAsset

XCHAIN_LIVE_FLAG_ENV: Final = "EARN_LIVE_RHEA_XCHAIN"
ONECLICK_KEY_ENV: Final = "ONECLICK_API_KEY"

#: ERC-20 ``transfer(address,uint256)`` selector — a public constant, not a secret.
ERC20_TRANSFER_SELECTOR: Final = "a9059cbb"

#: Documented Rhea cross-chain SDK (withdraw/relayer + ``nearMcaWithdrawTx``).
RHEA_SDK_SOURCE: Final = (
    "https://raw.githubusercontent.com/rhea-finance/rhea-sdk-docs/main/CrossChainDexSdk.md"
)
RHEA_APP_SOURCE: Final = "https://app.rhea.finance/lending"
NEP413_SOURCE: Final = "https://github.com/near/NEPs/blob/master/neps/nep-0413.md"
MCA_SOURCE: Final = "https://guide.rhea.finance/developers/contracts"

_ON_VALUES: Final = {"true"}


class RheaXchainError(RuntimeError):
    """A cross-chain commit/plan failure. The message is safe to show the user."""


class RheaXchainDisabled(RheaXchainError):
    """The live commit is disabled (flag off or the 1Click credential is absent)."""


class RheaXchainSignatureRequired(RheaXchainError):
    """A first deposit needs the off-chain EVM ``personal_sign`` before a live quote."""

    def __init__(self, message_to_sign: str) -> None:
        super().__init__(
            "The first Rhea deposit needs one off-chain personal_sign before a live quote. "
            "Nothing was signed or sent."
        )
        self.message_to_sign = message_to_sign


def _flag(source: Mapping[str, str], name: str, *, default: bool = False) -> bool:
    raw = source.get(name)
    if raw is None or not raw.strip():
        return default
    return raw.strip().lower() in _ON_VALUES


def xchain_live_enabled(env: Mapping[str, str] | None = None) -> bool:
    """The server switch. Default OFF. Only the exact non-off spellings enable it."""
    return _flag(env if env is not None else os.environ, XCHAIN_LIVE_FLAG_ENV, default=False)


def oneclick_key_present(env: Mapping[str, str] | None = None) -> bool:
    """Whether ``ONECLICK_API_KEY`` is set — a boolean only, never the value."""
    source = env if env is not None else os.environ
    return bool((source.get(ONECLICK_KEY_ENV) or "").strip())


def live_gate(
    *, server_enabled: bool, key_present: bool
) -> tuple[bool, str | None]:
    """The single server-side gate for a live (``dry=false``) Rhea commit."""
    if not server_enabled:
        return False, (
            f"Live cross-chain Rhea deposits are off on this deployment "
            f"({XCHAIN_LIVE_FLAG_ENV} is not enabled)."
        )
    if not key_present:
        return False, (
            "A live cross-chain Rhea quote needs the 1Click/Rhea API credential "
            f"({ONECLICK_KEY_ENV} is not configured)."
        )
    return True, None


def gate_wire(
    *, server_enabled: bool, key_present: bool
) -> dict[str, Any]:
    """Key-free gate metadata for the review UI (never a key value)."""
    allowed, reason = live_gate(server_enabled=server_enabled, key_present=key_present)
    return {
        "serverEnabled": server_enabled,
        "keyPresent": key_present,
        "liveAllowed": allowed,
        "reason": reason,
        "flagEnv": XCHAIN_LIVE_FLAG_ENV,
        "keyEnv": ONECLICK_KEY_ENV,
        "note": (
            "dry=true previews are always non-custodial. A live dry=false commit only prepares "
            "an unsigned origin transfer for your own wallet; the agent never signs or sends."
        ),
    }


# ── origin ERC-20 transfer plan (unsigned, agent never signs) ────────────────


def origin_token_address(asset: CrossChainAsset) -> str | None:
    """Derive the origin ERC-20 contract from a 1Click ``nep141:<chain>-<token>.omft.near`` id."""
    asset_id = asset.asset_id
    if not asset_id.startswith("nep141:"):
        return None
    rest = asset_id[len("nep141:") :]
    suffix = ".omft.near"
    if rest.endswith(suffix):
        rest = rest[: -len(suffix)]
    prefix = f"{asset.chain}-"
    if not rest.startswith(prefix):
        return None
    token = rest[len(prefix) :]
    if token.startswith("0x") and len(token) == 42:
        return token
    return None


def _pad_address(address: str) -> str:
    text = address.strip()
    if text[:2].lower() == "0x":
        text = text[2:]
    if len(text) != 40:
        raise RheaXchainError("The origin token address is not a 20-byte EVM address.")
    return text.lower().rjust(64, "0")


def _pad_uint(value: int) -> str:
    if value < 0:
        raise RheaXchainError("The transfer amount cannot be negative.")
    return format(value, "x").rjust(64, "0")


def erc20_transfer_calldata(*, token_address: str, recipient: str, amount_raw: int) -> str:
    """ABI-encode ``transfer(recipient, amount_raw)`` — data only, never a signature."""
    return (
        "0x"
        + ERC20_TRANSFER_SELECTOR
        + _pad_address(recipient)
        + _pad_uint(amount_raw)
    )


def build_origin_transfer_plan(
    *,
    asset: CrossChainAsset,
    wallet: str,
    deposit_address: str,
    amount_human: str,
    amount_raw: int,
) -> dict[str, Any]:
    """An UNSIGNED origin ERC-20 transfer for the user's wallet to confirm.

    The plan is data. This function never signs, submits or broadcasts; it does not even call a
    wallet. A non-EVM origin is an honest ``unsupported`` plan rather than an invented transfer.
    """
    token = origin_token_address(asset)
    if asset.address_kind != "evm" or token is None or asset.evm_chain_id is None:
        return {
            "kind": "unsupported",
            "unsigned": True,
            "chain": asset.chain,
            "chainId": asset.evm_chain_id,
            "tokenAddress": token,
            "from": wallet,
            "to": deposit_address,
            "amount": amount_human,
            "amountRaw": str(amount_raw),
            "symbol": asset.symbol,
            "functionSignature": None,
            "calldata": None,
            "note": (
                "This origin is not an EVM chain, so the agent cannot prepare an ERC-20 transfer "
                "plan. Use the 1Click/Rhea deposit instructions for your wallet. Nothing was "
                "signed or sent."
            ),
        }
    calldata = erc20_transfer_calldata(
        token_address=token, recipient=deposit_address, amount_raw=amount_raw
    )
    return {
        "kind": "erc20_transfer",
        "unsigned": True,
        "chain": asset.chain,
        "chainId": asset.evm_chain_id,
        "tokenAddress": token,
        "from": wallet,
        "to": deposit_address,
        "amount": amount_human,
        "amountRaw": str(amount_raw),
        "symbol": asset.symbol,
        "functionSignature": "transfer(address,uint256)",
        "calldata": calldata,
        "note": (
            "Unsigned origin ERC-20 transfer to the 1Click deposit address. Confirm it in your "
            "own wallet; the agent never signs, submits or broadcasts."
        ),
    }


# ── withdraw review (honest, documented) ────────────────────────────────────


def withdraw_review(*, app_url: str = RHEA_APP_SOURCE) -> dict[str, Any]:
    """The documented withdraw options — no fake NEP-413 transaction, no invented custodian.

    The shipped beta keeps withdraw as a link-out. The Rhea SDK separately documents a relayer
    business message and a direct ``nearMcaWithdrawTx`` path *when the recipient/NEAR conditions
    match*; both are recorded as documented-but-not-implemented here rather than pretended.
    """
    return {
        "state": "documented",
        "kind": "external_link_and_documented_paths",
        "nep413IsTransaction": False,
        "custodian": None,
        "note": (
            "NEP-413 is off-chain authentication, not a Burrow/MCA transaction. SparkPoint does "
            "not custody funds and does not invent a relayer. Nothing here signs or sends."
        ),
        "paths": [
            {
                "id": "rhea_app",
                "label": "Withdraw in the Rhea app",
                "status": "link_out",
                "url": app_url,
                "note": "Connect the same wallet you supplied with and withdraw there.",
                "source": RHEA_APP_SOURCE,
            },
            {
                "id": "rhea_relayer",
                "label": "Rhea SDK relayer withdrawal",
                "status": "documented_not_implemented",
                "url": None,
                "note": (
                    "Rhea's CrossChainDexSdk documents an "
                    '`executionPreference: "relayer"` withdraw business message. It needs Rhea '
                    "API access and a signed MCA business message; this beta does not enable it."
                ),
                "source": RHEA_SDK_SOURCE,
            },
            {
                "id": "near_mca_withdraw_tx",
                "label": "nearMcaWithdrawTx (direct NEAR)",
                "status": "documented_not_implemented",
                "url": None,
                "note": (
                    "The SDK documents a direct `nearMcaWithdrawTx` path when the recipient and "
                    "NEAR conditions match. The agent does not build or send it here."
                ),
                "source": RHEA_SDK_SOURCE,
            },
        ],
        "sources": [
            {"id": "rhea_app", "url": RHEA_APP_SOURCE},
            {"id": "rhea_sdk", "url": RHEA_SDK_SOURCE},
            {"id": "multica", "url": MCA_SOURCE},
            {"id": "nep413", "url": NEP413_SOURCE},
        ],
    }


__all__ = [
    "ERC20_TRANSFER_SELECTOR",
    "ONECLICK_KEY_ENV",
    "RHEA_APP_SOURCE",
    "RHEA_SDK_SOURCE",
    "RheaXchainDisabled",
    "RheaXchainError",
    "RheaXchainSignatureRequired",
    "XCHAIN_LIVE_FLAG_ENV",
    "build_origin_transfer_plan",
    "erc20_transfer_calldata",
    "gate_wire",
    "live_gate",
    "oneclick_key_present",
    "origin_token_address",
    "withdraw_review",
    "xchain_live_enabled",
]
