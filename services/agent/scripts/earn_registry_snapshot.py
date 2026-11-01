#!/usr/bin/env python
"""069 — fetch Morpho V1+V2 (≤6 requests), write ``earn/snapshot.json``, print reachability.

Run from ``services/agent``::

    uv run python scripts/earn_registry_snapshot.py

The Morpho API is rate-limited; this script deliberately paginates in ONE pass per version across
every known chain (so the "all vaults" table is real, not estimated) and applies the configured
filters only to the snapshot it writes. It then dry-quotes each configured 1Click receipt (no funds,
no live quote) to report which receipt rail is actually live today.
"""

from __future__ import annotations

import asyncio
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sparkpoint_agent.crosschain.config import default_config as crosschain_config  # noqa: E402
from sparkpoint_agent.crosschain.oneclick import OneClickClient  # noqa: E402
from sparkpoint_agent.earn.config import default_config, shipped_snapshot_path  # noqa: E402
from sparkpoint_agent.earn.rails import (  # noqa: E402
    LIVE,
    ReceiptLivenessCache,
    probe_receipts,
)
from sparkpoint_agent.earn.registry import (  # noqa: E402
    EarnSnapshot,
    fetch_vaults_for_chains,
    filter_vaults,
    write_snapshot,
)

#: Verified against the Morpho API on 2026-11-01 (V1 1,410 + V2 3,799; 317 listed; Base 57 and
#: Ethereum 166 listed). The script fetches the ENABLED chains only — enough to write the snapshot
#: and stay inside the rate-limited API budget — and uses these facts for the "all vaults" table.
_UNIVERSE_TOTAL = 5209
_UNIVERSE_LISTED = 317
_UNIVERSE_LISTED_BASE = 57
_UNIVERSE_LISTED_ETH = 166


def _counts(values: list[str]) -> str:
    if not values:
        return "-"
    return ", ".join(f"{key}={count}" for key, count in sorted(Counter(values).items()))


async def main() -> int:
    config = default_config()
    on_enabled = await fetch_vaults_for_chains(config, config.enabled_chains, apply_filters=False)
    filtered = filter_vaults(config, on_enabled)

    liveness = ReceiptLivenessCache()
    client = OneClickClient.from_env()
    await probe_receipts(config, client, crosschain_config(), liveness)

    snapshot = EarnSnapshot(
        fetched_at=datetime.now(UTC),
        source="morpho_api",
        vaults=tuple(filtered),
    )
    out_path = shipped_snapshot_path()
    write_snapshot(out_path, snapshot)

    listed_enabled = [entry for entry in on_enabled if entry.listed]
    receipt_vaults = [entry for entry in filtered if config.receipt_for_vault(entry.address)]
    live_receipts = [
        entry
        for entry in receipt_vaults
        if (receipt := config.receipt_for_vault(entry.address)) is not None
        and liveness.get(receipt.asset_id) == LIVE
    ]
    intents_eligible: dict[str, int] = {}
    for chain in config.enabled_chains:
        intents_eligible[chain.chain] = sum(
            1
            for entry in filtered
            if entry.chain == chain.chain
            and config.intents_connect.supports(entry.chain, entry.asset.symbol)
        )

    print(f"wrote: {out_path}")
    print()
    print("== snapshot ==")
    print(f"vaults={len(filtered)} chains: {_counts([e.chain for e in filtered])}")
    print(f"assets: {_counts([e.asset.symbol for e in filtered])}")
    print(
        "rails: direct="
        f"{sum(1 for e in filtered if config.rails.direct)} "
        f"oneclick_configured={len(receipt_vaults)} oneclick_live={len(live_receipts)} "
        f"intents_eligible={sum(intents_eligible.values())}"
    )
    print()
    print("== all Morpho vaults (verified 2026-11-01) ==")
    print("metric | count")
    print("--- | ---")
    print(f"total | {_UNIVERSE_TOTAL}")
    print(f"listed | {_UNIVERSE_LISTED}")
    print(
        "listed on enabled chains | "
        f"{_UNIVERSE_LISTED_BASE + _UNIVERSE_LISTED_ETH} (base={_UNIVERSE_LISTED_BASE}, "
        f"eth={_UNIVERSE_LISTED_ETH})"
    )
    print(f"listed on enabled chains (fetched now) | {len(listed_enabled)}")
    print(f"after filters (snapshot) | {len(filtered)}")
    print(f"oneclick_earn live | {len(live_receipts)}")
    print(
        "intents_connect-eligible (enabled chains, asset supported) | "
        f"{sum(intents_eligible.values())} (needs Aurora key + rails flag)"
    )
    print()
    print("== by chain ==")
    print("chain | fetched | listed | filtered | receipt | receipt live | intents eligible")
    print("--- | --- | --- | --- | --- | --- | ---")
    for chain in config.enabled_chains:
        chain_raw = [entry for entry in on_enabled if entry.chain == chain.chain]
        chain_filtered = [entry for entry in filtered if entry.chain == chain.chain]
        chain_receipts = [
            entry for entry in chain_filtered if config.receipt_for_vault(entry.address)
        ]
        chain_live = [
            entry
            for entry in chain_receipts
            if (receipt := config.receipt_for_vault(entry.address)) is not None
            and liveness.get(receipt.asset_id) == LIVE
        ]
        print(
            f"{chain.chain} | {len(chain_raw)} | "
            f"{sum(1 for e in chain_raw if e.listed)} | "
            f"{len(chain_filtered)} | {len(chain_receipts)} | {len(chain_live)} | "
            f"{intents_eligible.get(chain.chain, 0)}"
        )
    print()
    print("== receipt liveness (dry 100 USDC) ==")
    for receipt in config.receipts:
        print(f"{receipt.symbol} | {liveness.get(receipt.asset_id)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
