# ruff: noqa: S101
"""069 — normalization, filters, and the fallback snapshot when Morpho is unreachable."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

import pytest

from sparkpoint_agent.earn.config import config_from_dict, default_config
from sparkpoint_agent.earn.registry import (
    EarnRegistry,
    EarnSnapshot,
    MorphoRegistryError,
    fetch_vaults_for_chains,
    filter_vaults,
    normalize_vault,
    write_snapshot,
)

from .helpers import make_vault


def test_v1_reads_state_and_keeps_the_fraction_as_a_decimal() -> None:
    entry = normalize_vault(
        {
            "address": "0xAbC",
            "name": "Gauntlet USDC Prime",
            "symbol": "GTUSDC",
            "listed": True,
            "chain": {"id": 8453, "network": "Base"},
            "asset": {"address": "0xUsdc", "symbol": "USDC", "decimals": 6},
            "state": {"totalAssetsUsd": 420_000_000.5, "netApy": 0.0441},
        },
        chain="base",
        chain_id=8453,
        version="v1",
        fetched_at="2026-11-01T00:00:00+00:00",
    )
    assert entry is not None
    assert entry.version == "v1"
    assert entry.tvl_usd == Decimal("420000000.5")
    assert entry.net_apy == Decimal("0.0441")
    assert entry.net_apy_percent == "4.41"


def test_v2_reads_top_level_fields_not_state() -> None:
    entry = normalize_vault(
        {
            "address": "0xV2",
            "name": "V2 vault",
            "symbol": "V2",
            "listed": True,
            "chain": {"id": 1, "network": "Ethereum"},
            "asset": {"address": "0xUsdc", "symbol": "USDC", "decimals": 6},
            "state": {"totalAssetsUsd": 1, "netApy": 0},
            "totalAssetsUsd": 2_500_000,
            "netApy": 0.03,
            "avgNetApy": 0.041,
        },
        chain="eth",
        chain_id=1,
        version="v2",
        fetched_at="2026-11-01T00:00:00+00:00",
    )
    assert entry is not None
    assert entry.tvl_usd == Decimal("2500000")
    assert entry.net_apy == Decimal("0.041"), "avgNetApy is the disclosure figure"


def test_filters_apply_listed_tvl_asset_allow_and_deny() -> None:
    config = replace(
        default_config(),
        allowlist=("0xaaa",),
        denylist=("0xbbb",),
        listed_only=True,
        min_tvl_usd="1000000",
        assets=("USDC",),
    )
    vaults = [
        make_vault(address="0xaaa", tvl=Decimal("2000000")),
        make_vault(address="0xbbb", tvl=Decimal("9000000")),
        make_vault(address="0xccc", tvl=Decimal("9000000")),
        make_vault(address="0xddd", tvl=Decimal("10")),
        make_vault(address="0xeee", tvl=Decimal("5000000"), asset="WETH"),
        make_vault(address="0xfff", tvl=Decimal("5000000"), listed=False),
    ]
    result = filter_vaults(config, vaults)
    assert [entry.address for entry in result] == ["0xaaa"]


def test_allowlist_empty_means_allow_all_and_denylist_still_wins() -> None:
    config = replace(default_config(), allowlist=(), denylist=("0xbbb",))
    vaults = [make_vault(address="0xaaa"), make_vault(address="0xbbb")]
    assert [entry.address for entry in filter_vaults(config, vaults)] == ["0xaaa"]


async def test_api_failure_falls_back_to_the_shipped_snapshot(tmp_path: Path) -> None:
    fallback = tmp_path / "fallback.json"
    write_snapshot(fallback, EarnSnapshot(datetime.now(UTC), "morpho_api", (make_vault(),)))

    async def boom(_: object) -> list:
        raise MorphoRegistryError("offline")

    registry = EarnRegistry(
        default_config(),
        writable_path=tmp_path / "missing.json",
        fallback_path=fallback,
        fetcher=boom,
    )
    assert await registry.refresh(force=True) is False
    snapshot = registry.current()
    assert snapshot is not None and len(snapshot.vaults) == 1
    assert registry.loaded_from == "shipped"


async def test_persisted_snapshot_is_written_and_reloaded(tmp_path: Path) -> None:
    writable = tmp_path / "earn.json"

    async def one(_: object) -> list:
        return [make_vault()]

    registry = EarnRegistry(default_config(), writable_path=writable, fetcher=one)
    assert await registry.refresh(force=True) is True
    assert writable.exists()

    fresh = EarnRegistry(default_config(), writable_path=writable)
    assert fresh.current() is not None
    assert fresh.loaded_from == "persisted"


async def test_feature_flag_off_never_calls_the_fetcher(tmp_path: Path) -> None:
    calls: list[int] = []

    async def fetcher(_: object) -> list:
        calls.append(1)
        return []

    config = replace(default_config(), feature_enabled=False)
    registry = EarnRegistry(config, writable_path=tmp_path / "x.json", fetcher=fetcher)
    assert await registry.refresh(force=True) is False
    assert calls == []


def test_config_parses_rails_receipts_and_known_names() -> None:
    config = config_from_dict(
        {
            "feature_enabled": True,
            "chains": [{"chain": "base", "chain_id": 8453, "label": "Base"}],
            "filters": {"listed_only": True, "min_tvl_usd": "1000000", "assets": ["USDC"]},
            "oneclick_receipts": [
                {
                    "symbol": "gtUSDCp",
                    "asset_id": "nep141:base-0x1.omft.near",
                    "decimals": 18,
                    "chain": "base",
                    "wrapper_address": "0x1",
                    "underlying_vault": "0xAAA",
                }
            ],
            "rails": {"direct": True, "oneclick_earn": True, "intents_connect": False},
            "known_vault_names": ["Gauntlet USDC Prime"],
        },
        env={},
    )
    assert config.receipt_for_vault("0xaaa") is not None
    assert config.is_known_vault_name("the Gauntlet USDC Prime vault")
    assert config.intents_connect.supported_assets == {}


async def test_fetch_for_chains_can_skip_filters(monkeypatch: pytest.MonkeyPatch) -> None:
    from sparkpoint_agent.earn import registry as registry_module

    async def fake_fetch(*args, **kwargs):  # noqa: ANN002, ANN003
        return [make_vault(tvl=Decimal("1"))]

    monkeypatch.setattr(registry_module, "_fetch_version", fake_fetch)
    config = default_config()
    raw = await fetch_vaults_for_chains(
        config, config.enabled_chains, apply_filters=False
    )
    assert len(raw) == 2  # one per version, because the fake is called for v1 and v2
