"""Config-driven cross-chain routes for feature 068.

The route table ships as ``routes.json`` inside this package. It is loaded once and can be
overridden with ``CROSSCHAIN_ROUTES_PATH`` so a client question (a new chain, a paused payout,
a changed asset id) is a config edit rather than a code change. ``CROSSCHAIN_ENABLED`` is the
deployment feature flag; unset means the JSON default (enabled).

Nothing here holds a key. The optional 1Click API key is read in :mod:`oneclick` and is never
exposed through this config or any HTTP surface.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal

from ..config import env_flag

ROUTES_PATH_ENV = "CROSSCHAIN_ROUTES_PATH"
FEATURE_FLAG_ENV = "CROSSCHAIN_ENABLED"

AddressKind = Literal["evm", "btc", "sol", "tron", "near"]

_DEFAULT_ROUTES_PATH = Path(__file__).with_name("routes.json")


class CrossChainConfigError(RuntimeError):
    """A malformed route config. Deploys should fail loudly, not quote the wrong asset."""


@dataclass(frozen=True, slots=True)
class CrossChainAsset:
    """One quotable asset. ``asset_id`` is 1Click's opaque asset identifier."""

    key: str
    chain: str
    chain_label: str
    evm_chain_id: int | None
    symbol: str
    asset_id: str
    decimals: int
    address_kind: AddressKind
    enabled: bool = True
    unavailable_reason: str | None = None

    def origin_wire(self, amount: str) -> dict[str, Any]:
        """The ``origin`` object on a ``crosschain_quote`` block."""
        return {
            "key": self.key,
            "chain": self.chain,
            "chainLabel": self.chain_label,
            "symbol": self.symbol,
            "amount": amount,
            "assetId": self.asset_id,
            "evmChainId": self.evm_chain_id,
        }

    def destination_wire(self) -> dict[str, Any]:
        """The ``destination`` object on a ``crosschain_quote`` block."""
        return {
            "key": self.key,
            "chain": self.chain,
            "chainLabel": self.chain_label,
            "symbol": self.symbol,
            "assetId": self.asset_id,
            "addressKind": self.address_kind,
        }


@dataclass(frozen=True, slots=True)
class CrossChainConfig:
    """The loaded route table + policy defaults."""

    feature_enabled: bool
    base_url: str
    slippage_bps: int
    deadline_minutes: int
    chain_aliases: Mapping[str, str]
    default_origin: Mapping[str, str]
    assets: Mapping[str, CrossChainAsset]

    def asset(self, key: str) -> CrossChainAsset | None:
        return self.assets.get(key)

    def resolve_chain(self, phrase: str) -> str | None:
        """Resolve a chain name/alias to its short chain key (``ethereum`` → ``eth``)."""
        normalised = " ".join(phrase.lower().strip().split())
        normalised = normalised.strip(" .,!?:;")
        if not normalised:
            return None
        if normalised in self.chain_aliases:
            return self.chain_aliases[normalised]
        # Try the longest prefix: "ethereum mainnet to base" was not split by the caller.
        for alias in sorted(self.chain_aliases, key=len, reverse=True):
            if normalised == alias or normalised.startswith(f"{alias} "):
                return self.chain_aliases[alias]
        return None

    def find_asset(self, chain: str, symbol: str) -> CrossChainAsset | None:
        wanted = symbol.strip().upper()
        for asset in self.assets.values():
            if asset.chain == chain and asset.symbol.upper() == wanted:
                return asset
        return None

    def default_for_symbol(self, symbol: str) -> CrossChainAsset | None:
        key = self.default_origin.get(symbol.strip().upper())
        return self.assets.get(key) if key is not None else None

    def public_assets(self) -> list[dict[str, Any]]:
        """The keyless ``GET /crosschain/assets`` view — no 1Click URL or key material."""
        return [
            {
                "key": asset.key,
                "chain": asset.chain,
                "chainLabel": asset.chain_label,
                "evmChainId": asset.evm_chain_id,
                "symbol": asset.symbol,
                "assetId": asset.asset_id,
                "decimals": asset.decimals,
                "addressKind": asset.address_kind,
                "enabled": asset.enabled,
                **(
                    {"unavailableReason": asset.unavailable_reason}
                    if asset.unavailable_reason
                    else {}
                ),
            }
            for asset in self.assets.values()
        ]


def _asset_from_json(raw: Mapping[str, Any]) -> CrossChainAsset:
    kind = str(raw.get("address_kind", ""))
    if kind not in {"evm", "btc", "sol", "tron", "near"}:
        raise CrossChainConfigError(f"unknown address_kind {kind!r} for {raw.get('key')!r}")
    try:
        return CrossChainAsset(
            key=str(raw["key"]),
            chain=str(raw["chain"]),
            chain_label=str(raw["chain_label"]),
            evm_chain_id=(
                int(raw["evm_chain_id"]) if raw.get("evm_chain_id") is not None else None
            ),
            symbol=str(raw["symbol"]),
            asset_id=str(raw["asset_id"]),
            decimals=int(raw["decimals"]),
            address_kind=kind,  # type: ignore[arg-type]
            enabled=bool(raw.get("enabled", True)),
            unavailable_reason=(
                str(raw["unavailable_reason"]) if raw.get("unavailable_reason") else None
            ),
        )
    except KeyError as exc:
        raise CrossChainConfigError(f"route asset is missing {exc.args[0]!r}") from exc


def config_from_dict(
    raw: Mapping[str, Any], *, env: Mapping[str, str] | None = None
) -> CrossChainConfig:
    """Build a config from an already-parsed route document (used by tests too)."""
    source = env if env is not None else os.environ
    assets = [_asset_from_json(item) for item in raw.get("assets", [])]
    by_key = {asset.key: asset for asset in assets}
    if len(by_key) != len(assets):
        raise CrossChainConfigError("duplicate asset key in cross-chain routes")
    enabled_default = bool(raw.get("feature_enabled", True))
    if FEATURE_FLAG_ENV in source:
        enabled = env_flag(FEATURE_FLAG_ENV, default=enabled_default)
    else:
        enabled = enabled_default
    return CrossChainConfig(
        feature_enabled=enabled,
        base_url=str(raw.get("base_url", "https://1click.chaindefuser.com/v0")),
        slippage_bps=int(raw.get("slippage_bps", 100)),
        deadline_minutes=int(raw.get("deadline_minutes", 30)),
        chain_aliases={
            str(alias).lower(): str(chain) for alias, chain in raw.get("chain_aliases", {}).items()
        },
        default_origin={
            str(symbol).upper(): str(key) for symbol, key in raw.get("default_origin", {}).items()
        },
        assets=by_key,
    )


@lru_cache(maxsize=8)
def _load_json(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise CrossChainConfigError(f"route config {path!r} must be a JSON object")
    return document


def load_config(
    path: str | Path | None = None, *, env: Mapping[str, str] | None = None
) -> CrossChainConfig:
    """Load the route table (default ``routes.json``; env can point elsewhere)."""
    source = env if env is not None else os.environ
    selected = path if path is not None else source.get(ROUTES_PATH_ENV)
    route_path = Path(selected) if selected else _DEFAULT_ROUTES_PATH
    try:
        raw = _load_json(str(route_path))
    except OSError as exc:  # pragma: no cover - deployment misconfiguration
        raise CrossChainConfigError(f"cannot read cross-chain routes at {route_path}") from exc
    return config_from_dict(raw, env=source)


@lru_cache(maxsize=1)
def default_config() -> CrossChainConfig:
    """The process config, loaded once. Tests use ``load_config(path)`` or ``config_from_dict``."""
    return load_config()
