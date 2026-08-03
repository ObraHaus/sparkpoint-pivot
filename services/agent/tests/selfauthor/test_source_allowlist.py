# ruff: noqa: S101
"""034 — the allowlist is the primary safety control on the one input we do not author.

A corpus that ingests web content inherits web content's instructions: injecting a handful of
documents into a retrieval system can make it return attacker-chosen answers over 90% of the time,
and no model reliably separates instructions in its prompt from instructions in retrieved text.

Two properties matter more than the rest, and both are the ways allowlists usually fail.
"""

from __future__ import annotations

import pytest

from sparkpoint_agent.selfauthor.allowlist import (
    MAX_QUOTE_CHARS,
    NotPermitted,
    check_url,
    clip_quote,
    host_permitted,
    is_permitted,
    normalise_domain,
    normalise_domains,
)

ALLOWED = ["docs.aave.com", "defillama.com"]


# ── the two failures that matter ─────────────────────────────────────────────


def test_an_empty_allowlist_permits_NOTHING() -> None:
    """The classic bug is `if not allowed: return True` — "nothing configured, so it's fine".

    Here an empty list means fetch no prose at all, so a fresh install, a failed settings read and a
    misconfiguration all fail CLOSED. The cost is a less-informed document; the alternative is an
    unvetted one."""
    assert is_permitted("https://docs.aave.com/anything", []) is False
    assert is_permitted("https://example.com", ()) is False


def test_a_lookalike_host_is_refused() -> None:
    """A substring check would permit every one of these. That is how allowlists leak."""
    for spoof in (
        "https://docs.aave.com.attacker.io/x",
        "https://evil-docs.aave.com/x",
        "https://defillama.com.evil.net/x",
        "https://notdefillama.com/x",
    ):
        assert is_permitted(spoof, ALLOWED) is False, spoof


# ── the ordinary cases ───────────────────────────────────────────────────────


def test_the_exact_host_and_its_subdomains_are_permitted() -> None:
    assert is_permitted("https://docs.aave.com/v3/markets", ALLOWED)
    assert is_permitted("https://api.defillama.com/pools", ALLOWED)
    assert host_permitted("docs.aave.com", ALLOWED)
    assert host_permitted("DOCS.AAVE.COM", ALLOWED), "host matching is case-insensitive"


def test_plain_http_is_refused_even_for_an_allowed_host() -> None:
    """Anyone on the path could rewrite what Sparky reads."""
    assert is_permitted("http://docs.aave.com/v3", ALLOWED) is False


def test_a_refusal_carries_a_reason_worth_recording() -> None:
    """Refusals are written to the evidence table so an admin can tell "we didn't look" from
    "we were not allowed to look" — so the reason has to read like a sentence."""
    with pytest.raises(NotPermitted, match="not on the allowlist"):
        check_url("https://example.com/x", ALLOWED)
    with pytest.raises(NotPermitted, match="only https"):
        check_url("http://docs.aave.com/x", ALLOWED)
    with pytest.raises(NotPermitted, match="list is empty"):
        check_url("https://docs.aave.com/x", [])


# ── normalisation: reject, never silently coerce ─────────────────────────────


def test_a_full_url_in_the_domain_list_is_rejected_by_name() -> None:
    """An admin who typed https://docs.aave.com/v3 must learn it was not stored as they wrote it.

    Silently coercing it to the bare host leaves them believing a PATH restriction is in force when
    none is — the allowlist is per-host, and a quiet coercion hides that."""
    with pytest.raises(ValueError, match="docs.aave.com/v3"):
        normalise_domain("https://docs.aave.com/v3")


@pytest.mark.parametrize(
    "bad",
    [
        "", "   ", "*.aave.com", "docs.aave.com:443",
        "docs aave com", "localhost", ".aave.com", "aave.com.",
    ],
)
def test_malformed_entries_are_rejected(bad: str) -> None:
    with pytest.raises(ValueError):
        normalise_domain(bad)


def test_entries_are_lowercased_deduplicated_and_sorted() -> None:
    assert normalise_domains([" DOCS.Aave.com ", "defillama.com", "docs.aave.com"]) == [
        "defillama.com",
        "docs.aave.com",
    ]


def test_no_domains_is_an_empty_list_not_an_error() -> None:
    assert normalise_domains(None) == []
    assert normalise_domains([]) == []


# ── bounded quotes ───────────────────────────────────────────────────────────


def test_a_quote_is_bounded_and_says_when_it_was_cut() -> None:
    """An unbounded quote is an unbounded injection surface, and a silently shortened quotation is
    a misquotation."""
    clipped = clip_quote("word " * 5000)
    assert len(clipped) <= MAX_QUOTE_CHARS + 8
    assert clipped.endswith("[…]")


def test_a_short_quote_is_untouched_apart_from_whitespace() -> None:
    assert clip_quote("  the rate   is\n4%  ") == "the rate is 4%"
