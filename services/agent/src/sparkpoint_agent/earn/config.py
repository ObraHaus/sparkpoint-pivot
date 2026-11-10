"""Config for features 069/070 — the data-driven earn registry (Morpho + Kamino).

``earn.json`` ships inside this package and is overridable with ``EARN_CONFIG_PATH``;
``EARN_ENABLED`` is the deployment flag (unset means the JSON default). Everything a client can
ask for — a newly enabled chain, a different TVL floor, a curated default, a 1Click receipt, a
Kamino vault — is one JSON edit, never a code change.

No key material lives here. ``AURORA_INTENTS_API_KEY`` is read only by :mod:`rails` and is never
returned through any serialized config or HTTP surface.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass, field
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


def normalize_address(value: str) -> str:
    """Case-normalize an address for matching.

    EVM addresses are case-insensitive (lowercase them); Solana/base58 addresses are
    case-SENSITIVE, so every other value is returned untouched. This is the only place the
    registry is allowed to normalize an address for equality/key purposes.
    """
    text = value.strip()
    return text.lower() if text.startswith("0x") else text


def addresses_equal(left: str, right: str) -> bool:
    """Address equality with the EVM-only lowercase rule above."""
    return normalize_address(left) == normalize_address(right)


@dataclass(frozen=True, slots=True)
class EarnChain:
    chain: str
    chain_id: int
    label: str
    enabled: bool = True
    protocols: tuple[str, ...] = ("morpho",)


@dataclass(frozen=True, slots=True)
class OneClickReceipt:
    """One 1Click Earn receipt for a yield vault.

    ``receipt_kind="wrapper"`` is a NEAR-issued ERC-4626 wrapper (069 Morpho); ``native_shares``
    is the native Kamino kVault share mint on Solana (070). ``protocol`` defaults to Morpho so old
    ``earn.json`` files keep working.
    """

    symbol: str
    asset_id: str
    decimals: int
    chain: str
    wrapper_address: str
    underlying_vault: str
    protocol: str = "morpho"
    receipt_kind: str = "wrapper"

    def wire(self) -> dict[str, Any]:
        wire = {
            "symbol": self.symbol,
            "assetId": self.asset_id,
            "decimals": self.decimals,
            "chain": self.chain,
            "wrapperAddress": self.wrapper_address,
            "underlyingVault": self.underlying_vault,
        }
        # Additive: 069 fixtures stay byte-identical for the Morpho defaults.
        if self.protocol != "morpho":
            wire["protocol"] = self.protocol
        if self.receipt_kind != "wrapper":
            wire["receiptKind"] = self.receipt_kind
        return wire


@dataclass(frozen=True, slots=True)
class KaminoTokenMint:
    mint: str
    decimals: int


@dataclass(frozen=True, slots=True)
class KaminoVaultConfig:
    """A Kamino kVault the deployment chose to list (config-only addition)."""

    address: str
    name: str
    asset: str
    shares_mint: str


@dataclass(frozen=True, slots=True)
class KaminoConfig:
    enabled: bool = False
    api_url: str = "https://api.kamino.finance"
    auto_discover: bool = False
    token_mints: Mapping[str, KaminoTokenMint] = field(default_factory=dict)
    assets: tuple[str, ...] = ()
    min_tvl_usd: str = "1000000"
    vaults: tuple[KaminoVaultConfig, ...] = ()

    def asset_for_mint(self, mint: str) -> tuple[str, int] | None:
        for symbol, token in self.token_mints.items():
            if token.mint == mint:
                return symbol, token.decimals
        return None

    def configured(self) -> tuple[KaminoVaultConfig, ...]:
        return self.vaults


@dataclass(frozen=True, slots=True)
class RheaAsset:
    """One Burrow (Rhea) lending asset the deployment chose to list."""

    symbol: str
    token_id: str
    asset_id: str
    decimals: int
    enabled: bool = True


#: A first Rhea deposit pays TWO one-off Multica fees in the same receipt: the create-MCA fee
#: (read live from ``get_create_mca_fee_paged``) AND a DApp registration fee. Multica exposes no
#: public view for the second one, so it is a documented fallback. Observed on-chain on 2026-11-10
#: in a funded cross-chain Rhea test: ``collect_create_mca_fee`` 300000 plus
#: ``collect_dapp_registration_fee`` 300000 for 6-dp USDC (= 0.30 + 0.30 USDC); only 0.399798 of a
#: 0.999798 deposit was supplied.
DEFAULT_DAPP_REGISTRATION_FEE: Mapping[str, str] = {"USDC": "0.30", "USDT": "0.30"}


@dataclass(frozen=True, slots=True)
class RheaConfig:
    """Rhea Finance (Burrow) lending on NEAR — feature 071.

    The asset list lives in ``earn.json`` so enabling USDT (or any other Burrow market) is a data
    edit. RPC URLs, the account-manager contract (``multica.near``) and the Burrow logic contract
    are config too, so a network move never needs a code change. No key material lives here.
    """

    enabled: bool = False
    rpc_urls: tuple[str, ...] = (
        "https://free.rpc.fastnear.com",
        "https://rpc.mainnet.near.org",
    )
    logic_contract: str = "contract.main.burrow.near"
    am_contract: str = "multica.near"
    app_url: str = "https://app.rhea.finance/lending"
    assets: tuple[RheaAsset, ...] = ()
    mca_fee_fallback: Mapping[str, str] = field(default_factory=dict)
    dapp_registration_fee_fallback: Mapping[str, str] = field(
        default_factory=lambda: dict(DEFAULT_DAPP_REGISTRATION_FEE)
    )
    use_as_collateral: bool = False
    origins: tuple[str, ...] = ("base:USDC", "eth:USDC", "sol:USDC")
    default_origin: str = "base:USDC"
    asset_ttl_s: float = 300.0
    fee_ttl_s: float = 300.0
    mca_ttl_s: float = 60.0

    def enabled_assets(self) -> tuple[RheaAsset, ...]:
        return tuple(asset for asset in self.assets if asset.enabled)

    def asset_for_symbol(self, symbol: str) -> RheaAsset | None:
        wanted = symbol.strip().upper()
        for asset in self.assets:
            if asset.symbol.upper() == wanted:
                return asset
        return None

    def asset_for_token(self, token_id: str) -> RheaAsset | None:
        # NEAR account ids are case-sensitive; compare exactly.
        for asset in self.assets:
            if asset.token_id == token_id:
                return asset
        return None

    def supports_origin(self, key: str) -> bool:
        return key in self.origins


@dataclass(frozen=True, slots=True)
class EarnRails:
    direct: bool = True
    oneclick_earn: bool = True
    oneclick_rhea: bool = True
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
    kamino: KaminoConfig = field(default_factory=KaminoConfig)
    rhea: RheaConfig = field(default_factory=RheaConfig)
    dry_probe_addresses: Mapping[str, str] = field(default_factory=dict)

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
        for receipt in self.receipts:
            if addresses_equal(receipt.underlying_vault, vault_address):
                return receipt
        return None

    def receipt_for_symbol(self, symbol: str) -> OneClickReceipt | None:
        wanted = symbol.strip().lower()
        for receipt in self.receipts:
            if receipt.symbol.lower() == wanted:
                return receipt
        return None

    def default_vault(self, chain: str) -> str | None:
        return self.curated_defaults.get(chain)

    def is_known_vault_name(self, text: str) -> bool:
        lowered = text.lower()
        if any(name.lower() in lowered for name in self.known_vault_names):
            return True
        return any(vault.name.lower() in lowered for vault in self.kamino.vaults)

    def known_protocol(self, text: str) -> str | None:
        """Which protocol a message explicitly names (Rhea/Kamino win over Morpho)."""
        lowered = text.lower()
        if "rhea" in lowered or "burrow" in lowered:
            return "rhea"
        if "kamino" in lowered:
            return "kamino"
        if any(vault.name.lower() in lowered for vault in self.kamino.vaults):
            return "kamino"
        if any(receipt.symbol.lower() in lowered for receipt in self.receipts):
            for receipt in self.receipts:
                if receipt.symbol.lower() in lowered:
                    return receipt.protocol
        if "morpho" in lowered:
            return "morpho"
        if any(name.lower() in lowered for name in self.known_vault_names):
            return "morpho"
        return None


def _chain_from_json(raw: Mapping[str, Any]) -> EarnChain:
    try:
        return EarnChain(
            chain=str(raw["chain"]),
            chain_id=int(raw["chain_id"]),
            label=str(raw.get("label") or raw["chain"]),
            enabled=bool(raw.get("enabled", True)),
            protocols=tuple(str(item) for item in (raw.get("protocols") or ("morpho",))),
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
            wrapper_address=normalize_address(str(raw["wrapper_address"])),
            underlying_vault=normalize_address(str(raw["underlying_vault"])),
            protocol=str(raw.get("protocol") or "morpho"),
            receipt_kind=str(raw.get("receipt_kind") or "wrapper"),
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
    kamino_raw = raw.get("kamino") or {}
    rhea_raw = raw.get("rhea") or {}
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
        allowlist=tuple(normalize_address(str(item)) for item in raw.get("allowlist", [])),
        denylist=tuple(normalize_address(str(item)) for item in raw.get("denylist", [])),
        known_vault_names=tuple(str(item) for item in raw.get("known_vault_names", [])),
        curated_defaults={
            str(key): normalize_address(str(value))
            for key, value in (raw.get("curated_defaults") or {}).items()
        },
        receipts=tuple(receipts),
        rails=EarnRails(
            direct=bool(rails_raw.get("direct", True)),
            oneclick_earn=bool(rails_raw.get("oneclick_earn", True)),
            oneclick_rhea=bool(rails_raw.get("oneclick_rhea", True)),
            intents_connect=bool(rails_raw.get("intents_connect", False)),
        ),
        intents_connect=IntentsConnectConfig(
            base_url=str(intents_raw.get("base_url", "https://intents-connect-api.aurora.dev")),
            supported_assets={
                str(chain): tuple(str(item).upper() for item in symbols)
                for chain, symbols in (intents_raw.get("supported_assets") or {}).items()
            },
        ),
        kamino=_kamino_from_json(kamino_raw),
        rhea=_rhea_from_json(rhea_raw),
        dry_probe_addresses={
            str(kind): str(value) for kind, value in (raw.get("dry_probe_addresses") or {}).items()
        },
    )


def _kamino_from_json(raw: Mapping[str, Any]) -> KaminoConfig:
    if not raw:
        return KaminoConfig()
    filters = raw.get("filters") or {}
    token_mints = {
        str(symbol).upper(): KaminoTokenMint(
            mint=str(value["mint"]), decimals=int(value["decimals"])
        )
        for symbol, value in (raw.get("token_mints") or {}).items()
    }
    vaults: list[KaminoVaultConfig] = []
    for item in raw.get("vaults", []):
        try:
            vaults.append(
                KaminoVaultConfig(
                    address=str(item["address"]),
                    name=str(item.get("name") or item["address"]),
                    asset=str(item["asset"]).upper(),
                    shares_mint=str(item.get("shares_mint") or ""),
                )
            )
        except KeyError as exc:
            raise EarnConfigError(f"kamino vault is missing {exc.args[0]!r}") from exc
    return KaminoConfig(
        enabled=bool(raw.get("enabled", False)),
        api_url=str(raw.get("api_url", "https://api.kamino.finance")).rstrip("/"),
        auto_discover=bool(raw.get("auto_discover", False)),
        token_mints=token_mints,
        assets=tuple(str(item).upper() for item in filters.get("assets", [])),
        min_tvl_usd=str(filters.get("min_tvl_usd", "1000000")),
        vaults=tuple(vaults),
    )


def _rhea_from_json(raw: Mapping[str, Any]) -> RheaConfig:
    if not raw:
        return RheaConfig()
    assets: list[RheaAsset] = []
    for item in raw.get("assets", []):
        try:
            assets.append(
                RheaAsset(
                    symbol=str(item["symbol"]).upper(),
                    token_id=_rhea_token_id(item),
                    asset_id=str(item.get("asset_id") or f"nep141:{_rhea_token_id(item)}"),
                    decimals=int(item["decimals"]),
                    enabled=bool(item.get("enabled", True)),
                )
            )
        except KeyError as exc:
            raise EarnConfigError(f"rhea asset is missing {exc.args[0]!r}") from exc
    return RheaConfig(
        enabled=bool(raw.get("enabled", False)),
        rpc_urls=tuple(
            str(item)
            for item in (
                raw.get("rpc_urls")
                or ("https://free.rpc.fastnear.com", "https://rpc.mainnet.near.org")
            )
        ),
        logic_contract=str(raw.get("logic_contract", "contract.main.burrow.near")),
        am_contract=str(raw.get("am_contract", "multica.near")),
        app_url=str(raw.get("app_url", "https://app.rhea.finance/lending")),
        assets=tuple(assets),
        mca_fee_fallback={
            str(key).upper(): str(value)
            for key, value in (raw.get("mca_fee_fallback") or {}).items()
        },
        dapp_registration_fee_fallback={
            str(key).upper(): str(value)
            for key, value in (
                raw.get("dapp_registration_fee_fallback") or DEFAULT_DAPP_REGISTRATION_FEE
            ).items()
        },
        use_as_collateral=bool(raw.get("use_as_collateral", False)),
        origins=tuple(
            str(item) for item in (raw.get("origins") or ("base:USDC", "eth:USDC", "sol:USDC"))
        ),
        default_origin=str(raw.get("default_origin", "base:USDC")),
        asset_ttl_s=float(raw.get("asset_ttl_s", 300.0)),
        fee_ttl_s=float(raw.get("fee_ttl_s", 300.0)),
        mca_ttl_s=float(raw.get("mca_ttl_s", 60.0)),
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


def _rhea_token_id(item: Mapping[str, Any]) -> str:
    """NEAR token account id for a Rhea asset.

    earn.json stores only ``asset_id`` (``nep141:<account>``); the bare account id is derived so
    the 64-hex implicit account never sits next to a ``token``-named key (gitleaks false positive).
    An explicit ``token_id`` is still honoured.
    """
    explicit = item.get("token_id")
    if explicit:
        return str(explicit)
    asset_id = str(item["asset_id"])
    return asset_id.removeprefix("nep141:")
