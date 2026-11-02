#!/usr/bin/env python
"""069/070 — build ``earn/snapshot.json`` (Morpho + Kamino) and print reachability.

Run from ``services/agent``::

    uv run python scripts/earn_registry_snapshot.py            # full refresh
    uv run python scripts/earn_registry_snapshot.py --kamino-only

The full mode fetches Morpho V1+V2 (one pass per version, applied filters) then merges the enabled
Kamino kVaults. ``--kamino-only`` keeps the Morpho rows already in the shipped snapshot and only
refreshes the Kamino rows — useful when the Morpho API budget is spent (the Morpho fetch pages a
large universe). It then dry-quotes each configured 1Click receipt (no funds, no live quote) to
report which receipt rail is actually live today.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from sparkpoint_agent.crosschain.config import default_config as crosschain_config  # noqa: E402
from sparkpoint_agent.crosschain.oneclick import OneClickClient  # noqa: E402
from sparkpoint_agent.earn.config import default_config, shipped_snapshot_path  # noqa: E402
from sparkpoint_agent.earn.kamino import (  # noqa: E402
    fetch_kamino_catalog,
    fetch_kamino_vaults,
)
from sparkpoint_agent.earn.rails import (  # noqa: E402
    LIVE,
    ReceiptLivenessCache,
    probe_receipts,
)
from sparkpoint_agent.earn.registry import (  # noqa: E402
    EarnRegistry,
    EarnSnapshot,
    VaultEntry,
    fetch_vaults_for_chains,
    filter_vaults,
    write_snapshot,
)
from sparkpoint_agent.earn.rhea import (  # noqa: E402
    RheaViews,
    fetch_rhea_vaults,
    human_string,
    mca_fee_amount,
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


def _existing_without(out_path: Path, exclude: set[str]) -> list[VaultEntry]:
    registry = EarnRegistry(
        default_config(),
        writable_path=Path("/nonexistent/earn-snapshot.json"),
        fallback_path=out_path,
    )
    snapshot = registry.current()
    if snapshot is None:
        return []
    return [entry for entry in snapshot.vaults if entry.protocol not in exclude]


def _kamino_by_asset(catalog: list) -> str:
    config = default_config()
    symbols: list[str] = []
    for item in catalog:
        state = item.get("state")
        if not isinstance(state, dict):
            continue
        mapped = config.kamino.asset_for_mint(str(state.get("tokenMint") or ""))
        symbols.append(mapped[0] if mapped else "other")
    return _counts(symbols)


async def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--kamino-only",
        action="store_true",
        help="refresh Kamino rows only; keep the Morpho/Rhea rows already in snapshot.json",
    )
    parser.add_argument(
        "--rhea-only",
        action="store_true",
        help="refresh Rhea rows only; keep the Morpho/Kamino rows already in snapshot.json",
    )
    args = parser.parse_args(argv)
    if args.kamino_only and args.rhea_only:
        parser.error("--kamino-only and --rhea-only are mutually exclusive")
    config = default_config()
    out_path = shipped_snapshot_path()

    kept: list[VaultEntry] = []
    if args.kamino_only:
        kept = _existing_without(out_path, {"kamino"})
        on_enabled = [entry for entry in kept if entry.protocol == "morpho"]
        filtered = list(on_enabled)
    elif args.rhea_only:
        kept = _existing_without(out_path, {"rhea"})
        on_enabled = [entry for entry in kept if entry.protocol == "morpho"]
        filtered = list(on_enabled)
    else:
        on_enabled = await fetch_vaults_for_chains(
            config, config.enabled_chains, apply_filters=False
        )
        filtered = filter_vaults(config, on_enabled)

    morpho_entries = [entry for entry in kept if entry.protocol == "morpho"] or list(filtered)
    if args.kamino_only:
        kamino_entries = await fetch_kamino_vaults(config) if config.kamino.enabled else []
    else:
        kamino_entries = [entry for entry in kept if entry.protocol == "kamino"]
        if not args.rhea_only and config.kamino.enabled:
            kamino_entries = await fetch_kamino_vaults(config)
    if args.rhea_only:
        rhea_entries = await fetch_rhea_vaults(config) if config.rhea.enabled else []
    else:
        rhea_entries = [entry for entry in kept if entry.protocol == "rhea"]
        if not rhea_entries and config.rhea.enabled and not args.kamino_only:
            rhea_entries = await fetch_rhea_vaults(config)
    catalog = await fetch_kamino_catalog(config) if config.kamino.enabled else []
    combined = [*morpho_entries, *kamino_entries, *rhea_entries]

    liveness = ReceiptLivenessCache()
    client = OneClickClient.from_env()
    await probe_receipts(config, client, crosschain_config(), liveness)

    snapshot = EarnSnapshot(
        fetched_at=datetime.now(UTC),
        source="registry",
        vaults=tuple(combined),
    )
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

    configured_kamino = [
        entry for entry in kamino_entries if entry.address in {
            vault.address for vault in config.kamino.vaults
        }
    ]
    kamino_live = [
        entry
        for entry in configured_kamino
        if (receipt := config.receipt_for_vault(entry.address)) is not None
        and liveness.get(receipt.asset_id) == LIVE
    ]

    mode = "rhea-only" if args.rhea_only else ("kamino-only" if args.kamino_only else "full")
    print(f"wrote: {out_path} ({mode})")
    print()
    print("== snapshot ==")
    print(f"vaults={len(combined)} chains: {_counts([e.chain for e in combined])}")
    print(f"protocols: {_counts([e.protocol for e in combined])}")
    print(f"assets: {_counts([e.asset.symbol for e in combined])}")
    print(
        "rails: direct="
        f"{sum(1 for e in combined if config.rails.direct)} "
        f"oneclick_configured={len(receipt_vaults) + len(configured_kamino)} "
        f"oneclick_live={len(live_receipts) + len(kamino_live)} "
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
    print("== Kamino kVaults ==")
    print("metric | count")
    print("--- | ---")
    print(f"auto_discover | {str(config.kamino.auto_discover).lower()}")
    print(f"total kVaults (list endpoint) | {len(catalog)}")
    print(f"kVaults by asset (known mints) | {_kamino_by_asset(catalog)}")
    print(f"configured | {len(config.kamino.vaults)}")
    print(f"in snapshot | {len(kamino_entries)}")
    print(f"oneclick_live | {len(kamino_live)}")
    print()
    print("configured vault | asset | tvl usd | net apy | oneclick")
    print("--- | --- | --- | --- | ---")
    for vault in config.kamino.vaults:
        entry = next((e for e in kamino_entries if e.address == vault.address), None)
        receipt = config.receipt_for_vault(vault.address)
        live = (
            liveness.get(receipt.asset_id) == LIVE if receipt is not None else False
        )
        if entry is None:
            print(f"{vault.name} | {vault.asset} | - | - | {'live' if live else 'not in snapshot'}")
            continue
        print(
            f"{entry.name} | {entry.asset.symbol} | "
            f"{entry.tvl_usd if entry.tvl_usd is not None else '-'} | "
            f"{entry.net_apy_percent or '-'}% | {'live' if live else 'no receipt/liquidity'}"
        )
    print()
    print("== receipt liveness (dry 100 USDC) ==")
    for receipt in config.receipts:
        print(f"{receipt.symbol} | {receipt.protocol} | {liveness.get(receipt.asset_id)}")
    if config.rhea.enabled:
        print()
        print("== Rhea (Burrow) on NEAR ==")
        print("asset | supply apy | supplied (stable pegged) | source | fetched at")
        print("--- | --- | --- | --- | ---")
        for entry in rhea_entries:
            print(
                f"{entry.asset.symbol} | {entry.net_apy_percent or '-'}% | "
                f"{entry.tvl_usd if entry.tvl_usd is not None else '-'} | "
                f"{entry.source} | {entry.fetched_at}"
            )
        views = RheaViews(config.rhea)
        try:
            fees = await views.create_mca_fee()
        except Exception as exc:  # noqa: BLE001 - advisory table only
            print(f"mca fee read failed: {type(exc).__name__}")
            fees = {}
        for asset in config.rhea.enabled_assets():
            fee = mca_fee_amount(fees, asset, config.rhea.mca_fee_fallback)
            print(
                f"one-time MCA fee {asset.symbol} | {human_string(fee)} "
                f"(live={'yes' if asset.token_id in fees else 'fallback'})"
            )
        print(f"app | {config.rhea.app_url}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
