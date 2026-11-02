# ruff: noqa: S101
"""072 — Kamino reads only owner-linked Solana addresses (mocked RPC, no network)."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

import httpx
import pytest

from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.registry import EarnRegistry
from sparkpoint_agent.portfolio.kamino import NOT_LINKED_COPY, KaminoPositionsSource

from .helpers import FakePricer, config

WALLET = "0x2222222222222222222222222222222222222222"
SOL_ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"


def _solana(amount: str = "1000000000") -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = __import__("json").loads(request.content)
        assert body["method"] == "getTokenAccountsByOwner"
        assert body["params"][0] == SOL_ADDRESS
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": "sparkpoint-072",
                "result": {
                    "value": [
                        {
                            "account": {
                                "data": {
                                    "parsed": {
                                        "info": {
                                            "tokenAmount": {
                                                "amount": amount,
                                                "decimals": 9,
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    ]
                },
            },
        )

    return httpx.MockTransport(handler)


def _registry() -> EarnRegistry:
    return EarnRegistry(default_config(), writable_path=Path("/nonexistent/earn.json"))


async def _linked(_: str) -> tuple[str, ...]:
    return (SOL_ADDRESS,)


@pytest.mark.asyncio
async def test_linked_address_reads_the_configured_share_mint() -> None:
    source = KaminoPositionsSource(
        config(),
        earn_config=default_config(),
        registry=_registry(),
        linked=_linked,
        pricer=FakePricer(),
        transport=_solana(),
    )
    section = await source.collect(WALLET)
    assert section.status == "ok"
    assert section.source == "solana_rpc"
    assert len(section.rows) == 1
    row = section.rows[0]
    assert row.symbol == "kV-SOL"
    assert row.amount == "1"
    assert row.value_usd is None
    assert row.price_source == "kamino_share_price_unavailable"
    assert row.extra["wallet"] == SOL_ADDRESS


@pytest.mark.asyncio
async def test_no_linked_address_is_not_linked_with_the_phase_c_copy() -> None:
    async def none(_: str) -> tuple[str, ...]:
        return ()

    source = KaminoPositionsSource(
        config(),
        earn_config=default_config(),
        registry=_registry(),
        linked=none,
    )
    section = await source.collect(WALLET)
    assert section.status == "not_linked"
    assert section.reason == NOT_LINKED_COPY
    assert section.rows == ()


@pytest.mark.asyncio
async def test_solana_rpc_failure_is_unavailable() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    source = KaminoPositionsSource(
        config(),
        earn_config=default_config(),
        registry=_registry(),
        linked=_linked,
        transport=httpx.MockTransport(broken),
    )
    section = await source.collect(WALLET)
    assert section.status == "unavailable"


@pytest.mark.asyncio
async def test_kamino_disabled_in_config_is_unavailable() -> None:
    earn_cfg = replace(default_config(), kamino=replace(default_config().kamino, enabled=False))
    source = KaminoPositionsSource(
        config(),
        earn_config=earn_cfg,
        registry=_registry(),
        linked=_linked,
    )
    section = await source.collect(WALLET)
    assert section.status == "unavailable"
    assert "not enabled" in (section.reason or "")
