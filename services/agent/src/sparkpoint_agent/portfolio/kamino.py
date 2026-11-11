"""Kamino positions for Solana addresses ALREADY linked to the session owner.

Solana is not the session chain, so this source never accepts an address from the client. It asks
an owner-bound lookup for recipients recorded in the owner's own cross-chain quote rows and only
reads those. With no linked address the section is honestly ``not_linked`` with the Phase C copy.

The read is the configured kVault share mint via public ``getTokenAccountsByOwner``. Names and APY
come from the 069 registry snapshot. The snapshot carries no kVault share price, so a share balance
is shown but not priced unless a cached underlying-per-share value is supplied — the service never
invents a NAV.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from decimal import Decimal
from typing import Any

import httpx

from ..earn.config import EarnConfig, KaminoVaultConfig
from ..earn.registry import EarnRegistry
from .config import PortfolioConfig
from .models import PortfolioRow, PortfolioSection, decimal_or_none, human_amount
from .pricing import PriceSource, fetch_snapshot, price_row
from .rpc import PortfolioRpcError, SolanaRpc

NOT_LINKED_COPY = (
    "Kamino positions show once you deposit to a Solana address from SparkPoint (Phase C)"
)
MAX_LINKED_ADDRESSES = 5

LinkedAddresses = Callable[[str], Awaitable[tuple[str, ...]]]
SharePriceLookup = Callable[[str], Decimal | None]


def _token_amount(account: Mapping[str, Any]) -> tuple[Decimal, int] | None:
    data = account.get("account")
    data = data.get("data") if isinstance(data, Mapping) else None
    parsed = data.get("parsed") if isinstance(data, Mapping) else None
    info = parsed.get("info") if isinstance(parsed, Mapping) else None
    token_amount = info.get("tokenAmount") if isinstance(info, Mapping) else None
    if not isinstance(token_amount, Mapping):
        return None
    raw = decimal_or_none(token_amount.get("amount"))
    if raw is None:
        return None
    try:
        decimals = int(token_amount.get("decimals") or 0)
    except (TypeError, ValueError):
        decimals = 0
    return raw, decimals


def _registry_name(registry: EarnRegistry | None, vault_address: str) -> tuple[str, str | None]:
    if registry is None:
        return "", None
    snapshot = registry.current()
    if snapshot is None:
        return "", None
    for entry in snapshot.vaults:
        if entry.address == vault_address:
            return entry.name, entry.net_apy_percent
    return "", None


class KaminoPositionsSource:
    """Read kVault share balances for linked Solana addresses only."""

    def __init__(
        self,
        config: PortfolioConfig,
        *,
        earn_config: EarnConfig | None,
        registry: EarnRegistry | None,
        linked: LinkedAddresses | None,
        pricer: PriceSource | None = None,
        share_price: SharePriceLookup | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._config = config
        self._earn_config = earn_config
        self._registry = registry
        self._linked = linked
        self._pricer = pricer
        self._share_price = share_price
        self._transport = transport

    async def _rows_for(
        self,
        address: str,
        vault: KaminoVaultConfig,
        snapshot: Any,
    ) -> list[PortfolioRow]:
        rpc = SolanaRpc(
            self._config.solana_rpc_url,
            transport=self._transport,
            timeout_s=self._config.timeout_s,
        )
        accounts = await rpc.token_accounts(address, vault.shares_mint)
        raw_total = Decimal(0)
        decimals = 9
        for account in accounts:
            parsed = _token_amount(account)
            if parsed is None:
                continue
            raw_total += parsed[0]
            decimals = parsed[1]
        if raw_total <= 0:
            return []

        shares = raw_total.scaleb(-decimals)
        name, net_apy = _registry_name(self._registry, vault.address)
        symbol = "kV"
        underlying = ""
        if self._earn_config is not None:
            for entry in self._earn_config.kamino.vaults:
                if entry.address == vault.address:
                    underlying = entry.asset
        if underlying:
            symbol = f"kV-{underlying}"

        value: str | None = None
        price_source: str | None = None
        share_price = self._share_price(vault.address) if self._share_price else None
        if share_price is not None:
            underlying_amount = shares * share_price
            value, price_source, _ = price_row(
                amount=underlying_amount,
                price_symbol="SOL" if underlying.upper() == "SOL" else None,
                stable=underlying.upper() in {"USDC", "USDT"},
                snapshot=snapshot,
            )
        return [
            PortfolioRow(
                chain="sol",
                chain_label="Solana",
                protocol="kamino",
                kind="vault_position",
                symbol=symbol,
                amount=human_amount(shares),
                value_usd=value,
                price_source=price_source or "kamino_share_price_unavailable",
                extra={
                    "vaultAddress": vault.address,
                    "vaultName": name or vault.name,
                    "sharesMint": vault.shares_mint,
                    "assetSymbol": underlying,
                    "netApy": net_apy,
                    "wallet": address,
                    "note": None
                    if value is not None
                    else "Share amount shown; the ceiling snapshot carries no kVault share price.",
                },
            )
        ]

    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:  # noqa: ARG002 - EVM/Solana/DB sources are only called for EVM sessions
        if self._earn_config is None or not self._earn_config.kamino.enabled:
            return PortfolioSection(
                key="kamino",
                label="Kamino",
                status="unavailable",
                reason="Kamino is not enabled in the earn config.",
                source="solana_rpc",
            )
        addresses: tuple[str, ...] = ()
        if self._linked is not None:
            try:
                addresses = tuple((await self._linked(wallet))[:MAX_LINKED_ADDRESSES])
            except Exception:  # noqa: BLE001 - an unreadable address store is not a linked address
                addresses = ()
        if not addresses:
            return PortfolioSection(
                key="kamino",
                label="Kamino",
                status="not_linked",
                reason=NOT_LINKED_COPY,
                source="solana_rpc",
            )

        snapshot = await fetch_snapshot(self._pricer, ("SOL",))
        rows: list[PortfolioRow] = []
        try:
            for address in addresses:
                for vault in self._earn_config.kamino.vaults:
                    if not vault.shares_mint:
                        continue
                    rows.extend(await self._rows_for(address, vault, snapshot))
        except PortfolioRpcError as exc:
            return PortfolioSection(
                key="kamino",
                label="Kamino",
                status="unavailable",
                reason=str(exc),
                source="solana_rpc",
            )
        return PortfolioSection(
            key="kamino",
            label="Kamino",
            status="ok",
            rows=tuple(rows),
            source="solana_rpc",
            meta={"linkedAddresses": len(addresses)},
        )


__all__ = ["KaminoPositionsSource", "NOT_LINKED_COPY"]
