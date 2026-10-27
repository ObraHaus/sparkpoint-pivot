"""060 — as-of stamps and the 48-hour staleness caveat for stored APY figures.

A net APY is the one number a user cannot sanity-check, so it must never look fresher than it is.
The curated record already carries an ``as_of``; this module turns that into one consistent
sentence-level stamp and an explicit caveat once the data is old enough to mislead.

Pure and clock-injectable: the call sites pass their own ``now`` in tests.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

__all__ = [
    "STALE_AFTER_HOURS",
    "as_of_date",
    "as_of_suffix",
    "as_of_time",
    "parse_as_of",
    "staleness_caveat",
]

STALE_AFTER_HOURS = 48
_STALE_AFTER = timedelta(hours=STALE_AFTER_HOURS)


def parse_as_of(value: str | datetime | None) -> datetime | None:
    """Parse the stored as-of into an aware UTC datetime, or ``None`` when it cannot be read."""
    if isinstance(value, datetime):
        return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


def as_of_date(value: str | datetime | None) -> str | None:
    """``YYYY-MM-DD`` for display, or ``None`` when there is no usable as-of."""
    parsed = parse_as_of(value)
    return parsed.strftime("%Y-%m-%d") if parsed is not None else None


def as_of_suffix(value: str | datetime | None, *, style: str = "paren") -> str:
    """A short stamp for a sentence: `` (as of 2026-09-18)`` or `` as of 2026-09-18``."""
    date = as_of_date(value)
    if date is None:
        return ""
    return f" (as of {date})" if style == "paren" else f" as of {date}"


def as_of_time(value: str | datetime | None, *, now: datetime | None = None) -> datetime:
    """The actual read time when the data carries one, else the injected clock (UTC)."""
    parsed = parse_as_of(value)
    if parsed is not None:
        return parsed
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return current.astimezone(UTC)


def staleness_caveat(
    value: str | datetime | None,
    *,
    now: datetime | None = None,
    subject: str = "This figure",
) -> str:
    """An explicit caveat once the figure is more than 48h old; empty string while fresh.

    The message names how old the figure is and where to see the live rate, so the user can tell a
    stale stored number from a broken one.
    """
    parsed = parse_as_of(value)
    if parsed is None:
        return ""
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    age = current.astimezone(UTC) - parsed
    if age <= _STALE_AFTER:
        return ""
    days = max(1, int(age.total_seconds() // 86_400))
    unit = "day" if days == 1 else "days"
    return (
        f"{subject} is {days} {unit} old — rates move; check /vault for the live rate."
    )
