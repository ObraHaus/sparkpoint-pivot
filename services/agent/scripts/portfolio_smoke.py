"""Feature 072 — read-only multi-chain portfolio smoke.

Reads a PUBLIC address against PUBLIC endpoints only. No key, no signature, no transaction, no
database, and no live 1Click quote (the swap section is the honest "database not configured" state
unless a store is wired by the service in production). Every HTTP call is counted and bounded well
under 25.

Usage::

    cd services/agent
    uv run python scripts/portfolio_smoke.py
    uv run python scripts/portfolio_smoke.py --base-rpc https://mainnet.base.org --skip-eth
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections.abc import Sequence
from dataclasses import replace

import httpx

from sparkpoint_agent.crosschain.config import default_config as crosschain_config
from sparkpoint_agent.data.prices import PriceService
from sparkpoint_agent.earn.config import default_config as earn_config
from sparkpoint_agent.earn.rhea import NearRpcClient, RheaViews
from sparkpoint_agent.earn.service import EarnService, build_registry_from_env
from sparkpoint_agent.portfolio.balances import BalanceSource
from sparkpoint_agent.portfolio.config import config_from_env
from sparkpoint_agent.portfolio.kamino import KaminoPositionsSource
from sparkpoint_agent.portfolio.models import PortfolioOverview
from sparkpoint_agent.portfolio.morpho import MorphoPositionsSource
from sparkpoint_agent.portfolio.rhea import RheaPositionsSource
from sparkpoint_agent.portfolio.service import MultichainPortfolioService
from sparkpoint_agent.portfolio.swaps import SwapHistorySource

PUBLIC_ADDRESS = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
DEFAULT_BASE_RPC = "https://base-rpc.publicnode.com"
DEFAULT_ETH_RPC = "https://ethereum-rpc.publicnode.com"
DEFAULT_SOLANA_RPC = "https://api.mainnet-beta.solana.com"
DEFAULT_MORPHO_URL = "https://api.morpho.org/graphql"


class CountingTransport(httpx.AsyncBaseTransport):
    """Counts every HTTP request; wraps the real transport."""

    def __init__(self) -> None:
        self.count = 0
        self._inner = httpx.AsyncHTTPTransport()

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.count += 1
        return await self._inner.handle_async_request(request)

    async def aclose(self) -> None:
        # Each source builds a short-lived AsyncClient around this shared transport; httpx closes
        # the transport when the client exits, so keep the underlying connection pool alive for the
        # rest of the smoke and close it once at the end.
        return None

    async def close(self) -> None:
        await self._inner.aclose()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Read-only 072 portfolio smoke.")
    parser.add_argument("--address", default=PUBLIC_ADDRESS, help="public address to read")
    parser.add_argument("--base-rpc", default=DEFAULT_BASE_RPC)
    parser.add_argument("--eth-rpc", default=DEFAULT_ETH_RPC)
    parser.add_argument("--solana-rpc", default=DEFAULT_SOLANA_RPC)
    parser.add_argument("--morpho-url", default=DEFAULT_MORPHO_URL)
    parser.add_argument("--timeout", type=float, default=8.0)
    parser.add_argument("--skip-eth", action="store_true", help="do not read Ethereum")
    return parser


def _print_overview(overview: PortfolioOverview, calls: int) -> None:
    print("Portfolio smoke — READ-ONLY (no key, no signature, no transaction)")
    print(f"wallet: {overview.wallet}")
    print(f"state:  {overview.state()}   asOf: {overview.as_of}")
    print()
    print(f"{'section':<10} {'status':<12} {'rows':>4}  {'totalUsd':>10}  source")
    for section in overview.sections:
        total = section.total_usd()
        print(
            f"{section.key:<10} {section.status:<12} {len(section.rows):>4}  "
            f"{(format(total, '.2f') if total is not None else '-'):>10}  "
            f"{section.source or '-'}"
        )
        if section.reason:
            print(f"{'':<10} reason: {section.reason}")
    totals = overview.totals()
    print()
    print(f"totalUsd: {totals['totalUsd'] if totals['totalUsd'] is not None else 'unavailable'}")
    for item in totals["byChain"]:
        print(f"  chain {item['chain']:<6} {item['label']:<10} ${item['valueUsd']}")
    for item in totals["byProtocol"]:
        print(f"  proto {item['protocol']:<10} ${item['valueUsd']}")
    print(f"sources: {', '.join(overview.sources()) or 'none'}")
    print(f"http calls: {calls} (bounded read-only)")


async def _run(args: argparse.Namespace) -> int:
    transport = CountingTransport()
    env = {
        "BASE_MAINNET_RPC_URL": args.base_rpc,
        "ETHEREUM_RPC_URL": "" if args.skip_eth else args.eth_rpc,
        "SOLANA_RPC_URL": args.solana_rpc,
        "MORPHO_API_URL": args.morpho_url,
    }
    config = replace(config_from_env(env), timeout_s=args.timeout)
    earn_cfg = earn_config()
    registry = build_registry_from_env(earn_cfg)
    pricer = PriceService()
    crosschain = crosschain_config()
    rhea_views = RheaViews(
        earn_cfg.rhea,
        rpc=NearRpcClient(earn_cfg.rhea.rpc_urls, transport=transport),
    )
    earn_service = EarnService(earn_cfg, registry, rhea_views=rhea_views)

    service = MultichainPortfolioService(
        config,
        balances=BalanceSource(
            config,
            pricer,
            transports={"base": transport, "eth": transport},
        ),
        morpho=MorphoPositionsSource(
            config,
            registry=registry,
            earn_config=earn_cfg,
            pricer=pricer,
            transport=transport,
            rpc_transports={"base": transport, "eth": transport},
        ),
        kamino=KaminoPositionsSource(
            config,
            earn_config=earn_cfg,
            registry=registry,
            linked=None,  # no database: no owner-bound Solana address is knowable
            pricer=pricer,
            transport=transport,
        ),
        rhea=RheaPositionsSource(earn_service),
        swaps=SwapHistorySource(None, crosschain),  # no DB -> "database is not configured"
    )
    overview = await service.read(args.address, focus="all")
    _print_overview(overview, transport.count)
    await transport.close()
    return 0 if transport.count <= 25 else 1


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    return asyncio.run(_run(args))


if __name__ == "__main__":
    sys.exit(main())
