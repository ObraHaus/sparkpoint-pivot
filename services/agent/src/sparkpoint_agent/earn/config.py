"""Config for feature 069 — the data-driven Morpho earn registry.

``earn.json`` ships inside this package and is overridable with ``EARN_CONFIG_PATH``;
``EARN_ENABLED`` is the deployment flag (unset means the JSON default). Everything a client can
ask for — a newly enabled chain, a different TVL floor, a curated default, a 1Click receipt — is
one JSON edit, never a code change.

No key material lives here. ``AURORA_INTENTS_API_KEY`` is read only by :mod:`rails` and is never
returned through any serialized config or HTTP surface.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from ..config import env_flag

CONFIG_PATH_ENV = "EARN_CONFIG_PATH"
FEATURE_FLAG_ENV = "EARN_ENABLED"
SNAPSHOT_PATH_ENV = "EARN_SNAPSHOT_PATH"
DATA_DIR_ENV = "EARN_DATA_DIR"
AURORA_KEY_ENV = "AURORA_INTENTS_API_KEY"

_DEFAULT_CONFIG_PATH = Path(__file__).with_name("earn.json")
_DEFAULT_SNAPSHOT_PATH = Path(__file__).with_name("snapshot.json")


class EarnConfigError(RuntimeError):
    """A malformed earn config. A deploy should fail loudly rather than show the wrong vaults."""


@dataclass(frozen=True, slots=True)
class EarnChain:
    chain: str
    chain_id: int
    label: str
    enabled: bool = True


@dataclass(frozen=True, slots=True)
class OneClickReceipt:
    """One NEAR-issued ERC-4626 wrapper whose ``asset()`` is a Morpho vault."""

    symbol: str
    asset_id: str
    decimals: int
    chain: str
    wrapper_address: str
    underlying_vault: str

    def wire(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "assetId": self.asset_id,
            "decimals": self.decimals,
            "chain": self.chain,
            "wrapperAddress": self.wrapper_address,
            "underlyingVault": self.underlying_vault,
        }


@dataclass(frozen=True, slots=True)
class EarnRails:
    direct: bool = True
    oneclick_earn: bool = True
    intents_connect: bool = False


@dataclass(frozen=True, slots=True)
class IntentsConnectConfig:
    base_url: str
    supported_assets: Mapping[str, tuple[str, ...]]

    def supports(self, chain: str, symbol: str) -> bool:
        supported = self.supported_assets.get(chain, ())
        return symbol.upper() in {item.upper() for item in supported}


@dataclass(frozen=True, slots=True)
class EarnConfig:
    feature_enabled: bool
    morpho_api_url: str
    refresh_minutes: int
    chains: Mapping[str, EarnChain]
    listed_only: bool
    min_tvl_usd: str
    assets: tuple[str, ...]
    allowlist: tuple[str, ...]
    denylist: tuple[str, ...]
    known_vault_names: tuple[str, ...]
    curated_defaults: Mapping[str, str]
    receipts: tuple[OneClickReceipt, ...]
    rails: EarnRails
    intents_connect: IntentsConnectConfig

    @property
    def enabled_chains(self) -> tuple[EarnChain, ...]:
        return tuple(chain for chain in self.chains.values() if chain.enabled)

    def chain(self, key: str) -> EarnChain | None:
        return self.chains.get(key)

    def chain_by_id(self, chain_id: int) -> EarnChain | None:
        for chain in self.chains.values():
            if chain.chain_id == chain_id:
                return chain
        return None

    def receipt_for_vault(self, vault_address: str) -> OneClickReceipt | None:
        wanted = vault_address.lower()
        for receipt in self.receipts:
            if receipt.underlying_vault.lower() == wanted:
                return receipt
        return None

    def default_vault(self, chain: str) -> str | None:
        return self.curated_defaults.get(chain)

    def is_known_vault_name(self, text: str) -> bool:
        lowered = text.lower()
        return any(name.lower() in lowered for name in self.known_vault_names)


def _chain_from_json(raw: Mapping[str, Any]) -> EarnChain:
    try:
        return EarnChain(
            chain=str(raw["chain"]),
            chain_id=int(raw["chain_id"]),
            label=str(raw.get("label") or raw["chain"]),
            enabled=bool(raw.get("enabled", True)),
        )
    except KeyError as exc:
        raise EarnConfigError(f"chain is missing {exc.args[0]!r}") from exc


def _receipt_from_json(raw: Mapping[str, Any]) -> OneClickReceipt:
    try:
        return OneClickReceipt(
            symbol=str(raw["symbol"]),
            asset_id=str(raw["asset_id"]),
            decimals=int(raw["decimals"]),
            chain=str(raw["chain"]),
            wrapper_address=str(raw["wrapper_address"]).lower(),
            underlying_vault=str(raw["underlying_vault"]).lower(),
        )
    except KeyError as exc:
        raise EarnConfigError(f"oneclick receipt is missing {exc.args[0]!r}") from exc


def config_from_dict(raw: Mapping[str, Any], *, env: Mapping[str, str] | None = None) -> EarnConfig:
    source = env if env is not None else os.environ
    chains = [_chain_from_json(item) for item in raw.get("chains", [])]
    by_chain = {chain.chain: chain for chain in chains}
    if len(by_chain) != len(chains):
        raise EarnConfigError("duplicate chain key in earn config")
    receipts = [_receipt_from_json(item) for item in raw.get("oneclick_receipts", [])]
    filters = raw.get("filters") or {}
    rails_raw = raw.get("rails") or {}
    intents_raw = raw.get("intents_connect") or {}
    enabled_default = bool(raw.get("feature_enabled", True))
    enabled = (
        env_flag(FEATURE_FLAG_ENV, default=enabled_default)
        if FEATURE_FLAG_ENV in source
        else enabled_default
    )
    return EarnConfig(
        feature_enabled=enabled,
        morpho_api_url=str(raw.get("morpho_api_url", "https://api.morpho.org/graphql")),
        refresh_minutes=int(raw.get("refresh_minutes", 360)),
        chains=by_chain,
        listed_only=bool(filters.get("listed_only", True)),
        min_tvl_usd=str(filters.get("min_tvl_usd", "1000000")),
        assets=tuple(str(item).upper() for item in filters.get("assets", [])),
        allowlist=tuple(str(item).lower() for item in raw.get("allowlist", [])),
        denylist=tuple(str(item).lower() for item in raw.get("denylist", [])),
        known_vault_names=tuple(str(item) for item in raw.get("known_vault_names", [])),
        curated_defaults={
            str(key): str(value).lower()
            for key, value in (raw.get("curated_defaults") or {}).items()
        },
        receipts=tuple(receipts),
        rails=EarnRails(
            direct=bool(rails_raw.get("direct", True)),
            oneclick_earn=bool(rails_raw.get("oneclick_earn", True)),
            intents_connect=bool(rails_raw.get("intents_connect", False)),
        ),
        intents_connect=IntentsConnectConfig(
            base_url=str(
                intents_raw.get("base_url", "https://intents-connect-api.aurora.dev")
            ),
            supported_assets={
                str(chain): tuple(str(item).upper() for item in symbols)
                for chain, symbols in (intents_raw.get("supported_assets") or {}).items()
            },
        ),
    )


@lru_cache(maxsize=8)
def _load_json(path: str) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    if not isinstance(document, dict):
        raise EarnConfigError(f"earn config {path!r} must be a JSON object")
    return document


def load_config(
    path: str | Path | None = None, *, env: Mapping[str, str] | None = None
) -> EarnConfig:
    source = env if env is not None else os.environ
    selected = path if path is not None else source.get(CONFIG_PATH_ENV)
    config_path = Path(selected) if selected else _DEFAULT_CONFIG_PATH
    try:
        raw = _load_json(str(config_path))
    except OSError as exc:  # pragma: no cover - deployment misconfiguration
        raise EarnConfigError(f"cannot read earn config at {config_path}") from exc
    return config_from_dict(raw, env=source)


@lru_cache(maxsize=1)
def default_config() -> EarnConfig:
    return load_config()


def shipped_snapshot_path() -> Path:
    return _DEFAULT_SNAPSHOT_PATH


def snapshot_path(*, env: Mapping[str, str] | None = None) -> Path:
    """The writable snapshot path (env override, else under the agent data dir)."""
    source = env if env is not None else os.environ
    explicit = source.get(SNAPSHOT_PATH_ENV)
    if explicit:
        return Path(explicit)
    data_dir = source.get(DATA_DIR_ENV) or "/var/lib/sparkpoint-agent"
    return Path(data_dir) / "earn-snapshot.json"
