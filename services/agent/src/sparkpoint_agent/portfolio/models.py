"""Feature 072 — the multi-chain portfolio wire model.

One section per source, each independently degradable (``ok`` / ``unavailable`` / ``not_linked``).
A section carries display rows and an honest reason when it could not be read. Totals are the sum
of the rows in sections that are ``ok`` — an unavailable section contributes nothing rather than a
guessed figure.

Every amount is a human decimal string (decimals-correct) and every USD value is a 2-dp string.
``None`` means "we could not price it", never zero.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

SectionStatus = Literal["ok", "unavailable", "not_linked"]
PortfolioState = Literal["ready", "empty", "unavailable"]
PortfolioFocus = Literal["all", "swaps", "earn"]
SectionKey = Literal["balances", "morpho", "kamino", "rhea", "swaps"]


def human_amount(value: Decimal) -> str:
    """A decimals-correct amount with trailing zeros trimmed (``1.5``, ``0.000001``)."""
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def usd_string(value: Decimal | None) -> str | None:
    """A USD figure with two decimals; ``None`` stays ``None`` (never a fabricated 0)."""
    if value is None:
        return None
    return format(value.quantize(Decimal("0.01")), "f")


def decimal_or_none(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    return parsed if parsed.is_finite() else None


def shorten_address(value: str | None) -> str | None:
    """A short display form (``0x1234…abcd``) for prose; the wire keeps the full value."""
    if not value:
        return None
    if len(value) <= 14:
        return value
    return f"{value[:6]}…{value[-4:]}"


@dataclass(frozen=True, slots=True)
class PortfolioRow:
    """One display row. ``value_usd`` is ``None`` when we cannot price it honestly."""

    chain: str
    chain_label: str
    protocol: str
    kind: str
    symbol: str
    amount: str | None = None
    value_usd: str | None = None
    price_source: str | None = None
    extra: Mapping[str, Any] = field(default_factory=dict)

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "chain": self.chain,
            "chainLabel": self.chain_label,
            "protocol": self.protocol,
            "kind": self.kind,
            "symbol": self.symbol,
        }
        if self.amount is not None:
            wire["amount"] = self.amount
        if self.value_usd is not None:
            wire["valueUsd"] = self.value_usd
        if self.price_source is not None:
            wire["priceSource"] = self.price_source
        # Optional display extras (APY, rail, status, note, …) are OMITTED when absent. The shared
        # TS schema declares them optional strings, not nullable, so a literal ``null`` here would
        # fail ``safeParse`` and render the whole overview inert (the same class of bug as the
        # undeclared additive keys). Never drop a real value — only the JSON null.
        wire.update({key: value for key, value in self.extra.items() if value is not None})
        return wire


@dataclass(frozen=True, slots=True)
class PortfolioSection:
    """One independently-degradable source."""

    key: SectionKey
    label: str
    status: SectionStatus
    rows: tuple[PortfolioRow, ...] = ()
    reason: str | None = None
    source: str | None = None
    as_of: str | None = None
    meta: Mapping[str, Any] = field(default_factory=dict)

    def total_usd(self) -> Decimal | None:
        if self.status != "ok":
            return None
        total: Decimal | None = None
        for row in self.rows:
            value = decimal_or_none(row.value_usd)
            if value is None:
                continue
            total = value if total is None else total + value
        return total

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "key": self.key,
            "label": self.label,
            "status": self.status,
            "rows": [row.to_wire() for row in self.rows],
        }
        if self.reason is not None:
            wire["reason"] = self.reason
        if self.source is not None:
            wire["source"] = self.source
        if self.as_of is not None:
            wire["asOf"] = self.as_of
        if self.meta:
            # Same rule as rows: an absent optional section field is omitted, never ``null``.
            wire.update({key: value for key, value in self.meta.items() if value is not None})
        total = usd_string(self.total_usd())
        if total is not None:
            wire["totalUsd"] = total
        return wire


def build_totals(sections: Iterable[PortfolioSection]) -> dict[str, Any]:
    """Sum only ``ok`` sections; group by chain and by protocol."""
    by_chain: dict[tuple[str, str], Decimal] = {}
    by_protocol: dict[str, Decimal] = {}
    priced = False
    for section in sections:
        if section.status != "ok":
            continue
        for row in section.rows:
            value = decimal_or_none(row.value_usd)
            if value is None:
                continue
            priced = True
            chain_key = (row.chain, row.chain_label)
            by_chain[chain_key] = by_chain.get(chain_key, Decimal(0)) + value
            by_protocol[row.protocol] = by_protocol.get(row.protocol, Decimal(0)) + value

    total: Decimal | None = None
    if priced:
        total = sum(by_chain.values(), Decimal(0))
    return {
        "totalUsd": usd_string(total),
        "byChain": [
            {"chain": chain, "label": label, "valueUsd": usd_string(value)}
            for (chain, label), value in sorted(
                by_chain.items(), key=lambda item: item[1], reverse=True
            )
        ],
        "byProtocol": [
            {"protocol": protocol, "valueUsd": usd_string(value)}
            for protocol, value in sorted(
                by_protocol.items(), key=lambda item: item[1], reverse=True
            )
        ],
        "priced": priced,
    }


@dataclass(frozen=True, slots=True)
class PortfolioOverview:
    """The whole read: five sections + totals. Read-only by construction."""

    wallet: str
    focus: PortfolioFocus
    as_of: str
    sections: tuple[PortfolioSection, ...]

    def section(self, key: str) -> PortfolioSection | None:
        for section in self.sections:
            if section.key == key:
                return section
        return None

    def sources(self) -> tuple[str, ...]:
        seen: list[str] = []
        for section in self.sections:
            if section.source and section.source not in seen:
                seen.append(section.source)
        return tuple(seen)

    def state(self) -> PortfolioState:
        ok = [section for section in self.sections if section.status == "ok"]
        if not ok:
            return "unavailable"
        if not any(section.rows for section in ok):
            return "empty"
        return "ready"

    def totals(self) -> dict[str, Any]:
        return build_totals(self.sections)

    def to_wire(self) -> dict[str, Any]:
        return {
            "type": "portfolio_overview",
            "state": self.state(),
            "focus": self.focus,
            "asOf": self.as_of,
            "wallet": self.wallet,
            "sections": [section.to_wire() for section in self.sections],
            "totals": self.totals(),
            "sources": list(self.sources()),
        }


__all__ = [
    "PortfolioFocus",
    "PortfolioOverview",
    "PortfolioRow",
    "PortfolioSection",
    "PortfolioState",
    "SectionKey",
    "SectionStatus",
    "build_totals",
    "decimal_or_none",
    "human_amount",
    "shorten_address",
    "usd_string",
]
