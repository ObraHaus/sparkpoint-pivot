"""Morpho vault registry (feature 069) — fetch once, read from a snapshot everywhere else.

WHY A SNAPSHOT. Morpho's API is rate-limited and sustained abuse reportedly triggers a long
cooldown (see ``data/morpho_api.py``). A request handler must never touch it. This module fetches
V1 and V2 in SEPARATE GraphQL requests (a combined query fails as a whole on NOT_FOUND), applies
the configured filters, and keeps the result in memory with a TTL. It is also persisted to a
writable JSON file, and a shipped ``snapshot.json`` is the last-resort fallback, so the app still
serves an honest list when the API is unreachable or the deploy cannot write its data dir.

V1 (MetaMorpho) puts TVL/APY under ``state``. V2 puts them at the TOP LEVEL — asking for V2's
``state`` is a schema error, so the two queries are deliberately not shared.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Final

import httpx

from .config import EarnChain, EarnConfig, normalize_address, shipped_snapshot_path, snapshot_path

logger = logging.getLogger("sparkpoint_agent.earn.registry")

USER_AGENT: Final = "sparkpoint-agent/1.0"
TIMEOUT_S: Final = 15.0
#: Morpho's GraphQL charges ~1,725 complexity per V2 item once ``avgNetApy`` is requested, so a
#: ``first:1000`` V2 page is rejected as "Query is too complex" (403). 500 stays under the cap;
#: V1 is cheaper and 1,000 works. Verified 2026-11-01.
PAGE_SIZE_V1: Final = 1000
PAGE_SIZE_V2: Final = 500
MAX_PAGES: Final = 20

_V1_QUERY: Final = """
query EarnVaultsV1($first: Int!, $skip: Int!, $chainIds: [Int!]!) {
  vaults(first: $first, skip: $skip, where: {chainId_in: $chainIds}) {
    items {
      address
      name
      symbol
      listed
      chain { id network }
      asset { address symbol decimals }
      state { totalAssetsUsd netApy }
    }
    pageInfo { countTotal count limit skip }
  }
}
"""

_V2_QUERY: Final = """
query EarnVaultsV2($first: Int!, $skip: Int!, $chainIds: [Int!]!) {
  vaultV2s(first: $first, skip: $skip, where: {chainId_in: $chainIds}) {
    items {
      address
      name
      symbol
      listed
      chain { id network }
      asset { address symbol decimals }
      totalAssetsUsd
      netApy
      avgNetApy
    }
    pageInfo { countTotal count limit skip }
  }
}
"""


class MorphoRegistryError(RuntimeError):
    """A failed/unusable Morpho response. The caller falls back to the snapshot."""


@dataclass(frozen=True, slots=True)
class VaultAsset:
    address: str
    symbol: str
    decimals: int

    def wire(self) -> dict[str, Any]:
        return {
            "address": self.address,
            "symbol": self.symbol,
            "decimals": self.decimals,
        }


@dataclass(frozen=True, slots=True)
class VaultEntry:
    chain: str
    chain_id: int
    address: str
    version: str
    name: str
    symbol: str
    asset: VaultAsset
    listed: bool
    tvl_usd: Decimal | None
    net_apy: Decimal | None
    source: str = "morpho_api"
    fetched_at: str = ""
    protocol: str = "morpho"

    @property
    def key(self) -> str:
        return f"{self.chain}:{normalize_address(self.address)}"

    @property
    def net_apy_percent(self) -> str | None:
        """The API's fraction (``0.0441``) rendered as a display percent (``4.41``)."""
        return _percent(self.net_apy)

    def wire(self) -> dict[str, Any]:
        wire = {
            "chain": self.chain,
            "chainId": self.chain_id,
            "address": self.address,
            "version": self.version,
            "name": self.name,
            "symbol": self.symbol,
            "asset": self.asset.wire(),
            "listed": self.listed,
            "tvlUsd": _decimal_str(self.tvl_usd),
            "netApy": self.net_apy_percent,
            "source": self.source,
            "fetchedAt": self.fetched_at,
        }
        # Additive: Morpho rows omit the field (069 fixtures stay byte-identical); clients default
        # an absent protocol to "morpho".
        if self.protocol != "morpho":
            wire["protocol"] = self.protocol
        return wire

    def to_json(self) -> dict[str, Any]:
        wire = {
            "chain": self.chain,
            "chainId": self.chain_id,
            "address": self.address,
            "version": self.version,
            "name": self.name,
            "symbol": self.symbol,
            "asset": self.asset.wire(),
            "listed": self.listed,
            "tvlUsd": _decimal_str(self.tvl_usd),
            "netApy": _decimal_str(self.net_apy),
            "source": self.source,
            "fetchedAt": self.fetched_at,
        }
        if self.protocol != "morpho":
            wire["protocol"] = self.protocol
        return wire

    @classmethod
    def from_json(cls, raw: Mapping[str, Any]) -> VaultEntry:
        asset_raw = raw.get("asset")
        if not isinstance(asset_raw, Mapping):
            raise ValueError("vault asset missing")
        return cls(
            chain=str(raw["chain"]),
            chain_id=int(raw["chainId"]),
            address=str(raw["address"]),
            version=str(raw.get("version", "v1")),
            name=str(raw.get("name", "")),
            symbol=str(raw.get("symbol", "")),
            asset=VaultAsset(
                address=str(asset_raw.get("address", "")),
                symbol=str(asset_raw.get("symbol", "")),
                decimals=int(asset_raw.get("decimals", 0)),
            ),
            listed=bool(raw.get("listed", False)),
            tvl_usd=_to_decimal(raw.get("tvlUsd")),
            net_apy=_to_decimal(raw.get("netApy")),
            source=str(raw.get("source", "morpho_api")),
            fetched_at=str(raw.get("fetchedAt", "")),
            protocol=str(raw.get("protocol") or "morpho"),
        )


@dataclass(frozen=True, slots=True)
class EarnSnapshot:
    fetched_at: datetime
    source: str
    vaults: tuple[VaultEntry, ...]

    @property
    def is_empty(self) -> bool:
        return not self.vaults

    def age_minutes(self, *, now: datetime | None = None) -> int:
        moment = now or datetime.now(UTC)
        return max(0, int((moment - self.fetched_at).total_seconds() // 60))


def _to_decimal(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        return None
    return number


def _decimal_str(value: Decimal | None) -> str | None:
    if value is None:
        return None
    return format(value, "f")


def _percent(value: Decimal | None) -> str | None:
    if value is None:
        return None
    text = format(value * Decimal(100), "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def _parse_timestamp(raw: Any) -> datetime:
    if isinstance(raw, str) and raw:
        try:
            return datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            pass
    return datetime.now(UTC)


def normalize_vault(
    raw: Mapping[str, Any],
    *,
    chain: str,
    chain_id: int,
    version: str,
    fetched_at: str,
) -> VaultEntry | None:
    """One API item → :class:`VaultEntry`. Unknown/absent fields are omitted, never guessed."""
    address = raw.get("address")
    asset_raw = raw.get("asset")
    if not isinstance(address, str) or not isinstance(asset_raw, Mapping):
        return None
    state = raw.get("state")
    state = state if isinstance(state, Mapping) else {}
    tvl_value = raw.get("totalAssetsUsd") if version == "v2" else state.get("totalAssetsUsd")
    apy_value = raw.get("avgNetApy") if version == "v2" else state.get("netApy")
    if apy_value is None:
        apy_value = raw.get("netApy")
    return VaultEntry(
        chain=chain,
        chain_id=chain_id,
        address=address,
        version=version,
        name=str(raw.get("name") or ""),
        symbol=str(raw.get("symbol") or ""),
        asset=VaultAsset(
            address=str(asset_raw.get("address") or ""),
            symbol=str(asset_raw.get("symbol") or ""),
            decimals=int(asset_raw.get("decimals") or 0),
        ),
        listed=bool(raw.get("listed", False)),
        tvl_usd=_to_decimal(tvl_value),
        net_apy=_to_decimal(apy_value),
        fetched_at=fetched_at,
    )


def _apply_filters(config: EarnConfig, entries: Iterable[VaultEntry]) -> list[VaultEntry]:
    allow = set(config.allowlist)
    deny = set(config.denylist)
    floor = _to_decimal(config.min_tvl_usd) or Decimal(0)
    assets = set(config.assets)
    filtered: list[VaultEntry] = []
    for entry in entries:
        address = normalize_address(entry.address)
        if allow and address not in allow:
            continue
        if address in deny:
            continue
        if config.listed_only and not entry.listed:
            continue
        if assets and entry.asset.symbol.upper() not in assets:
            continue
        if entry.tvl_usd is None or entry.tvl_usd < floor:
            continue
        filtered.append(entry)
    filtered.sort(key=lambda item: (item.tvl_usd or Decimal(0)), reverse=True)
    return filtered


async def _fetch_version(
    client: httpx.AsyncClient,
    url: str,
    *,
    version: str,
    chain_ids: Sequence[int],
    chain_labels: Mapping[int, str],
    fetched_at: str,
) -> list[VaultEntry]:
    query = _V2_QUERY if version == "v2" else _V1_QUERY
    root = "vaultV2s" if version == "v2" else "vaults"
    entries: list[VaultEntry] = []
    skip = 0
    page_size = PAGE_SIZE_V2 if version == "v2" else PAGE_SIZE_V1
    for _ in range(MAX_PAGES):
        response = await client.post(
            url,
            json={
                "query": query,
                "variables": {"first": page_size, "skip": skip, "chainIds": list(chain_ids)},
            },
        )
        if response.status_code != 200:
            raise MorphoRegistryError(f"morpho http {response.status_code}")
        try:
            body = response.json()
        except ValueError as exc:
            raise MorphoRegistryError("morpho returned invalid json") from exc
        if not isinstance(body, Mapping) or body.get("errors"):
            raise MorphoRegistryError("morpho graphql errors")
        data = body.get("data")
        block = data.get(root) if isinstance(data, Mapping) else None
        items = block.get("items") if isinstance(block, Mapping) else None
        if not isinstance(items, list):
            raise MorphoRegistryError("morpho returned an unexpected shape")
        for item in items:
            if not isinstance(item, Mapping):
                continue
            chain = item.get("chain")
            chain_id_raw = chain.get("id") if isinstance(chain, Mapping) else None
            if not isinstance(chain_id_raw, (int, str)):
                continue
            try:
                chain_id = int(chain_id_raw)
            except (TypeError, ValueError):
                continue
            normalized = normalize_vault(
                item,
                chain=chain_labels.get(chain_id, str(chain_id)),
                chain_id=chain_id,
                version=version,
                fetched_at=fetched_at,
            )
            if normalized is not None:
                entries.append(normalized)
        page = block.get("pageInfo") if isinstance(block, Mapping) else None
        total = page.get("countTotal") if isinstance(page, Mapping) else None
        skip += len(items)
        if not isinstance(total, int) or skip >= total or not items:
            break
    return entries


async def fetch_vaults_for_chains(
    config: EarnConfig,
    chains: Sequence[EarnChain],
    *,
    apply_filters: bool = True,
) -> list[VaultEntry]:
    """Fetch Morpho V1/V2 vaults for ``chains`` (one query per version, paginated if needed).

    Non-EVM chains (the Solana/Kamino chain uses chain_id 0) are skipped: Morpho only indexes EVM
    chains, and sending id 0 to its GraphQL API would return noise.
    """
    chains = [
        chain
        for chain in chains
        if chain.chain_id > 0 and "morpho" in chain.protocols
    ]
    if not chains:
        return []
    chain_ids = [chain.chain_id for chain in chains]
    labels = {chain.chain_id: chain.chain for chain in chains}
    fetched_at = datetime.now(UTC).isoformat()
    entries: list[VaultEntry] = []
    async with httpx.AsyncClient(
        timeout=TIMEOUT_S, headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
    ) as client:
        for version in ("v1", "v2"):
            entries.extend(
                await _fetch_version(
                    client,
                    config.morpho_api_url,
                    version=version,
                    chain_ids=chain_ids,
                    chain_labels=labels,
                    fetched_at=fetched_at,
                )
            )
    return _apply_filters(config, entries) if apply_filters else entries


async def fetch_vaults(config: EarnConfig) -> list[VaultEntry]:
    """Fetch + filter every enabled Morpho vault, then merge Kamino and Rhea rows."""
    entries = await fetch_vaults_for_chains(config, config.enabled_chains)
    if config.kamino.enabled:
        from .kamino import fetch_kamino_vaults

        entries.extend(await fetch_kamino_vaults(config))
    if config.rhea.enabled:
        from .rhea import fetch_rhea_vaults

        entries.extend(await fetch_rhea_vaults(config))
    return entries


def filter_vaults(
    config: EarnConfig, entries: Iterable[VaultEntry]
) -> list[VaultEntry]:
    """The public filter helper (used by the snapshot script and tests)."""
    return _apply_filters(config, entries)


class EarnRegistry:
    """An in-memory registry backed by a writable snapshot and a shipped fallback."""

    def __init__(
        self,
        config: EarnConfig,
        *,
        writable_path: Path | None = None,
        fallback_path: Path | None = None,
        fetcher: Callable[[EarnConfig], Awaitable[list[VaultEntry]]] | None = None,
    ) -> None:
        self.config = config
        self._writable_path = writable_path or snapshot_path()
        self._fallback_path = fallback_path or shipped_snapshot_path()
        self._fetcher = fetcher or fetch_vaults
        self._snapshot: EarnSnapshot | None = None
        self._loaded_from: str | None = None
        self._loaded = False

    @property
    def loaded_from(self) -> str | None:
        return self._loaded_from

    def current(self) -> EarnSnapshot | None:
        self.ensure_loaded()
        return self._snapshot

    def ensure_loaded(self) -> None:
        """Load the newest readable snapshot once (no network, request-safe)."""
        if self._loaded:
            return
        self._loaded = True
        for path, source in (
            (self._writable_path, "persisted"),
            (self._fallback_path, "shipped"),
        ):
            snapshot = _read_snapshot(path, source=source)
            if snapshot is not None:
                self._snapshot = snapshot
                self._loaded_from = source
                return

    def is_stale(self, *, now: datetime | None = None) -> bool:
        snapshot = self.current()
        if snapshot is None:
            return True
        moment = now or datetime.now(UTC)
        return moment - snapshot.fetched_at >= timedelta(minutes=self.config.refresh_minutes)

    async def refresh(self, *, force: bool = False) -> bool:
        """Refresh from Morpho unless the snapshot is fresh. Never raises."""
        if not self.config.feature_enabled:
            return False
        if not force and not self.is_stale():
            return True
        try:
            entries = await self._fetcher(self.config)
        except Exception as exc:  # noqa: BLE001 — fail-open to the snapshot
            logger.warning("earn_registry_refresh_failed err=%s", type(exc).__name__)
            self.ensure_loaded()
            return False
        snapshot = EarnSnapshot(
            fetched_at=datetime.now(UTC),
            source="morpho_api",
            vaults=tuple(entries),
        )
        self._snapshot = snapshot
        self._loaded_from = "memory"
        self._loaded = True
        self._persist(snapshot)
        logger.info("earn_registry_refreshed vaults=%d", len(entries))
        return True

    def install(self, snapshot: EarnSnapshot, *, loaded_from: str = "memory") -> None:
        """Inject a snapshot (tests / scripted evals)."""
        self._snapshot = snapshot
        self._loaded_from = loaded_from
        self._loaded = True

    def _persist(self, snapshot: EarnSnapshot) -> None:
        path = self._writable_path
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp_name = tempfile.mkstemp(prefix=path.name, dir=str(path.parent))
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as handle:
                    json.dump(_snapshot_json(snapshot), handle, ensure_ascii=False)
                os.replace(tmp_name, path)
            finally:
                if os.path.exists(tmp_name):
                    os.unlink(tmp_name)
        except OSError as exc:  # pragma: no cover - readonly deploy; snapshot still in memory
            logger.warning("earn_registry_persist_failed path=%s err=%s", path, type(exc).__name__)

    @property
    def writable_path(self) -> Path:
        return self._writable_path


def _snapshot_json(snapshot: EarnSnapshot) -> dict[str, Any]:
    return {
        "fetchedAt": snapshot.fetched_at.isoformat(),
        "source": snapshot.source,
        "vaults": [entry.to_json() for entry in snapshot.vaults],
    }


def _read_snapshot(path: Path, *, source: str) -> EarnSnapshot | None:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, Mapping):
        return None
    vaults_raw = raw.get("vaults")
    if not isinstance(vaults_raw, list):
        return None
    vaults: list[VaultEntry] = []
    for item in vaults_raw:
        if not isinstance(item, Mapping):
            continue
        try:
            vaults.append(VaultEntry.from_json(item))
        except (KeyError, TypeError, ValueError):
            continue
    return EarnSnapshot(
        fetched_at=_parse_timestamp(raw.get("fetchedAt")),
        source=str(raw.get("source") or source),
        vaults=tuple(vaults),
    )


def write_snapshot(path: Path, snapshot: EarnSnapshot) -> None:
    """Write a snapshot (used by ``scripts/earn_registry_snapshot.py``)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(_snapshot_json(snapshot), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


async def refresh_loop(
    registry: EarnRegistry,
    *,
    enabled: bool = True,
    interval_s: float | None = None,
    probe: Callable[[], Awaitable[None]] | None = None,
) -> None:
    """Background loop: refresh Morpho on the configured cadence (off the request path).

    Mirrors ``api/vault_apy_poller.py``: fail-open, cancellation-safe, no DB and no key. The
    interval is floored at 60s — the API's abuse penalty is a long cooldown, so a short timer is
    not a mistake worth allowing.
    """
    if not enabled:
        return
    wait = interval_s if interval_s is not None else max(60.0, registry.config.refresh_minutes * 60)
    logger.info("earn_registry_loop_started interval_s=%s", wait)
    while True:
        try:
            await registry.refresh()
            if probe is not None:
                await probe()
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — a tick failure never kills the loop
            logger.warning("earn_registry_tick_failed")
        try:
            await asyncio.sleep(wait)
        except asyncio.CancelledError:
            raise
