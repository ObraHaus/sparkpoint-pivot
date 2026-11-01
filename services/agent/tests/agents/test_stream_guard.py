# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism in pytest)
"""073 — the incremental sentence-gated stream guard.

These pin the release rules and the trip behaviour that keep guarded prose off the wire:
boundaries (decimals, abbreviations, newlines), the no-boundary cap + lookbehind tail, cumulative
cross-segment matching, action shapes, the caller clamp, and the sticky trip.
"""

from __future__ import annotations

from sparkpoint_agent.agents.sparky import _clamp
from sparkpoint_agent.agents.stream_guard import (
    LOOKBEHIND_CHARS,
    SEGMENT_CAP_CHARS,
    StreamGuard,
)


def test_a_decimal_does_not_end_a_segment() -> None:
    guard = StreamGuard()
    assert guard.feed("The net APY is 4.45") == []
    assert guard.feed(" percent today.") == ["The net APY is 4.45 percent today."]
    assert not guard.tripped


def test_common_abbreviations_do_not_end_a_segment() -> None:
    guard = StreamGuard()
    assert guard.feed("Use e.g. Aave") == []
    assert guard.feed(" or vs. Morpho") == []
    assert guard.feed(" for the same risk.") == ["Use e.g. Aave or vs. Morpho for the same risk."]


def test_a_newline_ends_a_segment() -> None:
    guard = StreamGuard()
    assert guard.feed("First line\n") == ["First line\n"]
    assert guard.feed("Second line.") == ["Second line."]


def test_no_boundary_within_the_cap_keeps_a_lookbehind_tail() -> None:
    guard = StreamGuard()
    text = "word " * 100  # 500 chars, no terminator and no newline
    released = guard.feed(text)

    assert released, "a cap-forced release must paint something"
    assert len(guard.released_text) <= SEGMENT_CAP_CHARS
    assert len(guard.pending_text) >= LOOKBEHIND_CHARS
    assert guard.pending_text == text[len(guard.released_text) :]
    # Nothing before the cap is painted just because it exists.
    short = StreamGuard()
    assert short.feed("word " * 10) == []


def test_cross_segment_meta_phrase_trips_before_the_phrase_is_released() -> None:
    guard = StreamGuard()
    first = guard.feed("Morpho is a lending market. It is based on the reference")
    assert first == ["Morpho is a lending market."]
    assert not guard.tripped

    assert guard.feed(" notes provided here.") == []
    assert guard.tripped
    assert guard.reason == "meta"
    assert "reference notes" not in guard.released_text


def test_action_shape_mid_stream_trips_with_priority() -> None:
    guard = StreamGuard()
    assert guard.feed("Aave is one shared pool. It emitted ") == ["Aave is one shared pool."]
    assert guard.feed('{"type": "vault_deposit", "amount": "1"}') == []
    assert guard.tripped
    assert guard.reason == "action"
    assert '"type":' not in guard.released_text


def test_a_trip_is_sticky_and_releases_nothing_further() -> None:
    guard = StreamGuard()
    guard.feed("A clean opening sentence. ")
    painted = guard.released_text
    guard.feed("The user asks about Aave.")
    assert guard.tripped
    assert guard.feed(" Anything after the trip is ignored.") == []
    assert guard.released_text == painted


def test_forwarding_stays_within_the_caller_clamp() -> None:
    text = (
        "First sentence is here. Second sentence is here. Third sentence is here. "
        "Fourth sentence is here."
    )
    guard = StreamGuard(max_chars=60)
    for index in range(0, len(text), 7):
        guard.feed(text[index : index + 7])

    final = _clamp(text)
    assert len(guard.released_text) <= 60
    guard.finish(final)
    assert final.startswith(guard.released_text)
    assert guard.released_text == final
