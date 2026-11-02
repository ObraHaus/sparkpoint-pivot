"""Deterministic chat routing + block assembly for ``portfolio_overview`` (feature 072).

The route is deliberately narrow and anchored: only a complete portfolio-overview ask may take it.
An action, an amount, a vault-specific valuation ("what is my portfolio worth?"), a Rhea position
turn or a cross-chain swap command keeps its existing route. The DAG places this check AFTER the
068 crosschain parser and the 069/070/071 earn parser, so explicit earn/swap turns always win.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..coordinator.chat_blocks import PortfolioOverviewBlock
from .models import PortfolioFocus, PortfolioOverview
from .text import render_text

_POLITE_LEAD_RE = re.compile(
    r"^(?:please|hey(?: sparky)?|hi(?: sparky)?|ok(?:ay)?|can you|could you|would you|"
    r"kindly)\s+",
    re.IGNORECASE,
)
_AUX_LEAD_RE = re.compile(r"^(?:can|could|would|will) you\s+", re.IGNORECASE)
_POLITE_TAIL_RE = re.compile(r"\s+(?:please|now|today|thanks|thank you)$", re.IGNORECASE)

_PORTFOLIO_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"^show (?:me )?my portfolio$",
        r"^my portfolio$",
        r"^show (?:me )?my portfolio across (?:all )?(?:the )?chains$",
        r"^my portfolio across (?:all )?(?:the )?chains$",
        r"^(?:show (?:me )?)?my (?:positions|holdings|balances) everywhere$",
        r"^(?:what )?do i (?:have|own|hold) across (?:all )?(?:the )?chains$",
        r"^(?:show (?:me )?)?my balances$",
    )
)
_SWAP_HISTORY_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"^(?:show (?:me )?)?my (?:swap|cross[-\s]?chain swap|bridge) history$",
        r"^(?:show (?:me )?)?my (?:cross[-\s]?chain|bridge) (?:swaps|transactions|activity)$",
        r"^(?:show (?:me )?)?my swap transactions$",
    )
)
_EARN_PATTERNS = tuple(
    re.compile(pattern)
    for pattern in (
        r"^how much (?:am i earning|am i making|is my portfolio earning)$",
        r"^what am i earning$",
        r"^how much are my (?:positions|earn positions) earning$",
        r"^my earnings across (?:all )?(?:the )?chains$",
        r"^how much do i earn$",
    )
)


def _normalise(message: str) -> str:
    text = " ".join(message.strip().lower().replace("’", "'").split())
    text = text.rstrip(" .!?")
    previous = None
    while text and text != previous:
        previous = text
        text = _POLITE_LEAD_RE.sub("", text).strip()
        text = _AUX_LEAD_RE.sub("", text).strip()
        text = _POLITE_TAIL_RE.sub("", text).strip()
    return text


def detect_portfolio_focus(message: str) -> PortfolioFocus | None:
    """The overview focus for a complete ask; every other route keeps its behaviour."""
    text = _normalise(message)
    if not text:
        return None
    if any(pattern.match(text) for pattern in _SWAP_HISTORY_PATTERNS):
        return "swaps"
    if any(pattern.match(text) for pattern in _EARN_PATTERNS):
        return "earn"
    if any(pattern.match(text) for pattern in _PORTFOLIO_PATTERNS):
        return "all"
    return None


@dataclass(frozen=True, slots=True)
class PortfolioChatOutcome:
    text: str
    block: PortfolioOverviewBlock


def build_outcome(overview: PortfolioOverview, focus: PortfolioFocus) -> PortfolioChatOutcome:
    """Turn a portfolio read into the chat text + non-signable block."""
    text = render_text(overview, focus)
    block = PortfolioOverviewBlock(
        state=overview.state(),
        focus=focus,
        as_of=overview.as_of,
        sections=tuple(section.to_wire() for section in overview.sections),
        totals=overview.totals(),
        sources=overview.sources(),
    )
    return PortfolioChatOutcome(text=text, block=block)


__all__ = [
    "PortfolioChatOutcome",
    "build_outcome",
    "detect_portfolio_focus",
]
