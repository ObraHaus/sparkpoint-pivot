"""Build a revenue period's allocation from live chain state, and write the published document.

This is the off-chain half of the distributor. It reads who holds an activated broker right now,
splits the pot by weight, builds the Merkle tree, and writes the artifact that makes the split
checkable by someone who does not trust us (FR-010).

    uv run python scripts/build_period_allocation.py \
        --rpc https://rpc.testnet.chain.robinhood.com \
        --chain-id 46630 --period 1 \
        --token 0x4538B5... --pot 1000000000000000000000 \
        --out ../../allocations

⚠️ **It does not publish.** It prints the root and total for a human to pass to
`publishAllocations`, because that call is irreversible for the period and should not be a side
effect of running a script. A wrong root strands real money against proofs nobody holds.

⚠️ It **refuses** to write anything if the chain could not be fully read, or if a broker is
activated but carries no weight and no grandfathering policy is set. A short allocation looks
exactly like a complete one, and publishing makes it permanent.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

import httpx

from sparkpoint_agent.chain.broker_allocation import UnpricedActivations, build_allocation
from sparkpoint_agent.chain.broker_ledger import BrokerLedger


class Rpc:
    """One client for the whole run — a fresh connection per call is pure latency here."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.client = httpx.AsyncClient(timeout=60.0)
        self.calls = 0

    async def call(self, method: str, params: list[Any]) -> Any:
        self.calls += 1
        r = await self.client.post(
            self.url, json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
        )
        body = r.json()
        if body.get("error") is not None:
            raise RuntimeError(str(body["error"])[:120])
        return body.get("result")

    async def aclose(self) -> None:
        await self.client.aclose()


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--rpc", required=True)
    ap.add_argument("--chain-id", type=int, required=True)
    ap.add_argument("--period", type=int, required=True)
    ap.add_argument("--token", required=True, help="the ONE ERC-20 this period is denominated in")
    ap.add_argument("--pot", required=True, help="base units funded for this period")
    ap.add_argument("--broker", required=True)
    ap.add_argument("--registries", required=True, help="comma-separated, newest first")
    ap.add_argument("--from-block", type=int, required=True)
    ap.add_argument("--grandfather-bps", type=int, default=10_000)
    ap.add_argument("--out", default="allocations")
    args = ap.parse_args()

    rpc = Rpc(args.rpc)
    try:
        ledger = BrokerLedger(
            rpc=rpc,
            broker=args.broker,
            registries=[r.strip() for r in args.registries.split(",") if r.strip()],
            from_block=args.from_block,
            grandfather_bps=args.grandfather_bps,
        )
        scan = await ledger.scan_activations()
    finally:
        await rpc.aclose()

    if scan is None:
        print("REFUSING: the chain could not be fully read.", file=sys.stderr)
        print(
            "A partial scan silently drops holders, and publishing is permanent.", file=sys.stderr
        )
        return 2

    print(f"scanned in {rpc.calls} rpc calls")
    for b in scan.activated:
        mark = "  (grandfathered)" if b.token_id in scan.weightless else ""
        print(f"  #{b.token_id:<4} {b.holder}  {b.weight_bps:>6} bps{mark}")
    if not scan.activated:
        print("no activated brokers — nothing to allocate", file=sys.stderr)
        return 3

    try:
        plan = build_allocation(
            period_id=args.period,
            token=args.token,
            pot=int(args.pot),
            brokers=list(scan.activated),
            weightless=scan.weightless,
            grandfathered=scan.weightless if args.grandfather_bps > 0 else (),
        )
    except UnpricedActivations as err:
        print(f"REFUSING: {err}", file=sys.stderr)
        return 4

    out_dir = Path(args.out) / str(args.chain_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / f"period-{args.period}.json"
    path.write_text(
        json.dumps(plan.to_publishable(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )

    print()
    print(f"wrote {path}")
    print(f"  totalWeightBps  {plan.total_weight_bps}")
    print(f"  totalAllocated  {plan.total_allocated}")
    print(f"  dust (rolls fwd){plan.dust:>16}")
    print(f"  merkleRoot      {plan.merkle_root}")
    print()
    print("NOT PUBLISHED. To turn this period on (irreversible for this period):")
    print(
        f"  cast send <distributor> 'publishAllocations(uint256,bytes32,uint256)' "
        f"{args.period} {plan.merkle_root} {plan.total_allocated}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
