"""Minimal JSON-RPC reads for the submit/status path (feature 019 US2).

Two read-only calls: ``eth_getTransactionByHash`` (to byte-match a submitted tx against the issued
bundle) and ``eth_getTransactionReceipt`` (to resolve pending → confirmed/failed). Read-only, holds
no key, signs nothing (N3). An RPC outage returns ``None`` (best-effort) — it NEVER blocks the exit
(N2) and never fabricates a status.
"""

from __future__ import annotations

from typing import Any

import eth_abi
import httpx

_TIMEOUT_S = 15.0
_GET_NONCE_SELECTOR = "0x35567e1a"  # getNonce(address,uint192) on the ERC-4337 EntryPoint


async def _rpc(rpc_url: str, method: str, params: list[Any]) -> Any:
    """One JSON-RPC call; returns ``result`` (or None on any transport/RPC error — best-effort)."""
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
            resp = await client.post(rpc_url, json=payload)
            resp.raise_for_status()
            body = resp.json()
    except (httpx.HTTPError, ValueError):
        return None
    if not isinstance(body, dict) or body.get("error") is not None:
        return None
    return body.get("result")


async def get_transaction(rpc_url: str, tx_hash: str) -> dict[str, Any] | None:
    """``eth_getTransactionByHash`` → the tx object (``to``/``input``/``from``…), or None."""
    result = await _rpc(rpc_url, "eth_getTransactionByHash", [tx_hash])
    return result if isinstance(result, dict) else None


async def get_receipt(rpc_url: str, tx_hash: str) -> dict[str, Any] | None:
    """``eth_getTransactionReceipt`` → the receipt (``status``/``blockNumber``…), or None
    when not yet mined / unreachable."""
    result = await _rpc(rpc_url, "eth_getTransactionReceipt", [tx_hash])
    return result if isinstance(result, dict) else None


async def get_nonce(rpc_url: str, entry_point: str, sender: str) -> int | None:
    """The account's ERC-4337 nonce (key 0) via ``EntryPoint.getNonce(sender, 0)`` — read-only
    ``eth_call``, signs nothing (N3). None on any transport/RPC error (best-effort)."""
    data = _GET_NONCE_SELECTOR + eth_abi.encode(["address", "uint192"], [sender, 0]).hex()
    result = await _rpc(rpc_url, "eth_call", [{"to": entry_point, "data": data}, "latest"])
    if not isinstance(result, str):
        return None
    try:
        return int(result, 16)
    except ValueError:
        return None
