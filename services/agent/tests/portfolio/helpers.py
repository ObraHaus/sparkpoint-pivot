# ruff: noqa: S101
"""Small, offline builders for the 072 portfolio tests (no network, no DB)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal

from sparkpoint_agent.data.prices import PriceQuote, PriceSnapshot
from sparkpoint_agent.portfolio.config import EvmChainConfig, PortfolioConfig, TokenConfig
from sparkpoint_agent.portfolio.models import PortfolioRow, PortfolioSection

BASE_TOKEN = TokenConfig(
    symbol="USDC",
    address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    decimals=6,
    stable=True,
)
BASE_WETH = TokenConfig(
    symbol="WETH",
    address="0x4200000000000000000000000000000000000006",
    decimals=18,
    price_symbol="ETH",
)
BASE_CBBTC = TokenConfig(
    symbol="cbBTC",
    address="0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
    decimals=8,
    price_symbol="BTC",
)


def base_chain(rpc: str | None = "https://base.invalid") -> EvmChainConfig:
    return EvmChainConfig(
        key="base",
        label="Base",
        chain_id=8453,
        rpc_url=rpc,
        tokens=(BASE_TOKEN, BASE_WETH, BASE_CBBTC),
    )


def eth_chain(rpc: str | None = None) -> EvmChainConfig:
    return EvmChainConfig(
        key="eth",
        label="Ethereum",
        chain_id=1,
        rpc_url=rpc,
        tokens=(BASE_TOKEN, BASE_WETH, BASE_CBBTC),
    )


def config(
    base: EvmChainConfig | None = None, eth: EvmChainConfig | None = None
) -> PortfolioConfig:
    return PortfolioConfig(
        base=base or base_chain(),
        eth=eth or eth_chain(),
        solana_rpc_url="https://sol.invalid",
        morpho_api_url="https://morpho.invalid/graphql",
        timeout_s=0.5,
        cache_ttl_s=0,
    )


def quote(symbol: str, usd: str) -> PriceQuote:
    return PriceQuote(
        symbol=symbol,
        usd=float(usd),
        source=f"{symbol.lower()}_test",
        as_of=datetime(2026, 11, 1, tzinfo=UTC),
    )


class FakePricer:
    """A fixed PriceSnapshot; records the symbol asks."""

    def __init__(self, quotes: Mapping[str, PriceQuote] | None = None) -> None:
        self.quotes = dict(quotes or {"ETH": quote("ETH", "2000"), "BTC": quote("BTC", "60000")})
        self.asked: list[tuple[str, ...]] = []

    async def get(self, symbols: Sequence[str]) -> PriceSnapshot:
        self.asked.append(tuple(symbols))
        found = {symbol: self.quotes[symbol] for symbol in symbols if symbol in self.quotes}
        return PriceSnapshot(quotes=found)


def row(
    *,
    chain: str = "base",
    label: str = "Base",
    protocol: str = "wallet",
    symbol: str = "USDC",
    amount: str = "100",
    value: str | None = "100.00",
) -> PortfolioRow:
    return PortfolioRow(
        chain=chain,
        chain_label=label,
        protocol=protocol,
        kind="token",
        symbol=symbol,
        amount=amount,
        value_usd=value,
        price_source="stablecoin_par" if value is not None else "unavailable",
    )


def section(
    key: str,
    *,
    status: str = "ok",
    rows: tuple[PortfolioRow, ...] = (),
    reason: str | None = None,
    source: str | None = None,
) -> PortfolioSection:
    return PortfolioSection(
        key=key,  # type: ignore[arg-type]
        label=key.title(),
        status=status,  # type: ignore[arg-type]
        rows=rows,
        reason=reason,
        source=source,
    )


def usd(value: str | None) -> Decimal | None:
    return Decimal(value) if value is not None else None
