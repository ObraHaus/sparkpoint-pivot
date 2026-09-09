# ruff: noqa: S101
"""Live Aave v3 supply-rate read (RAY→APY bps) — pure conversion + eth_call decode, no network."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import eth_abi
import pytest

from sparkpoint_agent.chain.aave_rate import (
    AavePoolReader,
    supply_apy_bps_from_ray,
)
from sparkpoint_agent.chain.vault_reader import VaultUnavailable

_ADDR = "0x0000000000000000000000000000000000000000"


def _encode_reserve_data(current_liquidity_rate: int) -> str:
    """A ReserveData(Legacy) tuple: currentLiquidityRate at index 2, everything else zeroed."""
    fields = (
        0,  # configuration (uint256)
        0,  # liquidityIndex (uint128)
        current_liquidity_rate,  # currentLiquidityRate (uint128, RAY APR) — index 2
        0,
        0,
        0,  # variableBorrowIndex, currentVariableBorrowRate, currentStableBorrowRate
        0,
        0,  # lastUpdateTimestamp (uint40), id (uint16)
        _ADDR,
        _ADDR,
        _ADDR,
        _ADDR,  # aToken, stableDebt, variableDebt, interestRateStrategy
        0,
        0,
        0,  # accruedToTreasury, unbacked, isolationModeTotalDebt
    )
    tuple_type = (
        "(uint256,uint128,uint128,uint128,uint128,uint128,uint40,uint16,"
        "address,address,address,address,uint128,uint128,uint128)"
    )
    return "0x" + eth_abi.encode([tuple_type], [fields]).hex()


class _FakeTransport:
    def __init__(self, result: str) -> None:
        self._result = result

    async def call(self, method: str, params: Sequence[Any]) -> str:
        assert method == "eth_call"
        return self._result


def test_supply_apy_bps_from_ray_zero_is_zero() -> None:
    assert supply_apy_bps_from_ray(0) == 0
    assert supply_apy_bps_from_ray(-1) == 0


def test_supply_apy_bps_from_ray_compounds_a_known_rate() -> None:
    # 4.3% APR in RAY → ~4.39% APY (per-second compounding) → ~439 bps.
    bps = supply_apy_bps_from_ray(43 * 10**24)  # 0.043 * 1e27
    assert 435 <= bps <= 445


@pytest.mark.asyncio
async def test_reader_decodes_current_liquidity_rate() -> None:
    reader = AavePoolReader(
        pool_address="0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27",
        transport=_FakeTransport(_encode_reserve_data(43 * 10**24)),
    )
    bps = await reader.supply_apy_bps("0xba50933c268f567bdc86e1ac131be072c6b0b71a")
    assert 435 <= bps <= 445


@pytest.mark.asyncio
async def test_reader_zero_rate_reads_zero_bps() -> None:
    reader = AavePoolReader(pool_address=_ADDR, transport=_FakeTransport(_encode_reserve_data(0)))
    assert await reader.supply_apy_bps(_ADDR) == 0


@pytest.mark.asyncio
async def test_reader_empty_result_is_unavailable() -> None:
    reader = AavePoolReader(pool_address=_ADDR, transport=_FakeTransport("0x"))
    with pytest.raises(VaultUnavailable):
        await reader.supply_apy_bps(_ADDR)
