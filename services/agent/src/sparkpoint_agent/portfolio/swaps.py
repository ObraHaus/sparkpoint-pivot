"""Cross-chain swap history from the owner's own 068 quote rows.

The history is a read of ``crosschain_quotes`` filtered by ``user_eoa = session owner`` — the same
ownership key the 068 status endpoint uses. No address ever comes from the client. At most three
non-terminal rows may be refreshed through the existing 1Click status client, behind a config flag;
that is a bounded, read-only GET and the result is returned, never written back to the database by
this surface.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Protocol

from ..crosschain.config import CrossChainConfig
from ..crosschain.oneclick import CrossChainError
from .models import PortfolioRow, PortfolioSection, shorten_address

_TERMINAL = frozenset({"SUCCESS", "REFUNDED", "FAILED"})
_BASE58_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{32,44}$")


class QuoteStore(Protocol):
    async def list_for_owner(self, owner_eoa: str, *, limit: int = 20) -> list[dict[str, Any]]: ...


class StatusClient(Protocol):
    async def status(self, *, deposit_address: str) -> Mapping[str, Any]: ...


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _quote_response(row: Mapping[str, Any]) -> Mapping[str, Any]:
    return _mapping(row.get("quoteResponse"))


def _amount_out(row: Mapping[str, Any]) -> str | None:
    quote = _mapping(_quote_response(row).get("quote"))
    value = quote.get("amountOutFormatted") or quote.get("amountOut")
    return str(value) if value is not None else None


def _recipient(row: Mapping[str, Any]) -> str | None:
    response = _quote_response(row)
    for container in (_mapping(response.get("quoteRequest")), _mapping(response.get("quote"))):
        value = container.get("recipient")
        if isinstance(value, str) and value:
            return value
    value = response.get("recipient")
    return str(value) if isinstance(value, str) and value else None


def linked_solana_addresses(rows: list[dict[str, Any]]) -> tuple[str, ...]:
    """Distinct Solana recipients already recorded in the owner's own quote rows."""
    found: list[str] = []
    for row in rows:
        if not str(row.get("destinationKey") or "").startswith("sol:"):
            continue
        recipient = _recipient(row)
        if recipient and _BASE58_RE.match(recipient) and recipient not in found:
            found.append(recipient)
    return tuple(found)


def _is_non_terminal(status: Any) -> bool:
    return str(status or "").upper() not in _TERMINAL


class SwapHistorySource:
    """Read (and optionally refresh) the owner's cross-chain swap history."""

    def __init__(
        self,
        store: QuoteStore | None,
        crosschain: CrossChainConfig | None,
        *,
        oneclick: StatusClient | None = None,
        max_rows: int = 20,
        max_refresh: int = 3,
        refresh_status: bool = False,
    ) -> None:
        self._store = store
        self._crosschain = crosschain
        self._oneclick = oneclick
        self._max_rows = max_rows
        self._max_refresh = max_refresh
        self._refresh_status = refresh_status

    def _labels(self, key: str) -> tuple[str, str, str]:
        if self._crosschain is not None:
            asset = self._crosschain.asset(key)
            if asset is not None:
                return asset.chain, asset.chain_label, asset.symbol
        chain = key.split(":", 1)[0] if key else ""
        return chain, chain.title() if chain else key, key

    async def _refresh(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        if not self._refresh_status or self._oneclick is None:
            return rows
        remaining = self._max_refresh
        refreshed: list[dict[str, Any]] = []
        for row in rows:
            if remaining <= 0 or not _is_non_terminal(row.get("lastStatus")):
                refreshed.append(row)
                continue
            deposit = row.get("depositAddress")
            if not isinstance(deposit, str) or not deposit:
                refreshed.append(row)
                continue
            remaining -= 1
            try:
                payload = await self._oneclick.status(deposit_address=deposit)
            except CrossChainError:
                refreshed.append(row)
                continue
            status = payload.get("status")
            refreshed.append({**row, "lastStatus": str(status)} if status else row)
        return refreshed

    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:  # noqa: ARG002 - EVM/Solana/DB sources are only called for EVM sessions
        if self._store is None:
            return PortfolioSection(
                key="swaps",
                label="Cross-chain swaps",
                status="unavailable",
                reason="Swap history is unavailable: the database is not configured.",
                source="db",
            )
        try:
            rows = await self._store.list_for_owner(wallet, limit=self._max_rows)
        except Exception:  # noqa: BLE001 - a DB outage degrades the section, never the response
            return PortfolioSection(
                key="swaps",
                label="Cross-chain swaps",
                status="unavailable",
                reason="Could not read your swap history right now.",
                source="db",
            )

        rows = await self._refresh(rows)
        display: list[PortfolioRow] = []
        for row in rows:
            origin_key = str(row.get("originKey") or "")
            destination_key = str(row.get("destinationKey") or "")
            origin_chain, origin_label, origin_symbol = self._labels(origin_key)
            _, destination_label, destination_symbol = self._labels(destination_key)
            deposit = row.get("depositAddress")
            extra: dict[str, Any] = {
                "originKey": origin_key,
                "originLabel": f"{origin_label} {origin_symbol}".strip(),
                "destinationKey": destination_key,
                "destinationLabel": f"{destination_label} {destination_symbol}".strip(),
                "route": (
                    f"{origin_label} {origin_symbol} -> {destination_label} {destination_symbol}"
                ).strip(),
                "depositAddress": deposit,
                "createdAt": row.get("createdAt"),
                "lastStatus": row.get("lastStatus"),
            }
            amount_out = _amount_out(row)
            if amount_out is not None:
                extra["amountOut"] = amount_out
            display.append(
                PortfolioRow(
                    chain=origin_chain,
                    chain_label=origin_label,
                    protocol="swap",
                    kind="cross_chain_swap",
                    symbol=origin_symbol,
                    amount=str(row.get("amountIn")) if row.get("amountIn") is not None else None,
                    value_usd=None,
                    price_source=None,
                    extra=extra,
                )
            )
        return PortfolioSection(
            key="swaps",
            label="Cross-chain swaps",
            status="ok",
            rows=tuple(display),
            source="db",
        )


def swap_lines(section: PortfolioSection) -> list[str]:
    """Deterministic prose lines for the swap section (deposit addresses shortened)."""
    lines: list[str] = []
    for row in section.rows:
        route = str(row.extra.get("route") or row.symbol)
        amount_in = row.amount or "?"
        amount_out = row.extra.get("amountOut")
        deposit = shorten_address(
            str(row.extra.get("depositAddress")) if row.extra.get("depositAddress") else None
        )
        status = row.extra.get("lastStatus") or "status pending"
        out = f" -> {amount_out}" if amount_out else ""
        deposit_text = f" (deposit {deposit})" if deposit else ""
        lines.append(f"- {amount_in} {route}{out} — {status}{deposit_text}")
    return lines


__all__ = [
    "QuoteStore",
    "StatusClient",
    "SwapHistorySource",
    "linked_solana_addresses",
    "swap_lines",
]
