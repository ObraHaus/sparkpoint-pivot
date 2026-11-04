"""Destination/refund address validation per chain family.

These are FORMAT checks only. 1Click remains the source of truth for whether an address is
usable; a valid shape here keeps obvious mistakes out of a quote and out of the persisted row.
Nothing here is authority to move funds — the user signs the originating transaction themselves.
"""

from __future__ import annotations

import re

from .config import AddressKind

_EVM_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_BTC_BECH32_RE = re.compile(r"^(?:bc1|tb1)[02-9ac-hj-np-z]{11,71}$")
_BTC_BASE58_RE = re.compile(r"^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$")
_SOL_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")
_TRON_RE = re.compile(r"^T[1-9A-HJ-NP-Za-km-z]{33}$")
_NEAR_IMPLICIT_RE = re.compile(r"^[0-9a-f]{64}$")
_NEAR_HEX_ONLY_RE = re.compile(r"^[0-9a-f]+$")
_NEAR_NAMED_RE = re.compile(r"^(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$")

#: Placeholders used ONLY for a dry preview. 1Click validates the recipient even when
#: ``dry=true``; the real destination is collected (and validated) at confirm time.
_PLACEHOLDERS: dict[AddressKind, str] = {
    "evm": "0x0000000000000000000000000000000000000001",
    "btc": "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
    "sol": "So11111111111111111111111111111111111111112",
    "tron": "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7",
    "near": "sparkpoint.near",
}


def placeholder_for(kind: AddressKind) -> str:
    return _PLACEHOLDERS[kind]


def is_valid_address(value: str, kind: AddressKind) -> bool:
    """True when ``value`` has the expected shape for ``kind``."""
    candidate = value.strip()
    if not candidate:
        return False
    if kind == "evm":
        return bool(_EVM_RE.match(candidate))
    if kind == "btc":
        return bool(_BTC_BECH32_RE.match(candidate) or _BTC_BASE58_RE.match(candidate))
    if kind == "sol":
        return bool(_SOL_RE.match(candidate))
    if kind == "tron":
        return bool(_TRON_RE.match(candidate))
    if kind == "near":
        if _NEAR_IMPLICIT_RE.match(candidate):
            return True
        # Hex-only is an implicit account by intent: only the exact 64-char form is valid.
        if _NEAR_HEX_ONLY_RE.match(candidate):
            return False
        return bool(_NEAR_NAMED_RE.match(candidate))
    return False


def expected_address_description(kind: AddressKind) -> str:
    """A short human description used in 400 messages."""
    return {
        "evm": "a 20-byte 0x address",
        "btc": "a Bitcoin bech32 or base58 address",
        "sol": "a base58 Solana address (32–44 characters)",
        "tron": "a Tron address (T + 33 base58 characters)",
        "near": "a NEAR account id",
    }[kind]
