"""Exact integer formatting for 6-dp stablecoin base units (one implementation).

Every user-facing dollar figure in the coordinator is derived from an integer base-unit
amount, never a float. These helpers centralise that arithmetic so the guidance copy and the
DAG's balance/cap copy cannot drift apart (they previously carried duplicate implementations).
"""

from __future__ import annotations


def format_usd6(raw: int) -> str:
    """Format raw 6-dp base units as a fixed-2-decimal string (no ``$``), exact + integer-only."""
    whole, frac = divmod(max(0, int(raw)), 1_000_000)
    cents = (frac * 100) // 1_000_000
    return f"{whole:,}.{cents:02d}"


def format_usd(raw: int) -> str:
    """Format raw 6-dp base units as ``$1,234`` / ``$1,234.56`` — cents only when non-zero."""
    return f"${format_usd6(raw).removesuffix('.00')}"
