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
#:
#: This is deliberately broad: a sentence opener or ordinary function word (determiner,
#: preposition, conjunction, pronoun, auxiliary, question word) must never become a subject via
#: the proper-noun fallback. "For" was lost when the old mixed-case set was refactored to a
#: lowercased comprehension; restoring it alone is not enough, so the whole function-word family
#: is listed. Domain tokens that are Capitalised but not protocols stay here too.
_NOT_A_SUBJECT = frozenset(
    word.lower()
    for word in (
        # Question / instruction words.
        "Compare",
        "Compared",
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
        "Whom",
        "Whose",
        "Whether",
        "Explain",
        "Tell",
        "Show",
        "Give",
        "List",
        "Describe",
        "Define",
        "Consider",
        "Regarding",
        "Please",
        "Versus",
        "Vs",
        # Determiners and pronouns.
        "A",
        "An",
        "The",
        "This",
        "That",
        "These",
        "Those",
        "My",
        "Your",
        "His",
        "Her",
        "Its",
        "Our",
        "Their",
        "I",
        "Me",
        "We",
        "Us",
        "You",
        "They",
        "Them",
        "Him",
        "Some",
        "Any",
        "All",
        "Both",
        "Each",
        "Every",
        "Either",
        "Neither",
        "No",
        "Another",
        "Such",
        "Many",
        "Much",
        "More",
        "Most",
        "Few",
        "Little",
        "Several",
        # Prepositions and conjunctions.
        "About",
        "Above",
        "Across",
        "After",
        "Against",
        "Along",
        "Among",
        "Around",
        "At",
        "Before",
        "Behind",
        "Below",
        "Beneath",
        "Beside",
        "Between",
        "Beyond",
        "By",
        "Despite",
        "Down",
        "During",
        "Except",
        "For",
        "From",
        "In",
        "Inside",
        "Into",
        "Like",
        "Near",
        "Of",
        "Off",
        "On",
        "Onto",
        "Out",
        "Outside",
        "Over",
        "Past",
        "Per",
        "Since",
        "Through",
        "Throughout",
        "To",
        "Toward",
        "Towards",
        "Under",
        "Underneath",
        "Until",
        "Up",
        "Upon",
        "Via",
        "With",
        "Within",
        "Without",
        "And",
        "But",
        "Or",
        "Nor",
        "So",
        "Yet",
        "Because",
        "Although",
        "Though",
        "While",
        "Whereas",
        "If",
        "Unless",
        "As",
        "Than",
        "Not",
        "Then",
        "There",
        "Here",
        # Auxiliaries / modals.
        "Am",
        "Be",
        "Been",
        "Being",
        "Is",
        "Are",
        "Was",
        "Were",
        "Do",
        "Does",
        "Did",
        "Has",
        "Have",
        "Had",
        "May",
        "Might",
        "Must",
        "Shall",
        "Will",
        "Would",
        "Could",
        "Should",
        "Can",
        # Comparison adjectives / audience nouns.
        "Better",
        "Best",
        "Worse",
        "Worst",
        "Safer",
        "Safest",
        "Riskier",
        "Riskiest",
        "Beginner",
        "Beginners",
        "Cautious",
        "User",
        "Users",
        # Domain tokens that are Capitalised but are not protocol names.
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

#: Every canonical subject the alias table knows, in table order. The facts table (074) must
#: cover exactly this set, and tests pin the two together.
KNOWN_SUBJECTS: tuple[str, ...] = tuple(s.display for s in _KNOWN)


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


def _positioned_known(message: str) -> list[tuple[int, str]]:
    """Known subjects matched in ``message``, with their first-alias position."""
    positioned: list[tuple[int, str]] = []
    for subject in _KNOWN:
        position = _first_position(message, subject.aliases)
        if position is not None:
            positioned.append((position, subject.display))
    positioned.sort(key=lambda item: item[0])
    return positioned


def extract_known_subjects(message: str) -> tuple[str, ...]:
    """Only the table-known subjects, in message order, with NO proper-noun fallback.

    074 uses this when curated-vault labels are present: a vault label such as ``"Gauntlet USDC
    Prime"`` would otherwise be shredded into fallback tokens (``Gauntlet``, ``Prime``) that are
    not protocol subjects.
    """
    return tuple(display for _, display in _positioned_known(message))


def extract_comparison_subjects(message: str) -> tuple[str, ...]:
    """The protocols/options a comparative message names, in the order they appear.

    An empty tuple means the turn is deictic or unknown ("compare that with…", "compare them");
    the caller then keeps the whole-message retrieval path and must not claim per-entity coverage.
    """
    positioned = _positioned_known(message)
    names = [display for _, display in positioned]
    for token in _generic_subjects(message, found=len(names)):
        if token in names:
            continue
        found = message.find(token)
        positioned.append((found if found >= 0 else len(message) + 1, token))
    positioned.sort(key=lambda item: item[0])
    ordered: list[str] = []
    for _, name in positioned:
        if name not in ordered:
            ordered.append(name)
    return tuple(ordered)


def aliases_for(subject: str) -> tuple[str, ...]:
    """The aliases that identify ``subject`` in prose (known table first, else the name itself)."""
    return _ALIASES_BY_DISPLAY.get(subject, (subject.lower(),))


def text_mentions_subject(text: str, subject: str) -> bool:
    """True iff ``text`` names ``subject`` (word-boundary, case-insensitive).

    A fallback-only subject is just a capitalised token from the user's message, so it has no
    curated alias. If that token is an ordinary function word/sentence opener, the lowercased
    fallback in :func:`aliases_for` would match it in almost any passage ("for" in "for a
    cautious user"), falsely claiming coverage and unlocking the cite gate. Such a token never
    names a subject, so it never matches.
    """
    if subject not in _ALIASES_BY_DISPLAY and subject.strip().lower() in _NOT_A_SUBJECT:
        return False
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
    "KNOWN_SUBJECTS",
    "aliases_for",
    "extract_comparison_subjects",
    "extract_known_subjects",
    "passage_mentions_subject",
    "text_mentions_subject",
]
