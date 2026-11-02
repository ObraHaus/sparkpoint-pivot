# ruff: noqa: S101
"""070 — Kamino kVault normalization, metrics merge, auto-discovery and config-only additions."""

from __future__ import annotations

import copy
import json
from dataclasses import replace
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx

from sparkpoint_agent.earn.config import (
    EarnConfig,
    KaminoVaultConfig,
    config_from_dict,
    default_config,
)
from sparkpoint_agent.earn.kamino import (
    fetch_kamino_vaults,
    normalize_kamino_vault,
    select_candidates,
)
from sparkpoint_agent.earn.rails import LIVE, ReceiptLivenessCache, resolve_rails
from sparkpoint_agent.earn.registry import VaultEntry

from .helpers import KV_SHARES, KV_VAULT, SOL_MINT, make_kamino_vault

USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
USDC_VAULT = "11111111111111111111111111111111111111111111"
_RAW_CONFIG = json.loads(
    (Path(__file__).resolve().parents[2] / "src/sparkpoint_agent/earn/earn.json").read_text()
)


def _raw_config_dict(**changes: Any) -> dict[str, Any]:
    raw = copy.deepcopy(_RAW_CONFIG)
    for key, value in changes.items():
        raw[key] = value
    return raw


def _raw_vault(
    *,
    address: str = KV_VAULT,
    name: str = "SOL Balanced",
    mint: str = SOL_MINT,
    decimals: int = 9,
    shares: str = KV_SHARES,
) -> dict[str, Any]:
    return {
        "address": address,
        "state": {
            "name": name,
            "tokenMint": mint,
            "tokenMintDecimals": decimals,
            "sharesMint": shares,
            "sharesMintDecimals": decimals,
            "sharesIssued": "24295359617769",
            "prevAum": "25641892711867",
            "managementFeeBps": 0,
            "performanceFeeBps": 0,
            "depositCap": "0",
        },
    }


def _metrics(apy: str = "0.044515236", tvl: str = "2443425.6255") -> dict[str, Any]:
    return {
        "apy": apy,
        "apy7d": "0.053151",
        "apy30d": "0.048921",
        "tokensInvestedUsd": tvl,
        "sharePrice": "100.5717",
        "tokensPerShare": "1.0554273",
    }


def _transport(catalog: list[dict[str, Any]], metrics: dict[str, Any]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/kvaults/vaults"):
            return httpx.Response(200, json=catalog)
        if request.url.path.endswith("/metrics"):
            address = request.url.path.split("/")[-2]
            payload = metrics.get(address)
            if payload is None:
                return httpx.Response(404, json={"message": "not found"})
            return httpx.Response(200, json=payload)
        return httpx.Response(404, json={"message": "not found"})

    return httpx.MockTransport(handler)


def test_normalize_reads_metrics_and_keeps_the_share_mint() -> None:
    config = default_config()
    entry = normalize_kamino_vault(
        _raw_vault(),
        _metrics(),
        config=config,
        fetched_at="2026-11-01T00:00:00+00:00",
    )
    assert entry is not None
    assert entry.protocol == "kamino"
    assert entry.chain == "sol" and entry.chain_id == 0
    assert entry.version == "kvault"
    assert entry.address == KV_VAULT
    assert entry.asset.address == SOL_MINT
    assert entry.asset.symbol == "SOL"
    assert entry.tvl_usd == Decimal("2443425.6255")
    assert entry.net_apy_percent == "4.4515236"


def test_auto_discover_off_shows_only_configured_vaults() -> None:
    config = default_config()
    catalog = [
        _raw_vault(),
        _raw_vault(address=USDC_VAULT, name="USDC Vault", mint=USDC_MINT, decimals=6),
    ]
    assert [item["address"] for item in select_candidates(catalog, config)] == [KV_VAULT]


def test_auto_discover_on_includes_filtered_assets_and_skips_unknown_mints() -> None:
    raw = _raw_config_dict()
    raw["kamino"]["auto_discover"] = True
    config = config_from_dict(raw, env={})
    catalog = [
        _raw_vault(),
        _raw_vault(address=USDC_VAULT, name="USDC Vault", mint=USDC_MINT, decimals=6),
        _raw_vault(address="DaiVault111111111111111111111111111111111111", mint="DaiMint"),
    ]
    addresses = [item["address"] for item in select_candidates(catalog, config)]
    assert addresses == [KV_VAULT, USDC_VAULT]


async def test_fetch_enriches_configured_vault_with_metrics() -> None:
    config = default_config()
    catalog = [
        _raw_vault(),
        _raw_vault(address=USDC_VAULT, name="Other", mint=USDC_MINT, decimals=6),
    ]
    entries = await fetch_kamino_vaults(
        config, transport=_transport(catalog, {KV_VAULT: _metrics()})
    )
    assert [entry.address for entry in entries] == [KV_VAULT]
    assert entries[0].net_apy == Decimal("0.044515236")
    assert entries[0].tvl_usd is not None and entries[0].tvl_usd > 2_000_000


async def test_fetch_fails_open_when_the_api_is_broken() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"message": "down"})

    config = default_config()
    entries = await fetch_kamino_vaults(
        config, transport=httpx.MockTransport(handler)
    )
    assert entries == []


def _config_with_usdc_vault() -> tuple[EarnConfig, str]:
    raw = _raw_config_dict()
    raw["kamino"]["vaults"].append(
        {
            "address": USDC_VAULT,
            "name": "USDC Balanced",
            "asset": "USDC",
            "shares_mint": "ShareMint11111111111111111111111111111111",
        }
    )
    raw["oneclick_receipts"].append(
        {
            "symbol": "kV-USDCb",
            "asset_id": "nep141:sol-0xUSDC.omdep.near",
            "decimals": 6,
            "chain": "sol",
            "wrapper_address": "ShareMint11111111111111111111111111111111",
            "underlying_vault": USDC_VAULT,
            "protocol": "kamino",
            "receipt_kind": "native_shares",
        }
    )
    return config_from_dict(raw, env={}), USDC_VAULT


async def test_a_usdc_vault_plus_receipt_in_config_appears_with_the_oneclick_rail() -> None:
    """The acceptance test for "data-driven": config-only, no code change."""
    config, address = _config_with_usdc_vault()
    catalog = [
        _raw_vault(address=address, name="USDC Balanced", mint=USDC_MINT, decimals=6)
    ]
    entries = await fetch_kamino_vaults(
        config,
        transport=_transport(catalog, {address: _metrics(apy="0.051", tvl="9000000")}),
    )
    assert len(entries) == 1
    entry = entries[0]
    assert entry.asset.symbol == "USDC"
    assert entry.protocol == "kamino"

    receipt = config.receipt_for_vault(address)
    assert receipt is not None and receipt.symbol == "kV-USDCb"
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    liveness.set(receipt.asset_id, LIVE)
    rails = resolve_rails(config, entry, liveness=liveness, aurora_key="")
    assert "oneclick_earn" in rails.available
    assert rails.detail["oneclickEarn"]["receipt"]["receiptKind"] == "native_shares"
    assert "native Kamino" in rails.detail["oneclickEarn"]["note"]


def test_solana_receipt_matching_and_keys_are_case_sensitive() -> None:
    config = default_config()
    assert config.receipt_for_vault(KV_VAULT) is not None
    assert config.receipt_for_vault(KV_VAULT.lower()) is None

    entry = make_kamino_vault()
    assert entry.key.endswith(KV_VAULT)
    assert entry.key != f"sol:{KV_VAULT.lower()}"

    assert config.receipt_for_symbol("kV-gtSOLb") is not None
    assert config.receipt_for_symbol("kV-GTSOLB") is not None


def test_kamino_config_only_vault_dataclass_is_used_for_curated_defaults() -> None:
    config, address = _config_with_usdc_vault()
    assert any(vault.address == address for vault in config.kamino.vaults)
    assert isinstance(config.kamino.vaults[-1], KaminoVaultConfig)
    assert config.kamino.token_mints["USDC"].decimals == 6


def test_wire_emits_protocol_only_for_kamino() -> None:
    from .helpers import make_vault

    entry: VaultEntry = make_kamino_vault()
    assert entry.wire()["protocol"] == "kamino"
    assert "protocol" not in make_vault().wire()


async def test_registry_fetch_merges_morpho_and_kamino_rows(
    monkeypatch: Any,
) -> None:
    from sparkpoint_agent.earn import kamino as kamino_module
    from sparkpoint_agent.earn import registry as registry_module
    from sparkpoint_agent.earn import rhea as rhea_module

    async def fake_morpho(config: EarnConfig, chains: Any) -> list[VaultEntry]:
        return [
            replace(
                make_kamino_vault(),
                protocol="morpho",
                chain="base",
                chain_id=8453,
            )
        ]

    async def fake_kamino(config: EarnConfig, **_: Any) -> list[VaultEntry]:
        return [make_kamino_vault()]

    async def fake_rhea(config: EarnConfig, **_: Any) -> list[VaultEntry]:
        from .helpers import make_rhea_vault

        return [make_rhea_vault()]

    monkeypatch.setattr(registry_module, "fetch_vaults_for_chains", fake_morpho)
    monkeypatch.setattr(kamino_module, "fetch_kamino_vaults", fake_kamino)
    monkeypatch.setattr(rhea_module, "fetch_rhea_vaults", fake_rhea)
    entries = await registry_module.fetch_vaults(default_config())
    assert {entry.protocol for entry in entries} == {"morpho", "kamino", "rhea"}
