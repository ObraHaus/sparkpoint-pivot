"""The session wallet's Morpho vault positions (Base + Ethereum) + 1Click Earn receipts.

ONE GraphQL request is made, with a per-chain alias for ``userByAddress``. It follows the 069
conventions: the endpoint is configurable, the query is small (complexity-safe), and the result is
joined with the 069 registry for names, APY and the rail. The API is never called from a background
loop here — this is a per-request read with a short section timeout and a short cache in the
service layer.

1Click Earn Morpho receipts are ERC-20 wrapper balances held by the same wallet and are cheap to
read over the same RPC. They are valued at $1 par only because every configured Morpho receipt is a
USDC strategy; the row says so (``priceSource: "stablecoin_par"``) rather than implying a NAV.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from typing import Any

import httpx

from ..earn.config import EarnConfig, addresses_equal
from ..earn.registry import EarnRegistry, VaultEntry
from ..earn.rhea import percent_string
from .config import EvmChainConfig, PortfolioConfig
from .models import (
    PortfolioRow,
    PortfolioSection,
    decimal_or_none,
    human_amount,
    usd_string,
)
from .pricing import PriceSource, fetch_snapshot, price_row
from .rpc import EvmRpc, PortfolioRpcError

_USER_AGENT = "sparkpoint-agent/1.0"

#: One request, two aliases. Kept deliberately small (069's API is complexity-sensitive).
_POSITIONS_QUERY = """
query PortfolioMorpho($address: String!) {
  eth: userByAddress(address: $address, chainId: 1) {
    vaultPositions {
      state { shares assets assetsUsd }
      vault {
        address
        name
        symbol
        chain { id }
        asset { address symbol decimals }
        state { netApy }
      }
    }
  }
  base: userByAddress(address: $address, chainId: 8453) {
    vaultPositions {
      state { shares assets assetsUsd }
      vault {
        address
        name
        symbol
        chain { id }
        asset { address symbol decimals }
        state { netApy }
      }
    }
  }
}
"""

_CHAIN_KEYS: dict[int, str] = {1: "eth", 8453: "base"}
_CHAIN_LABELS: dict[int, str] = {1: "Ethereum", 8453: "Base"}
_STABLES = frozenset({"USDC", "USDT"})
_PRICE_SYMBOLS: dict[str, str] = {"WETH": "ETH", "CBBTC": "BTC", "WBTC": "BTC"}


class MorphoSourceError(RuntimeError):
    """The Morpho read failed; the section degrades honestly."""


def _registry_entry(registry: EarnRegistry | None, chain: str, address: str) -> VaultEntry | None:
    if registry is None:
        return None
    snapshot = registry.current()
    if snapshot is None:
        return None
    for entry in snapshot.vaults:
        if entry.chain == chain and addresses_equal(entry.address, address):
            return entry
    return None


def _net_apy(entry: VaultEntry | None, raw: Any) -> str | None:
    if entry is not None and entry.net_apy_percent is not None:
        return entry.net_apy_percent
    fraction = decimal_or_none(raw)
    return percent_string(fraction) if fraction is not None else None


def _asset_price_symbol(symbol: str) -> str | None:
    return _PRICE_SYMBOLS.get(symbol.upper())


def _position_row(
    *,
    chain_key: str,
    chain_label: str,
    position: Mapping[str, Any],
    vault: Mapping[str, Any],
    asset: Mapping[str, Any],
    registry: EarnRegistry | None,
    earn_config: EarnConfig | None,
    snapshot: Any,
) -> PortfolioRow | None:
    vault_address = str(vault.get("address") or "")
    if not vault_address:
        return None
    asset_symbol = str(asset.get("symbol") or "")
    try:
        decimals = int(asset.get("decimals") or 0)
    except (TypeError, ValueError):
        decimals = 0
    position_state = position.get("state")
    position_state = position_state if isinstance(position_state, Mapping) else {}
    raw_assets = decimal_or_none(position_state.get("assets"))
    raw_shares = decimal_or_none(position_state.get("shares"))
    amount = raw_assets.scaleb(-decimals) if raw_assets is not None and decimals else None
    shares = raw_shares.scaleb(-decimals) if raw_shares is not None and decimals else None
    if amount is not None and amount <= 0:
        return None

    entry = _registry_entry(registry, chain_key, vault_address)
    vault_state = vault.get("state")
    vault_state = vault_state if isinstance(vault_state, Mapping) else {}
    net_apy = _net_apy(entry, vault_state.get("netApy"))
    name = entry.name if entry is not None and entry.name else str(vault.get("name") or "")
    symbol = entry.symbol if entry is not None and entry.symbol else str(vault.get("symbol") or "")

    value: str | None = None
    price_source: str | None = None
    price_usd: str | None = None
    if amount is not None:
        stable = asset_symbol.upper() in _STABLES
        value, price_source, price_usd = price_row(
            amount=amount,
            price_symbol=None if stable else _asset_price_symbol(asset_symbol),
            stable=stable,
            snapshot=snapshot,
        )
        if value is None:
            # The API's own USD figure is a real reference, not a guess. Prefer it only when our
            # price feed could not value the asset.
            api_usd = decimal_or_none(position_state.get("assetsUsd"))
            if api_usd is not None:
                value = usd_string(api_usd)
                price_source = "morpho_api"

    rail = None
    if earn_config is not None:
        rail = "oneclick_earn" if earn_config.receipt_for_vault(vault_address) else "direct"

    extra: dict[str, Any] = {
        "vaultAddress": vault_address,
        "vaultName": name,
        "assetSymbol": asset_symbol,
        "decimals": decimals,
        "netApy": net_apy,
    }
    if shares is not None:
        extra["shares"] = human_amount(shares)
    if rail is not None:
        extra["rail"] = rail
    if price_usd is not None:
        extra["priceUsd"] = price_usd
    return PortfolioRow(
        chain=chain_key,
        chain_label=chain_label,
        protocol="morpho",
        kind="vault_position" if entry is not None else "morpho_position",
        symbol=symbol or asset_symbol,
        amount=human_amount(amount) if amount is not None else None,
        value_usd=value,
        price_source=price_source,
        extra=extra,
    )


class MorphoPositionsSource:
    """Read Morpho vault positions for the session wallet (one GraphQL request)."""

    def __init__(
        self,
        config: PortfolioConfig,
        *,
        registry: EarnRegistry | None = None,
        earn_config: EarnConfig | None = None,
        pricer: PriceSource | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        rpc_transports: Mapping[str, httpx.AsyncBaseTransport] | None = None,
    ) -> None:
        self._config = config
        self._registry = registry
        self._earn_config = earn_config
        self._pricer = pricer
        self._transport = transport
        self._rpc_transports = dict(rpc_transports or {})

    async def _query(self, wallet: str) -> Mapping[str, Any]:
        try:
            async with httpx.AsyncClient(
                timeout=self._config.timeout_s,
                transport=self._transport,
                headers={"User-Agent": _USER_AGENT, "Accept": "application/json"},
            ) as client:
                response = await client.post(
                    self._config.morpho_api_url,
                    json={
                        "query": _POSITIONS_QUERY,
                        "variables": {"address": wallet.lower()},
                    },
                )
        except httpx.HTTPError as exc:
            raise MorphoSourceError("Morpho API is unreachable") from exc
        if response.status_code != 200:
            detail = response.text[:200].replace("\n", " ")
            raise MorphoSourceError(f"Morpho API returned HTTP {response.status_code}: {detail}")
        try:
            body: Any = response.json()
        except ValueError as exc:
            raise MorphoSourceError("Morpho API returned invalid JSON") from exc
        if not isinstance(body, Mapping):
            raise MorphoSourceError("Morpho API returned an unexpected shape")
        errors = body.get("errors")
        if errors:
            first = errors[0] if isinstance(errors, list) and errors else {}
            detail = str(first.get("message") if isinstance(first, Mapping) else first)[:180]
            raise MorphoSourceError(f"Morpho API rejected the positions query: {detail}")
        data = body.get("data")
        if not isinstance(data, Mapping):
            raise MorphoSourceError("Morpho API returned an unexpected shape")
        return data

    def _chain(self, key: str) -> EvmChainConfig | None:
        for chain in self._config.chains:
            if chain.key == key:
                return chain
        return None

    async def _receipt_rows(self, wallet: str, snapshot: Any) -> list[PortfolioRow]:
        if self._earn_config is None:
            return []
        rows: list[PortfolioRow] = []
        for receipt in self._earn_config.receipts:
            if receipt.protocol != "morpho" or receipt.chain not in {"base", "eth"}:
                continue
            if not receipt.wrapper_address.startswith("0x"):
                continue
            chain = self._chain(receipt.chain)
            if chain is None or not chain.rpc_url:
                continue
            rpc = EvmRpc(
                chain.rpc_url,
                transport=self._rpc_transports.get(chain.key),
                timeout_s=self._config.timeout_s,
            )
            try:
                raw = await rpc.token_balance(receipt.wrapper_address, wallet)
            except PortfolioRpcError:
                continue
            if raw <= 0:
                continue
            amount = Decimal(raw).scaleb(-receipt.decimals)
            value, price_source, _ = price_row(
                amount=amount,
                price_symbol=None,
                stable=True,
                snapshot=snapshot,
            )
            rows.append(
                PortfolioRow(
                    chain=chain.key,
                    chain_label=chain.label,
                    protocol="morpho",
                    kind="oneclick_receipt",
                    symbol=receipt.symbol,
                    amount=human_amount(amount),
                    value_usd=value,
                    price_source=price_source,
                    extra={
                        "receiptAddress": receipt.wrapper_address,
                        "underlyingVault": receipt.underlying_vault,
                        "decimals": receipt.decimals,
                        "note": "1Click Earn receipt; valued at ~$1 par (USDC strategy)",
                    },
                )
            )
        return rows

    async def collect(self, wallet: str) -> PortfolioSection:
        snapshot = await fetch_snapshot(self._pricer, ("ETH", "BTC"))
        try:
            data = await self._query(wallet)
        except MorphoSourceError as exc:
            return PortfolioSection(
                key="morpho",
                label="Morpho",
                status="unavailable",
                reason=str(exc),
                source="morpho_api",
            )

        rows: list[PortfolioRow] = []
        for alias, chain_id in (("eth", 1), ("base", 8453)):
            user = data.get(alias)
            if not isinstance(user, Mapping):
                continue
            positions = user.get("vaultPositions")
            if not isinstance(positions, list):
                continue
            chain_key = _CHAIN_KEYS[chain_id]
            chain_label = _CHAIN_LABELS[chain_id]
            for position in positions:
                if not isinstance(position, Mapping):
                    continue
                vault = position.get("vault")
                vault = vault if isinstance(vault, Mapping) else {}
                asset = vault.get("asset")
                asset = asset if isinstance(asset, Mapping) else {}
                row = _position_row(
                    chain_key=chain_key,
                    chain_label=chain_label,
                    position=position,
                    vault=vault,
                    asset=asset,
                    registry=self._registry,
                    earn_config=self._earn_config,
                    snapshot=snapshot,
                )
                if row is not None:
                    rows.append(row)

        rows.extend(await self._receipt_rows(wallet, snapshot))
        return PortfolioSection(
            key="morpho",
            label="Morpho",
            status="ok",
            rows=tuple(rows),
            source="morpho_api",
        )


__all__ = ["MorphoPositionsSource", "MorphoSourceError"]
