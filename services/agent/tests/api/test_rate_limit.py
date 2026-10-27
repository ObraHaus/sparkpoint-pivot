# ruff: noqa: S101
"""061 A9 follow-up — the small per-user feedback limiter.

The cap is advisory telemetry protection: it must bound repeated taps per owner, reset after the
window, and fail OPEN (never block a feedback tap because the limiter itself broke).
"""

from __future__ import annotations

from sparkpoint_agent.api.rate_limit import SlidingWindowLimiter


def _clock(now: list[float]) -> float:
    return now[0]


def test_caps_each_user_independently() -> None:
    now = [100.0]
    limiter = SlidingWindowLimiter(limit=2, window_s=3600, clock=lambda: _clock(now))

    assert limiter.allow("0xaaa") is True
    assert limiter.allow("0xaaa") is True
    assert limiter.allow("0xaaa") is False
    # Another wallet has its own window.
    assert limiter.allow("0xbbb") is True


def test_window_slides_forward() -> None:
    now = [0.0]
    limiter = SlidingWindowLimiter(limit=1, window_s=60, clock=lambda: _clock(now))
    assert limiter.allow("0xaaa") is True
    now[0] = 59.9
    assert limiter.allow("0xaaa") is False
    now[0] = 60.0
    assert limiter.allow("0xaaa") is True


def test_fails_open_when_the_clock_breaks() -> None:
    def broken_clock() -> float:
        raise RuntimeError("clock unavailable")

    limiter = SlidingWindowLimiter(limit=1, window_s=60, clock=broken_clock)
    assert limiter.allow("0xaaa") is True
    assert limiter.allow("0xaaa") is True


def test_key_set_is_bounded() -> None:
    now = [0.0]
    limiter = SlidingWindowLimiter(limit=1, window_s=10, clock=lambda: _clock(now), max_keys=2)
    for i in range(10):
        now[0] = float(i)
        assert limiter.allow(f"0x{i}") is True
    assert len(limiter._hits) <= 2  # noqa: SLF001 — the bound is the behaviour under test
