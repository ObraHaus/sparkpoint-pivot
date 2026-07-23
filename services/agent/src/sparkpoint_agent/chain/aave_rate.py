"""Live Aave v3 USDC supply APY read (RAY→bps). Read-only, keyless, fail-closed.

MIRRORS apps/web/src/lib/chain/aaveApy.ts — keep the two conversions in sync.
"""

from __future__ import annotations

import eth_abi

from .vault_reader import (
    JsonRpcTransport,
    VaultUnavailable,
    VaultUnavailableReason,
    _normalize_address,
)

RAY = 10**27
SECONDS_PER_YEAR = 31_536_000
_GET_RESERVE_DATA_SELECTOR = (
    "0x35ea6a75"  # getReserveData(address) — Aave v3 IPool (stable v3.0–v3.2)
)
_RESERVE_DATA_TUPLE = (  # ReserveData(Legacy); currentLiquidityRate = index 2 (RAY APR)
    "(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,"
    "address,address,address,address,uint128,uint128,uint128)"
)
_CURRENT_LIQUIDITY_RATE_INDEX = 2


def supply_apy_bps_from_ray(rate_ray: int) -> int:
    """RAY annual APR → compounded supply APY in bps (per-second compounding, as Aave's UI)."""
    if rate_ray <= 0:
        return 0
    apr = rate_ray / RAY
    apy = (1 + apr / SECONDS_PER_YEAR) ** SECONDS_PER_YEAR - 1
    return round(apy * 10_000)


class AavePoolReader:
    """eth_call getReserveData on the Aave v3 Pool → live USDC supply APY (bps). Fail-closed."""

    def __init__(self, *, pool_address: str, transport: JsonRpcTransport) -> None:
        self._pool = pool_address.lower()
        self._transport = transport

    async def supply_apy_bps(self, asset: str) -> int:
        data = (
            _GET_RESERVE_DATA_SELECTOR
            + eth_abi.encode(["address"], [_normalize_address(asset)]).hex()
        )
        result = await self._transport.call(
            "eth_call", [{"to": self._pool, "data": data}, "latest"]
        )
        if result in ("0x", ""):
            raise VaultUnavailable(
                VaultUnavailableReason.NOT_DEPLOYED, "Aave pool: empty getReserveData (no code?)."
            )
        try:
            raw = bytes.fromhex(result[2:] if result.startswith("0x") else result)
            decoded = eth_abi.decode([_RESERVE_DATA_TUPLE], raw)
        except Exception as exc:
            raise VaultUnavailable(
                VaultUnavailableReason.RPC_UNREACHABLE,
                "Aave pool: could not decode getReserveData.",
            ) from exc
        return supply_apy_bps_from_ray(int(decoded[0][_CURRENT_LIQUIDITY_RATE_INDEX]))
