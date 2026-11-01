#!/usr/bin/env python
"""069 — REAL dry quotes: Base USDC 100 → each configured 1Click Earn receipt.

Run from ``services/agent``::

    uv run python scripts/earn_dry_smoke.py

Every call is ``dry: true`` (no deposit address, no funds). Output columns:
``receipt | http | amountOut | ETA | liveness``. The keyless fee is noted, never printed as a key.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sparkpoint_agent.crosschain.config import default_config as crosschain_config  # noqa: E402
from sparkpoint_agent.crosschain.oneclick import (  # noqa: E402
    CrossChainTransportError,
    OneClickClient,
    QuoteUnavailable,
    deadline_at,
)
from sparkpoint_agent.earn.config import default_config  # noqa: E402
from sparkpoint_agent.earn.rails import (  # noqa: E402
    LIVE,
    NO_LIQUIDITY,
    UNKNOWN,
    ReceiptLivenessCache,
)


async def main() -> int:
    config = default_config()
    cc = crosschain_config()
    origin = cc.default_for_symbol("USDC")
    if origin is None:
        print("no configured USDC origin")
        return 1
    client = OneClickClient.from_env()
    liveness = ReceiptLivenessCache()
    amount_raw = 100 * 10**origin.decimals

    print("receipt | http | amountOut | ETA | liveness")
    print("--- | --- | --- | --- | ---")
    for receipt in config.receipts:
        try:
            quote = await client.quote(
                dry=True,
                origin_asset=origin.asset_id,
                destination_asset=receipt.asset_id,
                amount=str(amount_raw),
                slippage_bps=cc.slippage_bps,
                deadline=deadline_at(cc.deadline_minutes),
                refund_to="0x0000000000000000000000000000000000000001",
                recipient="0x0000000000000000000000000000000000000002",
            )
        except QuoteUnavailable as exc:
            liveness.set(receipt.asset_id, NO_LIQUIDITY)
            print(f"{receipt.symbol} | 400 | unavailable: {exc.reason} | - | {NO_LIQUIDITY}")
            continue
        except CrossChainTransportError as exc:
            print(f"{receipt.symbol} | ERR | {exc} | - | {UNKNOWN}")
            continue
        liveness.set(receipt.asset_id, LIVE)
        eta = f"{quote.time_estimate_sec}s" if quote.time_estimate_sec else "-"
        print(
            f"{receipt.symbol} | {quote.http_status} | {quote.amount_out_formatted} | "
            f"{eta} | {LIVE}"
        )
    if not client.has_api_key:
        print("\nnote: keyless quote — 1Click's 0.25% routing fee is included.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
