"""Fail-closed chain-read layer for the SparkPoint vault surface.

Read-only, keyless access to the on-chain ERC-4626 vault (the source of truth). The
vault reader issues ONLY ``eth_call`` (view/pure) and ``eth_blockNumber`` — never a
state-changing/signing RPC — so it is PROVABLY non-custodial (N1/N2). Preview/convert
values are read straight from chain and never re-derived in Python, so they mirror the
vault's EIP-4626 rounding (round-DOWN in the vault's favor) exactly.
"""

from __future__ import annotations

from .vault_reader import (
    HttpxJsonRpcTransport,
    JsonRpcTransport,
    VaultReader,
    VaultUnavailable,
    VaultUnavailableReason,
    load_vault_methods,
)

__all__ = [
    "HttpxJsonRpcTransport",
    "JsonRpcTransport",
    "VaultReader",
    "VaultUnavailable",
    "VaultUnavailableReason",
    "load_vault_methods",
]
