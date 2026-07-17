# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the Sparky persona loader (persona.py).

The persona is TRUSTED system-prompt content (not the RAG corpus): loaded from persona_seed/*.md,
composed once into a memoised, process-stable string, with optional admin overrides layered on top.
These tests pin the load-bearing invariants:
  * the shipped seed composes and carries the safety boundaries;
  * it is emoji/exclamation-free (the brand "no hype" rule) and free of PII/secrets;
  * ``get_persona()`` is memoised → byte-stable (so the literacy SYSTEM prompt / prompt cache stay
    stable), and never starts with the OAuth Claude-Code prefix;
  * an override wins over the seed, but a PII-shaped override is dropped in favour of the seed;
  * ``SPARKPOINT_PERSONA_DIR`` redirects the loader (used by the real dir + fixtures).
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest

from sparkpoint_agent import persona

_EMOJI_RE = re.compile(
    "[" "\U0001f300-\U0001faff" "\U00002600-\U000027bf" "\U0001f000-\U0001f0ff" "]"
)


@pytest.fixture(autouse=True)
def _reset_cache() -> Iterator[None]:
    """Persona is a process-global cache; reset it around each test so state can't leak."""
    persona.set_persona("")
    persona._CACHE = None  # force a lazy recompute on the next get_persona()
    yield
    persona._CACHE = None


def test_seed_sections_present_and_ordered() -> None:
    sections = persona.read_seed_sections()
    # The two required sections must ship.
    assert "identity" in sections
    assert "boundaries" in sections
    # Whatever is present composes in PERSONA_SECTIONS order.
    composed = persona.compose_persona(None)
    idx_identity = composed.index("## IDENTITY")
    idx_boundaries = composed.index("## BOUNDARIES")
    assert idx_identity < idx_boundaries


def test_composed_carries_the_safety_boundaries() -> None:
    text = persona.compose_persona(None).lower()
    # Non-custody / "you sign" framing must survive into the system prompt.
    assert "withdraw" in text
    assert "sign" in text
    assert "never" in text  # the boundaries section is imperative


def test_composed_is_emoji_and_exclamation_free() -> None:
    # The brand "never hypey" rule (no emoji, no exclamation on financial copy) — enforced here so a
    # future persona edit can't quietly reintroduce hype into every answer.
    text = persona.compose_persona(None)
    assert "!" not in text
    assert _EMOJI_RE.search(text) is None


def test_composed_has_no_pii_or_secrets() -> None:
    assert not persona._has_pii(persona.compose_persona(None))


def test_get_persona_is_memoised_and_byte_stable() -> None:
    first = persona.get_persona()
    second = persona.get_persona()
    assert first == second
    assert first is second  # cached object identity → byte-identical every call


def test_persona_never_starts_with_claude_code_prefix() -> None:
    assert not persona.get_persona().startswith("You are Claude Code")


def test_override_wins_over_seed() -> None:
    text = persona.compose_persona({"soul": "# Custom soul\n\nSPARKY_OVERRIDE_MARKER."})
    assert "SPARKY_OVERRIDE_MARKER" in text
    # Other sections still come from the seed.
    assert "## IDENTITY" in text and "## BOUNDARIES" in text


def test_pii_override_is_dropped_in_favour_of_seed() -> None:
    seed_soul = persona.read_seed_sections()["soul"]
    text = persona.compose_persona({"soul": "leaky note reach me at alice@example.com"})
    assert "alice@example.com" not in text  # the bad override is refused
    assert seed_soul.splitlines()[0] in text  # the seed soul is used instead


def test_persona_dir_override(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    (tmp_path / "IDENTITY.md").write_text("# Fixture identity\n\nFIXTURE_IDENTITY_MARKER.")
    (tmp_path / "BOUNDARIES.md").write_text("# Fixture boundaries\n\nFIXTURE_BOUNDS_MARKER.")
    monkeypatch.setenv(persona.PERSONA_DIR_ENV, str(tmp_path))
    text = persona.compose_persona(None)
    assert "FIXTURE_IDENTITY_MARKER" in text
    assert "FIXTURE_BOUNDS_MARKER" in text
    # Sections absent from the fixture dir are simply skipped (no seed leakage across dirs).
    assert "## SOUL" not in text


def test_frontmatter_is_stripped() -> None:
    # persona_seed/*.md carry a `--- … ---` bookkeeping block that must not reach the prompt.
    text = persona.compose_persona(None)
    assert "title: Identity" not in text
    assert "updated:" not in text
