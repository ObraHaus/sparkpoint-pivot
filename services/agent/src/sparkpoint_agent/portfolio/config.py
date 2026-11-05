"""Feature 072 — configuration for the read-only multi-chain portfolio.

Everything here is display/read data: RPC endpoints, token address books, timeouts and a couple
of demo bounds. No key material is read or stored. A missing RPC is a first-class state — the
section says ``not configured`` rather than silently reading another chain.

Base mainnet is deliberately read from ``BASE_MAINNET_RPC_URL`` (never ``SPARKPOINT_RPC_URL``,
which may point at a local fork). Ethereum is read only when ``ETHEREUM_RPC_URL`` is set, exactly
as 072 requires. Solana is a public JSON-RPC endpoint and is only called when the signed-in owner
has a Solana recipient already recorded in their own cross-chain quotes.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field

from ..config import env_flag

BASE_MAINNET_RPC_ENV = "BASE_MAINNET_RPC_URL"
ETHEREUM_RPC_ENV = "ETHEREUM_RPC_URL"
ETHEREUM_RPC_FALLBACK_ENV = "ETH_MAINNET_RPC_URL"
SOLANA_RPC_ENV = "SOLANA_RPC_URL"
MORPHO_API_ENV = "MORPHO_API_URL"
SWAP_STATUS_REFRESH_ENV = "PORTFOLIO_SWAP_STATUS_REFRESH"

DEFAULT_BASE_MAINNET_RPC_URL = "https://mainnet.base.org"
DEFAULT_MORPHO_API_URL = "https://api.morpho.org/graphql"
DEFAULT_SOLANA_RPC_URL = "https://api.mainnet-beta.solana.com"


#: The four assets already in the earn/crosschain config. Addresses are public token contracts;
#: ``price_symbol`` names the PriceService symbol used for the USD leg (``None`` = stablecoin par).
@dataclass(frozen=True, slots=True)
class TokenConfig:
    symbol: str
    address: str
    decimals: int
    price_symbol: str | None = None
    stable: bool = False


@dataclass(frozen=True, slots=True)
class EvmChainConfig:
    key: str
    label: str
    chain_id: int
    rpc_url: str | None
    tokens: tuple[TokenConfig, ...] = field(default_factory=tuple)

    @property
    def configured(self) -> bool:
        return bool(self.rpc_url)


_BASE_TOKENS: tuple[TokenConfig, ...] = (
    TokenConfig(
        symbol="USDC",
        address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals=6,
        stable=True,
    ),
    TokenConfig(
        symbol="USDT",
        address="0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
        decimals=6,
        stable=True,
    ),
    TokenConfig(
        symbol="WETH",
        address="0x4200000000000000000000000000000000000006",
        decimals=18,
        price_symbol="ETH",
    ),
    TokenConfig(
        symbol="cbBTC",
        address="0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        decimals=8,
        price_symbol="BTC",
    ),
)

_ETH_TOKENS: tuple[TokenConfig, ...] = (
    TokenConfig(
        symbol="USDC",
        address="0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        decimals=6,
        stable=True,
    ),
    TokenConfig(
        symbol="USDT",
        address="0xdAC17F958D2ee523a2206206994597C13D831ec7",
        decimals=6,
        stable=True,
    ),
    TokenConfig(
        symbol="WETH",
        address="0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
        decimals=18,
        price_symbol="ETH",
    ),
    TokenConfig(
        symbol="cbBTC",
        address="0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
        decimals=8,
        price_symbol="BTC",
    ),
)


@dataclass(frozen=True, slots=True)
class PortfolioConfig:
    """Read-only settings for the multi-chain portfolio.

    ``timeout_s`` bounds EACH section (and each HTTP call), so one dead upstream can never hold
    the whole response open. ``cache_ttl_s`` is the short per-source cache window.
    """

    base: EvmChainConfig
    eth: EvmChainConfig
    solana_rpc_url: str
    morpho_api_url: str
    timeout_s: float = 6.0
    cache_ttl_s: float = 30.0
    max_swaps: int = 20
    max_status_refresh: int = 3
    refresh_swap_status: bool = False

    @property
    def chains(self) -> tuple[EvmChainConfig, ...]:
        return (self.base, self.eth)

    def chain_by_id(self, chain_id: int) -> EvmChainConfig | None:
        for chain in self.chains:
            if chain.chain_id == chain_id:
                return chain
        return None

    @property
    def has_evm_rpc(self) -> bool:
        return any(chain.configured for chain in self.chains)


def config_from_env(env: Mapping[str, str] | None = None) -> PortfolioConfig:
    """Build the portfolio config from the process environment (or an injected mapping).

    Base falls back to a keyless public RPC when ``BASE_MAINNET_RPC_URL`` is unset: the beta's
    /portfolio must aggregate Base + Ethereum without the operator having to provision another
    secret. It is a read-only VIEW endpoint, and a dead/rate-limited endpoint still degrades to an
    honest ``unavailable`` section rather than inventing a balance.
    """
    source = env if env is not None else os.environ
    base_rpc = (source.get(BASE_MAINNET_RPC_ENV) or "").strip() or DEFAULT_BASE_MAINNET_RPC_URL
    eth_rpc = (
        source.get(ETHEREUM_RPC_ENV) or source.get(ETHEREUM_RPC_FALLBACK_ENV) or ""
    ).strip() or None
    solana_rpc = (source.get(SOLANA_RPC_ENV) or "").strip() or DEFAULT_SOLANA_RPC_URL
    morpho_url = (source.get(MORPHO_API_ENV) or "").strip() or DEFAULT_MORPHO_API_URL
    return PortfolioConfig(
        base=EvmChainConfig(
            key="base",
            label="Base",
            chain_id=8453,
            rpc_url=base_rpc,
            tokens=_BASE_TOKENS,
        ),
        eth=EvmChainConfig(
            key="eth",
            label="Ethereum",
            chain_id=1,
            rpc_url=eth_rpc,
            tokens=_ETH_TOKENS,
        ),
        solana_rpc_url=solana_rpc,
        morpho_api_url=morpho_url,
        refresh_swap_status=env_flag(SWAP_STATUS_REFRESH_ENV, default=False),
    )


__all__ = [
    "BASE_MAINNET_RPC_ENV",
    "DEFAULT_BASE_MAINNET_RPC_URL",
    "DEFAULT_MORPHO_API_URL",
    "DEFAULT_SOLANA_RPC_URL",
    "ETHEREUM_RPC_ENV",
    "EvmChainConfig",
    "MORPHO_API_ENV",
    "PortfolioConfig",
    "SOLANA_RPC_ENV",
    "SWAP_STATUS_REFRESH_ENV",
    "TokenConfig",
    "config_from_env",
]
