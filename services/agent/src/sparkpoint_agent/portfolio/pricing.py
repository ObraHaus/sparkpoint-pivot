"""Display-only USD pricing helpers for the multi-chain portfolio.

Stablecoins are valued at $1 par (the demo's accepted convention, labelled
``stablecoin_par``). Everything else asks the existing keyless :class:`PriceService`; when a
quote is unavailable the row keeps its amount and ``valueUsd`` stays ``None``. A price is never
invented, and this module never reaches policy, custody or a signing path.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal
from typing import Protocol

from ..data.prices import PriceSnapshot
from .models import usd_string


class PriceSource(Protocol):
    """The one method the portfolio needs from the 060 price service."""

    async def get(self, symbols: Sequence[str]) -> PriceSnapshot: ...


def price_row(
    *,
    amount: Decimal,
    price_symbol: str | None,
    stable: bool,
    snapshot: PriceSnapshot | None,
) -> tuple[str | None, str | None, str | None]:
    """Return ``(valueUsd, priceSource, priceUsd)`` for an amount.

    A stablecoin is $1 par. A non-stable symbol is looked up in ``snapshot``; a missing quote is
    ``(None, "unavailable", None)`` — never a zero.
    """
    if stable:
        return usd_string(amount), "stablecoin_par", "1"
    if price_symbol is None or snapshot is None:
        return None, "unavailable", None
    quote = snapshot.quote(price_symbol)
    if quote is None:
        return None, "unavailable", None
    value = amount * Decimal(str(quote.usd))
    return usd_string(value), quote.source, format(Decimal(str(quote.usd)), "f")


async def fetch_snapshot(
    source: PriceSource | None, symbols: Sequence[str]
) -> PriceSnapshot | None:
    """Ask the price service once, fail-open to ``None`` (the section still renders)."""
    if source is None:
        return None
    wanted = tuple(dict.fromkeys(s.upper() for s in symbols if s))
    if not wanted:
        return PriceSnapshot(quotes={})
    try:
        return await source.get(wanted)
    except Exception:  # noqa: BLE001 - a price feed must never break the portfolio read
        return None


__all__ = ["PriceSource", "fetch_snapshot", "price_row"]
