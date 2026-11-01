# ruff: noqa: S101
"""072 — Morpho positions (mocked GraphQL + registry join)."""

from __future__ import annotations

import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path

import httpx
import pytest

from sparkpoint_agent.earn.config import OneClickReceipt, default_config
from sparkpoint_agent.earn.registry import EarnRegistry, VaultAsset, VaultEntry
from sparkpoint_agent.portfolio.morpho import MorphoPositionsSource

from .helpers import FakePricer, config

WALLET = "0x2222222222222222222222222222222222222222"
VAULT = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61"
USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"


def _registry() -> EarnRegistry:
    cfg = default_config()
    registry = EarnRegistry(cfg, writable_path=Path("/nonexistent/earn.json"))
    from datetime import UTC, datetime

    from sparkpoint_agent.earn.registry import EarnSnapshot

    registry.install(
        EarnSnapshot(
            fetched_at=datetime(2026, 11, 1, tzinfo=UTC),
            source="morpho_api",
            vaults=(
                VaultEntry(
                    chain="base",
                    chain_id=8453,
                    address=VAULT,
                    version="v1",
                    name="Gauntlet USDC Prime",
                    symbol="GTUSDC",
                    asset=VaultAsset(address=USDC, symbol="USDC", decimals=6),
                    listed=True,
                    tvl_usd=Decimal("420747952"),
                    net_apy=Decimal("0.0441"),
                    fetched_at="2026-11-01T00:00:00+00:00",
                ),
            ),
        )
    )
    return registry


def _graphql(positions: list[dict[str, object]]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "userByAddress" in body["query"]
        return httpx.Response(
            200,
            json={
                "data": {
                    "eth": None,
                    "base": {"vaultPositions": positions},
                }
            },
        )

    return httpx.MockTransport(handler)


def _position() -> dict[str, object]:
    return {
        "state": {"shares": "100000000", "assets": "100000000"},
        "vault": {
            "address": VAULT,
            "name": "API Name",
            "symbol": "API",
            "chain": {"id": 8453},
            "asset": {"address": USDC, "symbol": "USDC", "decimals": 6},
            "state": {"netApy": "0.05"},
        },
    }


@pytest.mark.asyncio
async def test_positions_join_the_registry_for_name_and_apy() -> None:
    earn_cfg = replace(default_config(), receipts=())
    source = MorphoPositionsSource(
        config(),
        registry=_registry(),
        earn_config=earn_cfg,
        pricer=FakePricer(),
        transport=_graphql([_position()]),
    )
    section = await source.collect(WALLET)
    assert section.status == "ok"
    assert len(section.rows) == 1
    row = section.rows[0]
    assert row.chain == "base"
    assert row.protocol == "morpho"
    assert row.symbol == "GTUSDC"  # registry wins over the API's placeholder
    assert row.amount == "100"
    assert row.value_usd == "100.00"
    assert row.price_source == "stablecoin_par"
    assert row.extra["vaultName"] == "Gauntlet USDC Prime"
    assert row.extra["netApy"] == "4.41"
    assert row.extra["rail"] == "direct"


@pytest.mark.asyncio
async def test_graphql_failure_is_an_unavailable_section() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"errors": [{"message": "too complex"}]})

    source = MorphoPositionsSource(
        config(),
        registry=_registry(),
        earn_config=replace(default_config(), receipts=()),
        transport=httpx.MockTransport(handler),
    )
    section = await source.collect(WALLET)
    assert section.status == "unavailable"
    assert "Morpho" in (section.reason or "")


@pytest.mark.asyncio
async def test_oneclick_receipt_holding_is_read_over_rpc_and_par_valued() -> None:
    receipt = OneClickReceipt(
        symbol="gtUSDCp",
        asset_id="nep141:base-0x0bb69b79bc829e1cfcc34a740110886d98d2bd14.omft.near",
        decimals=18,
        chain="base",
        wrapper_address="0x0bb69b79bc829e1cfcc34a740110886d98d2bd14",
        underlying_vault=VAULT,
    )
    earn_cfg = replace(default_config(), receipts=(receipt,))

    def rpc(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert body["method"] == "eth_call"
        return httpx.Response(
            200,
            json={"jsonrpc": "2.0", "id": 1, "result": "0x" + format(10**18, "064x")},
        )

    source = MorphoPositionsSource(
        config(),
        registry=_registry(),
        earn_config=earn_cfg,
        transport=_graphql([]),
        rpc_transports={"base": httpx.MockTransport(rpc)},
    )
    section = await source.collect(WALLET)
    assert section.status == "ok"
    assert [row.kind for row in section.rows] == ["oneclick_receipt"]
    receipt_row = section.rows[0]
    assert receipt_row.symbol == "gtUSDCp"
    assert receipt_row.amount == "1"
    assert receipt_row.value_usd == "1.00"
    assert receipt_row.extra["note"].startswith("1Click Earn receipt")
