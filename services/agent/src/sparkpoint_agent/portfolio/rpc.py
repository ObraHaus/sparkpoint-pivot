"""Minimal read-only JSON-RPC clients for the multi-chain portfolio.

Only two shapes are needed:

* EVM ``eth_getBalance`` + ERC-20 ``balanceOf`` (``eth_call``) for the session wallet's Base and
  Ethereum balances;
* Solana ``getTokenAccountsByOwner`` for a kVault share mint the owner is already linked to.

Both are keyless and VIEW-only. There is no transaction method here — a raw JSON-RPC call can only
ever be one of the two read methods above because the method name is supplied by the caller, not the
client. ``transport`` is injectable so tests stay offline.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

import eth_abi
import httpx

USER_AGENT = "sparkpoint-agent/1.0"
#: ERC-20 ``balanceOf(address)`` selector (pinned, no hash dependency).
_BALANCE_OF_SELECTOR = "0x70a08231"


class PortfolioRpcError(RuntimeError):
    """A read could not produce a real value (transport, HTTP or JSON-RPC failure)."""


def _rpc_error(response: httpx.Response) -> PortfolioRpcError:
    return PortfolioRpcError(f"RPC HTTP {response.status_code}")


class EvmRpc:
    """A small async EVM JSON-RPC client (``eth_getBalance`` / ``eth_call`` only)."""

    def __init__(
        self,
        url: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_s: float = 6.0,
    ) -> None:
        self._url = url
        self._transport = transport
        self._timeout_s = timeout_s

    async def call(self, method: str, params: Sequence[Any]) -> str:
        payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": list(params)}
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout_s,
                transport=self._transport,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            ) as client:
                response = await client.post(self._url, json=payload)
        except httpx.HTTPError as exc:
            raise PortfolioRpcError(f"RPC transport error: {type(exc).__name__}") from exc
        if response.status_code != 200:
            raise _rpc_error(response)
        try:
            body: Any = response.json()
        except ValueError as exc:
            raise PortfolioRpcError("RPC returned non-JSON") from exc
        if not isinstance(body, Mapping):
            raise PortfolioRpcError("RPC response is not a JSON object")
        if body.get("error") is not None:
            raise PortfolioRpcError("RPC returned an error")
        result = body.get("result")
        if not isinstance(result, str):
            raise PortfolioRpcError("RPC response is missing a string result")
        return result

    async def native_balance(self, owner: str) -> int:
        result = await self.call("eth_getBalance", [owner, "latest"])
        try:
            return int(result, 16)
        except (TypeError, ValueError) as exc:
            raise PortfolioRpcError("eth_getBalance returned a non-hex quantity") from exc

    async def token_balance(self, token: str, owner: str) -> int:
        data = _BALANCE_OF_SELECTOR + eth_abi.encode(["address"], [owner]).hex()
        result = await self.call("eth_call", [{"to": token, "data": data}, "latest"])
        if result in ("0x", ""):
            raise PortfolioRpcError("eth_call returned no data")
        try:
            raw = bytes.fromhex(result[2:] if result.startswith("0x") else result)
            decoded = eth_abi.decode(["uint256"], raw)
        except Exception as exc:  # noqa: BLE001 - malformed/short hex, ABI mismatch
            raise PortfolioRpcError("eth_call could not be decoded") from exc
        return int(decoded[0])


class SolanaRpc:
    """``getTokenAccountsByOwner`` for one mint, with an injectable transport."""

    def __init__(
        self,
        url: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout_s: float = 6.0,
    ) -> None:
        self._url = url
        self._transport = transport
        self._timeout_s = timeout_s

    async def token_accounts(self, owner: str, mint: str) -> list[Mapping[str, Any]]:
        payload = {
            "jsonrpc": "2.0",
            "id": "sparkpoint-072",
            "method": "getTokenAccountsByOwner",
            "params": [owner, {"mint": mint}, {"encoding": "jsonParsed"}],
        }
        try:
            async with httpx.AsyncClient(
                timeout=self._timeout_s,
                transport=self._transport,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
            ) as client:
                response = await client.post(self._url, json=payload)
        except httpx.HTTPError as exc:
            raise PortfolioRpcError(f"Solana transport error: {type(exc).__name__}") from exc
        if response.status_code != 200:
            raise _rpc_error(response)
        try:
            body: Any = response.json()
        except ValueError as exc:
            raise PortfolioRpcError("Solana returned non-JSON") from exc
        if not isinstance(body, Mapping):
            raise PortfolioRpcError("Solana response is not a JSON object")
        if body.get("error") is not None:
            raise PortfolioRpcError("Solana returned an error")
        result = body.get("result")
        value = result.get("value") if isinstance(result, Mapping) else None
        if not isinstance(value, list):
            raise PortfolioRpcError("Solana response is missing a value list")
        return [item for item in value if isinstance(item, Mapping)]


__all__ = ["EvmRpc", "PortfolioRpcError", "SolanaRpc"]
