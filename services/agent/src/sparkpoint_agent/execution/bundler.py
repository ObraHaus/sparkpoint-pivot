"""Minimal ERC-4337 v0.7 bundler client for the session-key submission path (feature 022 US6).

Talks to the Base-Sepolia Alchemy bundler (Rundler) — the SAME endpoint as the RPC url — to submit a
CLIENT-signed session-key UserOp and resolve its receipt. Submit/read only: the service holds no key
and signs nothing (N3) — the signed UserOp arrives from the client. A bundler rejection (e.g. an
ERC-7562 validation error) is surfaced VERBATIM via ``BundlerError`` so the API reports it
(Principle III — never a fabricated success). Proven live on Base Sepolia (feature 022:
`eth_sendUserOperation` accepted a mode-0x01 UserOp that then executed on-chain).
"""

from __future__ import annotations

from typing import Any

import httpx

_TIMEOUT_S = 30.0


class BundlerError(Exception):
    """A bundler REJECTED the UserOp. Carries the verbatim message + JSON-RPC code."""

    def __init__(self, message: str, code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


async def _bundler_rpc(
    bundler_url: str, method: str, params: list[Any]
) -> tuple[Any, dict[str, Any] | None]:
    """One JSON-RPC call → ``(result, error)``. Transport errors propagate (transient/retryable); a
    JSON-RPC ``error`` is returned as the second element (a bundler rejection, not transport)."""
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        resp = await client.post(bundler_url, json=payload)
        resp.raise_for_status()
        body = resp.json()
    if not isinstance(body, dict):
        return None, {"message": "malformed bundler response"}
    err = body.get("error")
    if isinstance(err, dict):
        return None, err
    return body.get("result"), None


async def send_user_op(bundler_url: str, user_op: dict[str, Any], entry_point: str) -> str:
    """``eth_sendUserOperation`` → the userOpHash. Raises ``BundlerError`` on a bundler rejection
    (e.g. an ERC-7562 validation failure); transport errors propagate for a retryable degrade."""
    result, err = await _bundler_rpc(bundler_url, "eth_sendUserOperation", [user_op, entry_point])
    if err is not None:
        raise BundlerError(
            str(err.get("message", "bundler rejected the UserOp")),
            err.get("code") if isinstance(err.get("code"), int) else None,
        )
    if not isinstance(result, str):
        raise BundlerError("bundler returned no userOpHash")
    return result


async def get_user_op_receipt(bundler_url: str, user_op_hash: str) -> dict[str, Any] | None:
    """``eth_getUserOperationReceipt`` → the receipt (``success``, ``receipt`` with tx hash/block…),
    or None when not yet bundled / on any transport-or-RPC error (best-effort, never fabricates)."""
    try:
        result, err = await _bundler_rpc(
            bundler_url, "eth_getUserOperationReceipt", [user_op_hash]
        )
    except (httpx.HTTPError, ValueError):
        return None
    if err is not None or not isinstance(result, dict):
        return None
    return result


async def estimate_user_op_gas(
    bundler_url: str, user_op: dict[str, Any], entry_point: str
) -> dict[str, Any] | None:
    """``eth_estimateUserOperationGas`` → the recommended gas limits, or None on error."""
    try:
        result, err = await _bundler_rpc(
            bundler_url, "eth_estimateUserOperationGas", [user_op, entry_point]
        )
    except (httpx.HTTPError, ValueError):
        return None
    if err is not None or not isinstance(result, dict):
        return None
    return result


async def supported_entry_points(bundler_url: str) -> list[str]:
    """``eth_supportedEntryPoints`` → the EntryPoints the bundler serves (a liveness probe)."""
    try:
        result, err = await _bundler_rpc(bundler_url, "eth_supportedEntryPoints", [])
    except (httpx.HTTPError, ValueError):
        return []
    if err is not None or not isinstance(result, list):
        return []
    return [str(a) for a in result]
