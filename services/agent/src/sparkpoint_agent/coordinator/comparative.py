"""066 — named-subject extraction for GROUNDED comparative turns.

A comparison is only useful when the answer has material for *each* side. Before 066 the DAG
embedded the whole sentence once (``"Is Morpho safer than Aave? Compare them for a cautious
user."``), which on beta ranked two release-note changelog entries above the protocol notes.
This module finds the protocols a user actually named so the coordinator can retrieve for each
of them separately (``coordinator/dag.py::_ground_comparative``).

The extraction is deliberately deterministic and conservative:

* A curated alias table covers the protocols Sparky is asked about most (and the ones the
  shipped corpus describes). Aliases are word-boundary matched, so ``"compound"`` in
  ``"auto-compounds"`` does not become a subject.
* When fewer than two known protocols are found, a narrow proper-noun fallback picks Capitalised
  tokens (``"Yearn"``, ``"Beefy"``) and drops sentence-leading/ordinary words. It never invents a
  subject from lowercase prose.

Nothing here fetches, ranks or writes: it is a pure helper over the user's message. Passage
filtering lives here too, because "grounded for this subject" must mean the passage actually
mentions it — a cosine hit that talks about something else is not coverage.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from ..knowledge import Passage


@dataclass(frozen=True)
class _KnownSubject:
    """One canonical display name plus the aliases that identify it in a message."""

    display: str
    aliases: tuple[str, ...]


#: Order is irrelevant for matching (position in the message decides), but keeping the shipped
#: corpus protocols first makes the intent obvious.
_KNOWN: tuple[_KnownSubject, ...] = (
    _KnownSubject("Aave", ("aave",)),
    _KnownSubject("Morpho", ("morpho",)),
    _KnownSubject("Compound", ("compound",)),
    _KnownSubject("Lido", ("lido",)),
    _KnownSubject("Rocket Pool", ("rocket pool", "rocketpool")),
    _KnownSubject("SparkPoint Vault", ("sparkpoint vault", "sparky vault", "sparkpoint's vault")),
    _KnownSubject("Aerodrome", ("aerodrome",)),
    _KnownSubject("Uniswap", ("uniswap",)),
    _KnownSubject("Curve", ("curve finance", "curve protocol")),
    _KnownSubject("Balancer", ("balancer",)),
    _KnownSubject("EigenLayer", ("eigenlayer", "eigen layer")),
    _KnownSubject("Pendle", ("pendle",)),
    _KnownSubject("Sky", ("sky protocol",)),
    _KnownSubject("MakerDAO", ("makerdao", "maker dao")),
)


#: Capitalised words that are part of the question's grammar, not a protocol name. Matched
#: case-insensitively, so the all-caps conjunction/interrogative forms ("AND", "OR", "NOT", "VS",
#: "DOES", "SHOULD", "WOULD", "CAN", "HAS", "WHEN", "WHICH", "WHAT", "IS", "ARE", "HOW") are
#: dropped too — the capitalised-token fallback used to return them as subjects.
_NOT_A_SUBJECT = frozenset(
    word.lower()
    for word in (
        "Compare",
        "Comparing",
        "Comparison",
        "Which",
        "What",
        "Whats",
        "How",
        "When",
        "Where",
        "Why",
        "Who",
        "Is",
        "Are",
        "Was",
        "Were",
        "Does",
        "Do",
        "Did",
        "Should",
        "Would",
        "Could",
        "Can",
        "Has",
        "Have",
        "Had",
        "The",
        "And",
        "Or",
        "Not",
        "Than",
        "Versus",
        "Vs",
        "Better",
        "Safer",
        "Riskier",
        "Beginner",
        "Beginners",
        "Cautious",
        "User",
        "Users",
        "SparkPoint",
        "Sparky",
        "USDC",
        "USDT",
        "ETH",
        "BTC",
        "DeFi",
        "APY",
        "TVL",
        "ERC",
    )
)

_CAP_TOKEN_RE = re.compile(r"\b([A-Z][A-Za-z0-9]{2,})\b")

_ALIASES_BY_DISPLAY: dict[str, tuple[str, ...]] = {s.display: s.aliases for s in _KNOWN}


def _alias_pattern(alias: str) -> re.Pattern[str]:
    """A word-boundary matcher for one alias, case-insensitive.

    ``\\b`` alone is not enough for aliases that end in a digit-free word next to punctuation, but
    it is exact enough here because every alias is plain prose. The lookarounds keep e.g.
    ``"sky"`` out of ``"skyscraper"``.
    """
    # "auto-compound(s)" is the vault verb, not the Compound protocol.
    prefix = "(?<!auto-)(?<!auto )" if alias == "compound" else ""
    return re.compile(
        rf"{prefix}(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", re.IGNORECASE
    )


def _first_position(message: str, aliases: tuple[str, ...]) -> int | None:
    positions = [m.start() for alias in aliases if (m := _alias_pattern(alias).search(message))]
    return min(positions) if positions else None


def _generic_subjects(message: str, *, found: int) -> tuple[str, ...]:
    """Proper-noun fallback for protocols missing from the alias table.

    Only used when the alias table found fewer than two subjects. It is intentionally narrow:
    a Capitalised token must be at least three characters and not a question/grammar word.
    """
    if found >= 2:
        return ()
    # Mask known names first, so "Morpho" cannot be counted twice as a generic token.
    masked = message
    for subject in _KNOWN:
        for alias in subject.aliases:
            masked = _alias_pattern(alias).sub(" ", masked)
    seen: list[str] = []
    for match in _CAP_TOKEN_RE.finditer(masked):
        token = match.group(1)
        if token.lower() in _NOT_A_SUBJECT or token in seen:
            continue
        seen.append(token)
    return tuple(seen)


def extract_comparison_subjects(message: str) -> tuple[str, ...]:
    """The protocols/options a comparative message names, in the order they appear.

    An empty tuple means the turn is deictic or unknown ("compare that with…", "compare them");
    the caller then keeps the whole-message retrieval path and must not claim per-entity coverage.
    """
    positioned: list[tuple[int, str]] = []
    for subject in _KNOWN:
        position = _first_position(message, subject.aliases)
        if position is not None:
            positioned.append((position, subject.display))
    positioned.sort(key=lambda item: item[0])
    names = [display for _, display in positioned]
    for token in _generic_subjects(message, found=len(names)):
        if token not in names:
            names.append(token)
    return tuple(names)


def aliases_for(subject: str) -> tuple[str, ...]:
    """The aliases that identify ``subject`` in prose (known table first, else the name itself)."""
    return _ALIASES_BY_DISPLAY.get(subject, (subject.lower(),))


def text_mentions_subject(text: str, subject: str) -> bool:
    """True iff ``text`` names ``subject`` (word-boundary, case-insensitive)."""
    return any(_alias_pattern(alias).search(text) for alias in aliases_for(subject))


def passage_mentions_subject(passage: Passage, subject: str) -> bool:
    """True iff the passage's OWN text/provenance names ``subject``.

    A cosine hit can be near a personality/formatting changelog without containing a word about
    the protocol. That is not coverage, and treating it as coverage is what let 065 answer a
    Morpho-vs-Aave question with release notes. Requiring a literal mention keeps the per-entity
    filter honest; a semantically-related-but-unnamed passage is left out rather than claimed.
    """
    citation = passage.citation
    haystack = "\n".join(
        (passage.content, citation.provider, citation.endpoint, citation.field)
    )
    return text_mentions_subject(haystack, subject)


__all__ = [
    "aliases_for",
    "extract_comparison_subjects",
    "passage_mentions_subject",
    "text_mentions_subject",
]
