"""Small builders shared by the 069 earn tests (no network, no DB)."""

from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sparkpoint_agent.earn.registry import EarnSnapshot, VaultAsset, VaultEntry

DEFAULT_VAULT = "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61"


def make_vault(
    *,
    address: str = DEFAULT_VAULT,
    chain: str = "base",
    chain_id: int = 8453,
    name: str = "Gauntlet USDC Prime",
    symbol: str = "GTUSDC",
    asset: str = "USDC",
    listed: bool = True,
    tvl: Decimal | None = Decimal("420000000"),
    apy: Decimal | None = Decimal("0.0441"),
    version: str = "v1",
    protocol: str = "morpho",
) -> VaultEntry:
    return VaultEntry(
        chain=chain,
        chain_id=chain_id,
        address=address,
        version=version,
        name=name,
        symbol=symbol,
        asset=VaultAsset(
            address=(
                "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
                if chain == "base"
                else "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
            ),
            symbol=asset,
            decimals=6,
        ),
        listed=listed,
        tvl_usd=tvl,
        net_apy=apy,
        fetched_at="2026-11-01T00:00:00+00:00",
        protocol=protocol,
    )


KV_VAULT = "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg"
KV_SHARES = "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK"
SOL_MINT = "So11111111111111111111111111111111111111112"


def make_kamino_vault(
    *,
    address: str = KV_VAULT,
    name: str = "SOL Balanced",
    asset: str = "SOL",
    mint: str = SOL_MINT,
    decimals: int = 9,
    tvl: Decimal | None = Decimal("2443425.6"),
    apy: Decimal | None = Decimal("0.0445"),
) -> VaultEntry:
    return VaultEntry(
        chain="sol",
        chain_id=0,
        address=address,
        version="kvault",
        name=name,
        symbol="kV",
        asset=VaultAsset(address=mint, symbol=asset, decimals=decimals),
        listed=True,
        tvl_usd=tvl,
        net_apy=apy,
        source="kamino_api",
        fetched_at="2026-11-01T00:00:00+00:00",
        protocol="kamino",
    )


RHEA_TOKEN_ID = (  # noqa: S105 - a public NEAR token id, not a secret
    "17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1"  # noqa: S105
)


def make_rhea_vault(
    *,
    symbol: str = "USDC",
    token_id: str = RHEA_TOKEN_ID,
    tvl: Decimal | None = Decimal("12733763.455236751"),
    apy: Decimal | None = Decimal("0.1405"),
) -> VaultEntry:
    return VaultEntry(
        chain="near",
        chain_id=0,
        address=token_id,
        version="lending",
        name=f"Rhea Lending {symbol}",
        symbol=symbol,
        asset=VaultAsset(address=token_id, symbol=symbol, decimals=6),
        listed=True,
        tvl_usd=tvl,
        net_apy=apy,
        source="rhea_rpc",
        fetched_at="2026-11-01T00:00:00+00:00",
        protocol="rhea",
    )


def make_snapshot(*vaults: VaultEntry) -> EarnSnapshot:
    return EarnSnapshot(
        fetched_at=datetime.now(UTC),
        source="morpho_api",
        vaults=tuple(vaults) or (make_vault(),),
    )
