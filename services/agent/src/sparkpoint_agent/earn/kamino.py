"""Kamino kVault fetch + normalization (feature 070).

Kamino's public API (``https://api.kamino.finance``) has a list endpoint that returns ~400 KB
(194 kVaults on 2026-11-01) and a per-vault metrics endpoint with APY + TVL. Like Morpho, this is
ONLY touched from the background refresher or the snapshot script — never from a request handler.

Two modes, both config-driven:

  * ``auto_discover=false`` (the shipped default) — only the vaults listed in
    ``earn.json → kamino.vaults`` are shown, enriched with metrics. Adding a Kamino USDC vault is
    an ``earn.json`` edit plus an optional 1Click receipt entry, never a code change.
  * ``auto_discover=true`` — every Kamino vault whose token mint is in ``kamino.token_mints`` and
    whose asset passes ``kamino.filters`` is listed. Metrics calls are bounded
    (``MAX_DISCOVER_METRICS``) because the list is large.

Solana has no chain id in the EVM sense; the registry uses the documented sentinel ``chain_id=0``
and the ``sol`` chain key (the same key 068 routes use).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any, Final

import httpx

from .config import EarnConfig
from .registry import VaultAsset, VaultEntry, _to_decimal

logger = logging.getLogger("sparkpoint_agent.earn.kamino")

USER_AGENT: Final = "sparkpoint-agent/1.0"
TIMEOUT_S: Final = 15.0
MAX_DISCOVER_METRICS: Final = 24
CONCURRENCY: Final = 4


class KaminoRegistryError(RuntimeError):
    """A failed/unusable Kamino response. The caller falls back to the snapshot."""


def _chain_id(config: EarnConfig) -> int:
    chain = config.chain("sol")
    return chain.chain_id if chain is not None else 0


def _assets(config: EarnConfig) -> set[str]:
    return {item.upper() for item in config.kamino.assets}


def normalize_kamino_vault(
    raw: Mapping[str, Any],
    metrics: Mapping[str, Any] | None,
    *,
    config: EarnConfig,
    fetched_at: str,
    require_metrics: bool = False,
) -> VaultEntry | None:
    """One list item (+ optional metrics) → :class:`VaultEntry`, or ``None`` when unusable."""
    address = raw.get("address")
    state = raw.get("state")
    if not isinstance(address, str) or not isinstance(state, Mapping):
        return None
    token_mint = state.get("tokenMint")
    if not isinstance(token_mint, str):
        return None
    mapped = config.kamino.asset_for_mint(token_mint)
    if mapped is None:
        return None
    asset_symbol, asset_decimals = mapped
    assets = _assets(config)
    if assets and asset_symbol.upper() not in assets:
        return None

    metrics = metrics if isinstance(metrics, Mapping) else {}
    if require_metrics and not metrics:
        return None
    tvl = _to_decimal(metrics.get("tokensInvestedUsd"))
    apy = _to_decimal(metrics.get("apy"))
    return VaultEntry(
        chain="sol",
        chain_id=_chain_id(config),
        address=address,
        version="kvault",
        name=str(state.get("name") or address),
        symbol="kV",
        asset=VaultAsset(
            address=token_mint,
            symbol=asset_symbol.upper(),
            decimals=asset_decimals,
        ),
        listed=True,
        tvl_usd=tvl,
        net_apy=apy,
        source="kamino_api",
        fetched_at=fetched_at,
        protocol="kamino",
    )


def _configured_addresses(config: EarnConfig) -> set[str]:
    return {vault.address for vault in config.kamino.vaults}


def select_candidates(
    raw_vaults: Sequence[Mapping[str, Any]], config: EarnConfig
) -> list[Mapping[str, Any]]:
    """Return the vaults worth fetching metrics for.

    Configured vaults are always kept (even if metrics fails). With ``auto_discover`` on, other
    vaults are kept when their token mint + asset match the filters; the metrics fan-out is
    bounded so a mis-set flag cannot hammer the public API.
    """
    configured = _configured_addresses(config)
    assets = _assets(config)
    selected: list[tuple[Mapping[str, Any], bool]] = []
    discovered = 0
    for item in raw_vaults:
        address = item.get("address")
        state = item.get("state")
        if not isinstance(address, str) or not isinstance(state, Mapping):
            continue
        mapped = config.kamino.asset_for_mint(str(state.get("tokenMint") or ""))
        if mapped is None:
            continue
        if assets and mapped[0].upper() not in assets:
            continue
        is_configured = address in configured
        if not is_configured:
            if not config.kamino.auto_discover:
                continue
            if discovered >= MAX_DISCOVER_METRICS:
                continue
            discovered += 1
        selected.append((item, is_configured))
    return [item for item, _ in selected]


async def _get_json(client: httpx.AsyncClient, url: str) -> Any:
    try:
        response = await client.get(url)
    except httpx.HTTPError as exc:
        raise KaminoRegistryError("could not reach the Kamino API") from exc
    if response.status_code != 200:
        raise KaminoRegistryError(f"kamino http {response.status_code}")
    try:
        return response.json()
    except ValueError as exc:
        raise KaminoRegistryError("kamino returned invalid json") from exc


async def _fetch_metrics(
    client: httpx.AsyncClient,
    api_url: str,
    address: str,
    semaphore: asyncio.Semaphore,
) -> Mapping[str, Any] | None:
    async with semaphore:
        try:
            payload = await _get_json(client, f"{api_url}/kvaults/{address}/metrics")
        except KaminoRegistryError as exc:
            logger.warning("kamino_metrics_failed address=%s err=%s", address, exc)
            return None
    return payload if isinstance(payload, Mapping) else None


async def fetch_kamino_catalog(
    config: EarnConfig,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[Mapping[str, Any]]:
    """Read the ~400 KB kVault list once (snapshot script counts only). Fail-open to ``[]``."""
    if not config.kamino.enabled:
        return []
    api_url = config.kamino.api_url.rstrip("/")
    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT_S,
            transport=transport,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        ) as client:
            raw = await _get_json(client, f"{api_url}/kvaults/vaults")
    except Exception:  # noqa: BLE001 - counts are advisory
        return []
    return [item for item in raw if isinstance(item, Mapping)] if isinstance(raw, list) else []


async def fetch_kamino_vaults(
    config: EarnConfig,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
) -> list[VaultEntry]:
    """Fetch the kVault list, enrich the selected vaults with metrics, and normalize.

    Fail-open: an unreachable/broken API returns ``[]`` (the previous snapshot stays in place).
    ``transport`` exists only so tests can stay offline.
    """
    if not config.kamino.enabled:
        return []
    fetched_at = datetime.now(UTC).isoformat()
    api_url = config.kamino.api_url.rstrip("/")
    try:
        async with httpx.AsyncClient(
            timeout=TIMEOUT_S,
            transport=transport,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        ) as client:
            raw = await _get_json(client, f"{api_url}/kvaults/vaults")
            if not isinstance(raw, list):
                raise KaminoRegistryError("kamino returned an unexpected list shape")
            candidates: list[Mapping[str, Any]] = [
                item for item in raw if isinstance(item, Mapping)
            ]
            selected = select_candidates(candidates, config)
            configured = _configured_addresses(config)
            semaphore = asyncio.Semaphore(CONCURRENCY)
            metrics = await asyncio.gather(
                *[
                    _fetch_metrics(client, api_url, str(item["address"]), semaphore)
                    for item in selected
                    if isinstance(item.get("address"), str)
                ]
            )
    except KaminoRegistryError as exc:
        logger.warning("kamino_fetch_failed err=%s", exc)
        return []
    except Exception as exc:  # noqa: BLE001 — fail-open, the snapshot is the source of truth
        logger.warning("kamino_fetch_failed err=%s", type(exc).__name__)
        return []

    entries: list[VaultEntry] = []
    for item, metric in zip(selected, metrics, strict=False):
        address = item.get("address")
        requires = not (isinstance(address, str) and address in configured)
        entry = normalize_kamino_vault(
            item,
            metric,
            config=config,
            fetched_at=fetched_at,
            require_metrics=requires,
        )
        if entry is None:
            continue
        floor = _to_decimal(config.kamino.min_tvl_usd)
        if requires and floor is not None and (entry.tvl_usd or Decimal(0)) < floor:
            # Discovered vaults must clear the TVL floor; configured ones are an explicit choice.
            continue
        entries.append(entry)
    entries.sort(key=lambda item: (item.tvl_usd or 0), reverse=True)
    return entries


__all__ = [
    "KaminoRegistryError",
    "fetch_kamino_catalog",
    "fetch_kamino_vaults",
    "normalize_kamino_vault",
    "select_candidates",
]
