#!/usr/bin/env python
"""068 — REAL dry quotes for the demo prompts against the 1Click API.

Run from ``services/agent``::

    uv run python scripts/oneclick_dry_smoke.py

Every request is ``dry: true``: no deposit address, no funds, no key printed. The Tron row shows
the config-driven "unavailable" path (no HTTP call: the route is paused in routes.json).
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sparkpoint_agent.crosschain.addresses import placeholder_for  # noqa: E402
from sparkpoint_agent.crosschain.config import default_config  # noqa: E402
from sparkpoint_agent.crosschain.oneclick import (  # noqa: E402
    CrossChainTransportError,
    OneClickClient,
    QuoteUnavailable,
)
from sparkpoint_agent.crosschain.parse import parse_cross_chain_request  # noqa: E402
from sparkpoint_agent.crosschain.service import CrossChainService  # noqa: E402

PROMPTS = (
    "Swap 5,000 USDC into native BTC.",
    "Move 10,000 USDC from Ethereum to Base.",
    "Turn 2,000 USDC into SOL on Solana.",
    "Swap 500 USDG to USDC on Base",
    "Pay my supplier 3,000 USDT on Tron.",
)


async def main() -> int:
    config = default_config()
    service = CrossChainService(config, OneClickClient.from_env())
    print("route | http | amountOut | ETA")
    print("--- | --- | --- | ---")
    for prompt in PROMPTS:
        request = parse_cross_chain_request(prompt, config)
        if request is None:
            print(f"NOT PARSED | - | - | -   ({prompt})")
            continue
        origin = config.asset(request.origin_key)
        destination = config.asset(request.destination_key)
        assert origin is not None and destination is not None  # noqa: S101
        route = f"{origin.key} -> {destination.key}"
        disabled = [a for a in (origin, destination) if not a.enabled]
        if disabled:
            reason = disabled[0].unavailable_reason or "route disabled"
            print(f"{route} | - | unavailable: {reason} | -")
            continue
        try:
            quote = await service.request_quote(
                origin_key=origin.key,
                destination_key=destination.key,
                amount_raw=request.amount_raw,
                dry=True,
                recipient=placeholder_for(destination.address_kind),
                refund_to=placeholder_for(origin.address_kind),
            )
        except QuoteUnavailable as exc:
            print(f"{route} | 400 | unavailable: {exc.reason} | -")
            continue
        except CrossChainTransportError as exc:
            print(f"{route} | ERR | {exc} | -")
            continue
        eta = f"{quote.time_estimate_sec}s" if quote.time_estimate_sec else "-"
        print(
            f"{route} | {quote.http_status} | {quote.amount_out_formatted} "
            f"{destination.symbol} | {eta}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
