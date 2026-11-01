#!/usr/bin/env python
"""069/070 — REAL dry quotes for the configured 1Click Earn receipts + Kamino routes.

Run from ``services/agent``::

    uv run python scripts/earn_dry_smoke.py

Every call is ``dry: true`` (no deposit address, no funds). Output columns:
``route | http | amountOut | ETA | liveness``. The keyless fee is noted, never printed as a key.
The extra Kamino rows exercise Base USDC/SOL deposits into ``kV-gtSOLb``, a withdraw back to SOL,
and the current ~$500 size cap.
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
    sol_probe = config.dry_probe_addresses.get("sol")

    print("route | http | amountOut | ETA | liveness")
    print("--- | --- | --- | --- | ---")
    for receipt in config.receipts:
        recipient = (
            sol_probe
            if receipt.chain == "sol"
            else "0x0000000000000000000000000000000000000002"
        )
        try:
            quote = await client.quote(
                dry=True,
                origin_asset=origin.asset_id,
                destination_asset=receipt.asset_id,
                amount=str(amount_raw),
                slippage_bps=cc.slippage_bps,
                deadline=deadline_at(cc.deadline_minutes),
                refund_to="0x0000000000000000000000000000000000000001",
                recipient=recipient,
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

    kv = config.receipt_for_symbol("kV-gtSOLb")
    sol_asset = cc.asset("sol:SOL")
    sol_usdc = cc.asset("sol:USDC")
    base_usdc = cc.asset("base:USDC")
    if kv is not None and sol_asset is not None and base_usdc is not None:
        print()
        print("== Kamino (kV-gtSOLb) ==")
        print("route | http | amountOut | ETA | liveness")
        print("--- | --- | --- | --- | ---")
        cases: list[tuple[str, str, str, str, str]] = [
            (
                "Base USDC 100 -> kV-gtSOLb",
                base_usdc.asset_id,
                kv.asset_id,
                str(100 * 10**base_usdc.decimals),
                "0x0000000000000000000000000000000000000001",
            ),
            (
                "SOL 1 -> kV-gtSOLb",
                sol_asset.asset_id,
                kv.asset_id,
                str(1 * 10**sol_asset.decimals),
                sol_probe or "",
            ),
            (
                "kV-gtSOLb 1 -> SOL",
                kv.asset_id,
                sol_asset.asset_id,
                str(1 * 10**kv.decimals),
                sol_probe or "",
            ),
            (
                "Base USDC 1000 -> kV-gtSOLb (cap check)",
                base_usdc.asset_id,
                kv.asset_id,
                str(1000 * 10**base_usdc.decimals),
                "0x0000000000000000000000000000000000000001",
            ),
        ]
        if sol_usdc is not None:
            cases.insert(
                2,
                (
                    "Solana USDC 100 -> kV-gtSOLb",
                    sol_usdc.asset_id,
                    kv.asset_id,
                    str(100 * 10**sol_usdc.decimals),
                    sol_probe or "",
                ),
            )
        for label, origin_asset, destination, amount, refund in cases:
            recipient = sol_probe or ""
            try:
                quote = await client.quote(
                    dry=True,
                    origin_asset=origin_asset,
                    destination_asset=destination,
                    amount=amount,
                    slippage_bps=cc.slippage_bps,
                    deadline=deadline_at(cc.deadline_minutes),
                    refund_to=refund,
                    recipient=recipient,
                )
            except QuoteUnavailable as exc:
                reason = exc.reason
                if "liquidity" in reason.lower():
                    reason = f"{reason} (try a smaller amount)"
                print(f"{label} | 400 | unavailable: {reason} | - | {NO_LIQUIDITY}")
                continue
            except CrossChainTransportError as exc:
                print(f"{label} | ERR | {exc} | - | {UNKNOWN}")
                continue
            eta = f"{quote.time_estimate_sec}s" if quote.time_estimate_sec else "-"
            print(
                f"{label} | {quote.http_status} | {quote.amount_out_formatted} | {eta} | {LIVE}"
            )

    if not client.has_api_key:
        print("\nnote: keyless quote — 1Click's 0.25% routing fee is included.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
