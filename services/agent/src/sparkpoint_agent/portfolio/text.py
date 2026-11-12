"""Deterministic prose for the multi-chain portfolio.

No model is involved: the summary is derived from the same section data the block carries, so a
number in the text is always a number in the wire. It describes reads only and never implies a
signable action.
"""

from __future__ import annotations

from collections import defaultdict

from .models import PortfolioFocus, PortfolioOverview, PortfolioRow, PortfolioSection
from .swaps import swap_lines

_CLOSER = "Read-only — nothing was signed or sent."


def _money(value: str | None) -> str:
    return f"~${value}" if value is not None else "value unavailable"


def _priced_native(overview: PortfolioOverview) -> PortfolioRow | None:
    """The priced native-coin row (ETH), when the balances section could value it."""
    balances = overview.section("balances")
    if balances is None or balances.status != "ok":
        return None
    for row in balances.rows:
        if row.kind == "native" and row.value_usd is not None:
            return row
    return None


def _row_line(row: PortfolioRow) -> str:
    amount = row.amount or ""
    symbol = row.symbol or ""
    if row.value_usd is not None:
        return f"{amount} {symbol} ({_money(row.value_usd)})".replace("  ", " ").strip()
    return f"{amount} {symbol}".strip()


def _balances_lines(section: PortfolioSection) -> list[str]:
    if section.status == "not_linked":
        return [f"Wallet balances: not shown — {section.reason or 'no wallet is linked'}."]
    if section.status != "ok":
        return [f"Wallet balances: {section.status} — {section.reason or 'unavailable'}."]
    grouped: dict[str, list[str]] = defaultdict(list)
    for row in section.rows:
        grouped[row.chain_label].append(_row_line(row))
    if not grouped:
        chains = section.meta.get("chains") or []
        unavailable = [
            f"{item.get('label')} ({item.get('reason')})"
            for item in chains
            if isinstance(item, dict) and item.get("status") != "ok"
        ]
        if unavailable:
            return [f"Wallet balances: nothing readable ({', '.join(unavailable)})."]
        return ["Wallet balances: no non-zero balances."]
    lines = ["Wallet balances:"]
    for label, rows in grouped.items():
        lines.append(f"- {label}: {', '.join(rows)}")
    for item in section.meta.get("chains") or []:
        if isinstance(item, dict) and item.get("status") != "ok":
            lines.append(f"- {item.get('label')}: {item.get('reason')}")
    return lines


def _morpho_lines(section: PortfolioSection) -> list[str]:
    if section.status == "not_linked":
        return [f"Morpho: not shown — {section.reason or 'no EVM wallet is linked'}."]
    if section.status != "ok":
        return [f"Morpho: unavailable — {section.reason or 'read failed'}."]
    if not section.rows:
        return ["Morpho: no vault positions."]
    lines = ["Morpho:"]
    for row in section.rows:
        apy = row.extra.get("netApy")
        apy_text = f", net APY {apy}%" if apy else ""
        name = row.extra.get("vaultName") or row.extra.get("underlyingVault") or row.symbol
        lines.append(f"- {name} on {row.chain_label}: {_row_line(row)}{apy_text}")
    return lines


def _kamino_lines(section: PortfolioSection) -> list[str]:
    if section.status == "not_linked":
        return [f"Kamino: {section.reason}."]
    if section.status != "ok":
        return [f"Kamino: unavailable — {section.reason or 'read failed'}."]
    if not section.rows:
        return ["Kamino: no share positions on linked Solana addresses."]
    lines = ["Kamino:"]
    for row in section.rows:
        apy = row.extra.get("netApy")
        apy_text = f", {apy}% APY" if apy else ""
        lines.append(f"- {row.symbol} on Solana: {_row_line(row)}{apy_text}")
    return lines


def _rhea_lines(section: PortfolioSection) -> list[str]:
    if section.status != "ok":
        return [f"Rhea: unavailable — {section.reason or 'read failed'}."]
    if not section.rows:
        return ["Rhea: no supplied positions."]
    lines = ["Rhea:"]
    for row in section.rows:
        apy = row.extra.get("apy")
        apy_text = f", supply APY {apy}%" if apy else ""
        lines.append(f"- {_row_line(row)} on NEAR{apy_text}")
    return lines


def _earn_lines(overview: PortfolioOverview) -> list[str]:
    lines: list[str] = []
    morpho = overview.section("morpho")
    kamino = overview.section("kamino")
    rhea = overview.section("rhea")
    if morpho is not None:
        lines.extend(_morpho_lines(morpho))
    if kamino is not None:
        lines.extend(_kamino_lines(kamino))
    if rhea is not None:
        lines.extend(_rhea_lines(rhea))
    totals = overview.totals()
    if totals["totalUsd"] is not None:
        lines.insert(0, f"Priced positions across these sections: ~${totals['totalUsd']}.")
    else:
        lines.insert(0, "I couldn't price these positions right now, so I won't invent a total.")
    return lines


def _swaps_lines(section: PortfolioSection) -> list[str]:
    if section.status != "ok":
        return [f"Swaps: {section.reason or 'history unavailable'}"]
    if not section.rows:
        return ["Swaps: no cross-chain swaps yet."]
    return [f"Swaps: {len(section.rows)} recent cross-chain swap(s)."]


def render_text(overview: PortfolioOverview, focus: PortfolioFocus = "all") -> str:
    """Compose the short, deterministic summary for a focus."""
    if focus == "swaps":
        section = overview.section("swaps")
        if section is None:
            return f"I can't read your swap history right now. {_CLOSER}"
        if section.status != "ok":
            return f"{section.reason or 'Swap history is unavailable.'} {_CLOSER}"
        if not section.rows:
            return (
                "You don't have any cross-chain swaps yet. When you make one, its route, amount "
                f"and status will appear here. {_CLOSER}"
            )
        swap_text = ["Here are your most recent cross-chain swaps:"]
        swap_text.extend(swap_lines(section))
        swap_text.append(_CLOSER)
        return "\n".join(swap_text)

    if focus == "earn":
        earn_text = _earn_lines(overview)
        earn_text.append(_CLOSER)
        return "\n".join(earn_text)

    lines: list[str] = []
    totals = overview.totals()
    if overview.state() == "empty":
        lines.append("You don't have any positions in these sections yet.")
    elif totals["totalUsd"] is not None:
        lines.append(f"Your priced positions total about ${totals['totalUsd']}.")
        native = _priced_native(overview)
        if native is not None:
            # 1112 — the Portfolio page's Net worth values stablecoins/vault positions only and
            # shows ETH separately. Say that here so the two totals never read as a contradiction.
            lines.append(
                f"That includes {native.amount} {native.symbol} (~${native.value_usd}); the "
                "Portfolio Net worth figure counts stablecoins and vault positions only and "
                "excludes ETH."
            )
    else:
        lines.append(
            "I can show what you hold, but I couldn't price it right now — no total is invented."
        )
    balances = overview.section("balances")
    if balances is not None:
        lines.extend(_balances_lines(balances))
    morpho = overview.section("morpho")
    if morpho is not None:
        lines.extend(_morpho_lines(morpho))
    kamino = overview.section("kamino")
    if kamino is not None:
        lines.extend(_kamino_lines(kamino))
    rhea = overview.section("rhea")
    if rhea is not None:
        lines.extend(_rhea_lines(rhea))
    swaps = overview.section("swaps")
    if swaps is not None:
        lines.extend(_swaps_lines(swaps))
    lines.append(_CLOSER)
    return "\n".join(lines)


__all__ = ["render_text"]
