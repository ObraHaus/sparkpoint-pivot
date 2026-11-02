"""Rhea (Burrow) positions on NEAR, reusing the 071 read path.

The 071 :class:`~sparkpoint_agent.earn.service.EarnService` already resolves the signed-in EVM
wallet's Multichain Account and reads ``get_account_all_positions`` read-only. This source only
reshapes that block into a portfolio section; it adds no new RPC and never signs. USDT stays
disabled in the 071 config, and a stablecoin amount is valued at $1 par.
"""

from __future__ import annotations

from typing import Any, Protocol

from ..coordinator.chat_blocks import EarnPositionsBlock
from ..earn.service import EarnOutcome
from .models import PortfolioRow, PortfolioSection, decimal_or_none, human_amount, usd_string

_STABLES = frozenset({"USDC", "USDT"})


class RheaReader(Protocol):
    async def rhea_positions(self, *, wallet: str) -> EarnOutcome: ...


def _rows(block: EarnPositionsBlock) -> list[PortfolioRow]:
    rows: list[PortfolioRow] = []
    for position in block.supplied:
        symbol = str(position.get("symbol") or "")
        amount = decimal_or_none(position.get("amount"))
        if amount is None or amount <= 0:
            continue
        stable = symbol.upper() in _STABLES
        value = usd_string(amount) if stable else None
        rows.append(
            PortfolioRow(
                chain="near",
                chain_label="NEAR",
                protocol="rhea",
                kind="lending_position",
                symbol=symbol,
                amount=human_amount(amount),
                value_usd=value,
                price_source="stablecoin_par" if stable else "unavailable",
                extra={
                    "apy": position.get("apy"),
                    "mca": block.mca,
                },
            )
        )
    return rows


class RheaPositionsSource:
    """A thin adapter over the 071 positions read."""

    def __init__(self, service: RheaReader | None) -> None:
        self._service = service

    async def collect(self, wallet: str) -> PortfolioSection:
        if self._service is None:
            return PortfolioSection(
                key="rhea",
                label="Rhea",
                status="unavailable",
                reason="Rhea lending is not configured on this deployment.",
                source="rhea_rpc",
            )
        outcome = await self._service.rhea_positions(wallet=wallet)
        block = outcome.block
        if not isinstance(block, EarnPositionsBlock):
            return PortfolioSection(
                key="rhea",
                label="Rhea",
                status="unavailable",
                reason="Rhea returned an unexpected read.",
                source="rhea_rpc",
            )
        if block.state == "unavailable":
            return PortfolioSection(
                key="rhea",
                label="Rhea",
                status="unavailable",
                reason=block.unavailable_reason or "The NEAR RPC read is unavailable right now.",
                source="rhea_rpc",
            )
        meta: dict[str, Any] = {}
        if block.mca is not None:
            meta["mca"] = block.mca
        if block.app_url is not None:
            meta["appUrl"] = block.app_url
        if block.state == "empty" and block.explainer is not None:
            meta["explainer"] = block.explainer
        rows = _rows(block) if block.state == "ready" else []
        return PortfolioSection(
            key="rhea",
            label="Rhea",
            status="ok",
            rows=tuple(rows),
            source="rhea_rpc",
            meta=meta,
        )


__all__ = ["RheaPositionsSource", "RheaReader"]
