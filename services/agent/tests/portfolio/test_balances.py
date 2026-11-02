# ruff: noqa: S101
"""072 — Base/Ethereum wallet balances (mocked JSON-RPC, no network)."""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

import httpx
import pytest

from sparkpoint_agent.portfolio.balances import BalanceSource
from sparkpoint_agent.portfolio.config import EvmChainConfig, PortfolioConfig

from .helpers import BASE_CBBTC, BASE_TOKEN, BASE_WETH, FakePricer, base_chain, config, eth_chain

WALLET = "0x2222222222222222222222222222222222222222"


def _uint(value: int) -> str:
    return "0x" + format(value, "064x")


def _balances_handler(raw: Mapping[str, int], native: int) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["method"] == "eth_getBalance":
            return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": hex(native)})
        to = str(body["params"][0]["to"]).lower()
        value = raw.get(to, 0)
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": _uint(value)})

    return handler


def _source(
    balances: Mapping[str, int],
    *,
    native: int,
    cfg: PortfolioConfig | None = None,
) -> BalanceSource:
    transport = httpx.MockTransport(_balances_handler(balances, native))
    return BalanceSource(
        cfg or config(),
        FakePricer(),
        transports={"base": transport, "eth": transport},
    )


@pytest.mark.asyncio
async def test_reads_native_and_tokens_with_correct_decimals_and_prices() -> None:
    source = _source(
        {
            BASE_TOKEN.address.lower(): 100_000_000,  # 100 USDC
            BASE_WETH.address.lower(): 500_000_000_000_000_000,  # 0.5 WETH
            BASE_CBBTC.address.lower(): 0,  # zero rows are omitted
        },
        native=1_000_000_000_000_000_000,
    )
    section = await source.collect(WALLET)

    assert section.status == "ok"
    assert section.source == "rpc"
    by_symbol = {row.symbol: row for row in section.rows}
    assert by_symbol["ETH"].amount == "1"
    assert by_symbol["ETH"].value_usd == "2000.00"
    assert by_symbol["ETH"].kind == "native"
    assert by_symbol["USDC"].amount == "100"
    assert by_symbol["USDC"].value_usd == "100.00"
    assert by_symbol["USDC"].price_source == "stablecoin_par"
    assert by_symbol["WETH"].amount == "0.5"
    assert by_symbol["WETH"].value_usd == "1000.00"
    assert "cbBTC" not in by_symbol

    chains = {item["chain"]: item for item in section.meta["chains"]}
    assert chains["base"]["status"] == "ok"
    assert chains["eth"]["status"] == "unavailable"
    assert chains["eth"]["reason"] == "not configured"


@pytest.mark.asyncio
async def test_no_configured_rpc_is_an_honest_unavailable_section() -> None:
    cfg = PortfolioConfig(
        base=base_chain(rpc=None),
        eth=eth_chain(rpc=None),
        solana_rpc_url="https://sol.invalid",
        morpho_api_url="https://morpho.invalid/graphql",
    )
    section = await BalanceSource(cfg, FakePricer()).collect(WALLET)
    assert section.status == "unavailable"
    assert section.reason == "not configured"


@pytest.mark.asyncio
async def test_rpc_failure_degrades_the_chain_not_the_whole_read() -> None:
    def broken(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    cfg = config()
    source = BalanceSource(
        cfg,
        FakePricer(),
        transports={"base": httpx.MockTransport(broken)},
    )
    section = await source.collect(WALLET)
    assert section.status == "unavailable"
    assert section.rows == ()
    assert "transport" in (section.reason or "").lower()


@pytest.mark.asyncio
async def test_ethereum_read_when_its_rpc_is_configured() -> None:
    handler = _balances_handler({BASE_TOKEN.address.lower(): 7_000_000}, native=0)
    eth = EvmChainConfig(
        key="eth",
        label="Ethereum",
        chain_id=1,
        rpc_url="https://eth.invalid",
        tokens=(BASE_TOKEN,),
    )
    cfg = config(base=base_chain(rpc=None), eth=eth)
    source = BalanceSource(
        cfg,
        FakePricer(),
        transports={"base": httpx.MockTransport(handler), "eth": httpx.MockTransport(handler)},
    )
    section = await source.collect(WALLET)
    assert section.status == "ok"
    assert [(row.chain, row.symbol, row.amount) for row in section.rows] == [("eth", "USDC", "7")]
