"""How each Morpho vault can be reached (feature 069).

Three honest rails, computed from config + data:
  * ``direct`` — a same-chain ERC-4626 deposit from a wallet on that chain. Always available on an
    enabled chain, and the only rail that gives NATIVE Morpho vault shares.
  * ``oneclick_earn`` — only when a configured 1Click receipt's ``underlying_vault`` matches the
    vault. The receipt is a NEAR-issued ERC-4626 wrapper, NOT the Morpho share, and the preview
    carries that label plus the keyless 0.25% routing-fee note.
  * ``intents_connect`` — only when the flag is on, ``AURORA_INTENTS_API_KEY`` is set and the
    vault's asset is in the configured per-chain supported list. This rail emits a step PLAN
    (approve + deposit) as data; it never submits and never signs.

A missing/inert rail is not an error: it is an honest "not available here" with a reason.
"""

from __future__ import annotations

import os
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..crosschain.addresses import placeholder_for
from ..crosschain.config import AddressKind, CrossChainConfig
from ..crosschain.oneclick import OneClickClient, QuoteUnavailable, deadline_at
from .config import AURORA_KEY_ENV, EarnConfig, OneClickReceipt
from .registry import VaultEntry

LIVENESS_TTL_S = 900.0
LIVE = "live"
NO_LIQUIDITY = "no_liquidity"
UNKNOWN = "unknown"

FEE_NOTE = "Includes 1Click's 0.25% keyless routing fee."
RECEIPT_NOTE = (
    "This route delivers a NEAR-issued receipt token, not the native Morpho vault share. "
    "The receipt is backed by the vault; a direct same-chain deposit gives you the native share."
)
NATIVE_SHARES_NOTE = (
    "This route delivers the native Kamino kVault share token on Solana — the receipt IS the "
    "vault share (not a NEAR-issued wrapper). You receive the same share mint the vault issues."
)
KAMINO_DIRECT_NOTE = (
    "Direct Kamino deposits require a Solana wallet, which the beta does not support yet."
)
RHEA_DIRECT_NOTE = (
    "Rhea lending is on NEAR; the beta has no NEAR wallet. Supply runs through NEAR Intents "
    "1Click instead."
)
RHEA_NOTE = (
    "Supplies into your Rhea (Burrow) account on NEAR through NEAR Intents 1Click — no NEAR "
    "wallet, gas or chain switch. Withdraw on app.rhea.finance with the same wallet."
)
RHEA_FEE_NOTE = (
    "Includes 1Click's 0.25% keyless routing fee. A one-time 0.60 USDC Rhea account + DApp "
    "registration fee applies on the first deposit only."
)
INTENTS_MISSING_KEY = (
    "Aurora Intents Connect is not configured on this deployment (requires Aurora API access)."
)
INTENTS_DISABLED = "Aurora Intents Connect is disabled in the earn config."


_DEFAULT_LIVENESS: ReceiptLivenessCache | None = None


def default_liveness() -> ReceiptLivenessCache:
    """The process-wide liveness cache (shared by the refresher and request handlers)."""
    global _DEFAULT_LIVENESS
    if _DEFAULT_LIVENESS is None:
        _DEFAULT_LIVENESS = ReceiptLivenessCache()
    return _DEFAULT_LIVENESS


class ReceiptLivenessCache:
    """The result of the LAST dry quote per receipt, with a TTL (never a stored guess)."""

    def __init__(
        self,
        *,
        ttl_s: float = LIVENESS_TTL_S,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._ttl_s = ttl_s
        self._clock = clock
        self._data: dict[str, tuple[float, str]] = {}

    def get(self, asset_id: str) -> str:
        item = self._data.get(asset_id)
        if item is None:
            return UNKNOWN
        stamped, value = item
        if self._clock() - stamped >= self._ttl_s:
            return UNKNOWN
        return value

    def set(self, asset_id: str, value: str) -> None:
        self._data[asset_id] = (self._clock(), value)


@dataclass(frozen=True, slots=True)
class RailResolution:
    available: tuple[str, ...]
    detail: dict[str, Any]

    def wire(self) -> dict[str, Any]:
        return {"available": list(self.available), **self.detail}


def _direct_rail(config: EarnConfig, entry: VaultEntry) -> dict[str, Any]:
    chain = config.chain(entry.chain)
    if entry.protocol == "kamino":
        return {
            "available": False,
            "reason": KAMINO_DIRECT_NOTE,
            "note": "The beta has no Solana wallet connection, so 1Click Earn is the only rail.",
        }
    enabled = bool(chain and chain.enabled and config.rails.direct)
    return {
        "available": enabled,
        "reason": None if enabled else "Direct deposits are disabled for this chain.",
        "note": "Deposit from a wallet on this chain to receive the native Morpho vault share.",
    }


def _receipt_note(receipt: OneClickReceipt) -> str:
    return NATIVE_SHARES_NOTE if receipt.receipt_kind == "native_shares" else RECEIPT_NOTE


def _oneclick_rail(
    config: EarnConfig,
    entry: VaultEntry,
    receipt: OneClickReceipt | None,
    liveness: ReceiptLivenessCache,
) -> dict[str, Any]:
    if not config.rails.oneclick_earn:
        return {"available": False, "reason": "1Click Earn is disabled in the earn config."}
    if receipt is None:
        return {
            "available": False,
            "reason": "No 1Click receipt is configured for this vault.",
            "liveness": UNKNOWN,
        }
    state = liveness.get(receipt.asset_id)
    # Unknown is NOT unavailable: a preview asks 1Click for a fresh dry quote. Only a probed
    # no-liquidity answer turns the rail off up front.
    available = state != NO_LIQUIDITY
    reason: str | None = None
    if state == NO_LIQUIDITY:
        reason = "1Click currently reports no liquidity for this receipt."
    elif state == UNKNOWN:
        reason = "Liquidity has not been probed yet; a preview asks 1Click for a dry quote."
    return {
        "available": available,
        "liveness": state,
        "receipt": receipt.wire(),
        "reason": reason,
        "note": _receipt_note(receipt),
        "feeNote": FEE_NOTE,
    }


def _rhea_rail(
    config: EarnConfig, entry: VaultEntry, liveness: ReceiptLivenessCache
) -> dict[str, Any]:
    if not config.rhea.enabled or not config.rails.oneclick_rhea:
        return {
            "available": False,
            "reason": "Rhea lending is disabled in the earn config.",
        }
    asset = config.rhea.asset_for_token(entry.address)
    state = liveness.get(entry.address)
    available = state != NO_LIQUIDITY
    reason: str | None = None
    if state == NO_LIQUIDITY:
        reason = "1Click currently reports no liquidity for this Rhea asset."
    elif state == UNKNOWN:
        reason = "Liquidity has not been probed yet; a preview asks 1Click for a dry quote."
    return {
        "available": available,
        "liveness": state,
        "reason": reason,
        "note": RHEA_NOTE,
        "feeNote": RHEA_FEE_NOTE,
        **({"assetId": asset.asset_id} if asset is not None else {}),
    }


def intents_steps(entry: VaultEntry) -> list[dict[str, Any]]:
    """The native Morpho deposit plan Aurora Intents Connect executes (data only)."""
    return [
        {
            "to": entry.asset.address,
            "functionSignature": "approve(address,uint256)",
            "parameters": [entry.address, "{MIN_AMOUNT_OUT}"],
            "value": "0",
            "metadata": {"kind": "approve", "spender": entry.address},
        },
        {
            "to": entry.address,
            "functionSignature": "deposit(uint256,address)",
            "parameters": ["{MIN_AMOUNT_OUT}", "{USER_ADDRESS}"],
            "value": "0",
            "metadata": {"kind": "deposit", "receiver": "{USER_ADDRESS}"},
        },
    ]


def _intents_rail(
    config: EarnConfig,
    entry: VaultEntry,
    *,
    aurora_key: str | None,
) -> dict[str, Any]:
    if not config.rails.intents_connect:
        return {"available": False, "reason": INTENTS_DISABLED}
    if not aurora_key:
        return {"available": False, "reason": INTENTS_MISSING_KEY}
    if entry.chain == "sol" or not config.intents_connect.supports(
        entry.chain, entry.asset.symbol
    ):
        return {
            "available": False,
            "reason": (
                f"Intents Connect cannot deliver {entry.asset.symbol} on this chain for this "
                "vault."
            ),
        }
    return {
        "available": True,
        "reason": None,
        "steps": intents_steps(entry),
    }


def resolve_rails(
    config: EarnConfig,
    entry: VaultEntry,
    *,
    liveness: ReceiptLivenessCache,
    aurora_key: str | None = None,
) -> RailResolution:
    key = aurora_key if aurora_key is not None else os.getenv(AURORA_KEY_ENV)
    if entry.protocol == "rhea":
        rhea = _rhea_rail(config, entry, liveness)
        available: tuple[str, ...] = (
            ("oneclick_rhea",) if rhea.get("available") else ()
        )
        return RailResolution(
            available=available,
            detail={
                "direct": {"available": False, "reason": RHEA_DIRECT_NOTE},
                "oneclickRhea": rhea,
                "intentsConnect": {
                    "available": False,
                    "reason": "Intents Connect does not apply to Rhea supply.",
                },
            },
        )
    receipt = config.receipt_for_vault(entry.address)
    direct = _direct_rail(config, entry)
    oneclick = _oneclick_rail(config, entry, receipt, liveness)
    intents = _intents_rail(config, entry, aurora_key=key)
    available = tuple(
        name
        for name, rail in (
            ("direct", direct),
            ("oneclick_earn", oneclick),
            ("intents_connect", intents),
        )
        if rail.get("available")
    )
    return RailResolution(
        available=available,
        detail={
            "direct": direct,
            "oneclickEarn": oneclick,
            "intentsConnect": intents,
        },
    )


async def probe_receipts(
    config: EarnConfig,
    client: OneClickClient,
    crosschain_config: CrossChainConfig,
    liveness: ReceiptLivenessCache,
) -> None:
    """Dry-quote 100 USDC → each configured receipt and cache live/no-liquidity.

    This is a BACKGROUND/SCRIPT call only: no request handler may call 1Click for liveness.
    """
    origin = crosschain_config.default_for_symbol("USDC")
    if origin is None:
        return
    amount_raw = 100 * 10**origin.decimals
    for receipt in config.receipts:
        recipient_kind: AddressKind = "sol" if receipt.chain == "sol" else "evm"
        recipient = (
            config.dry_probe_addresses.get("sol")
            if recipient_kind == "sol"
            else None
        ) or placeholder_for(recipient_kind)
        refund_to = (
            config.dry_probe_addresses.get("sol")
            if origin.address_kind == "sol"
            else None
        ) or placeholder_for(origin.address_kind)
        try:
            await client.quote(
                dry=True,
                origin_asset=origin.asset_id,
                destination_asset=receipt.asset_id,
                amount=str(amount_raw),
                slippage_bps=crosschain_config.slippage_bps,
                deadline=deadline_at(crosschain_config.deadline_minutes),
                refund_to=refund_to,
                recipient=recipient,
            )
        except QuoteUnavailable:
            liveness.set(receipt.asset_id, NO_LIQUIDITY)
        except Exception:  # noqa: BLE001, S112 — liveness is advisory; keep previous value
            continue
        else:
            liveness.set(receipt.asset_id, LIVE)
