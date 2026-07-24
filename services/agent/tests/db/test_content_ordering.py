# ruff: noqa: S101
"""Regression guard for the in-app /changelog ordering.

Same-day entries share a ``published_at`` (the seed/admin often set a date-only value ⇒ midnight,
so a whole day ties). Without a STABLE secondary sort those ties order unpredictably and a
freshly-added entry lands mid-list instead of on top. The fix is ``ORDER BY published_at DESC, id
DESC`` (id is bigserial ⇒ monotonic insertion order ⇒ newest-added leads within a date). This test
pins it so the tiebreak can't be silently dropped again.
"""

from __future__ import annotations

from sparkpoint_agent.db.content_entries import (
    _ANNOUNCEMENT_SQL,
    _CHANGELOG_SQL,
    _LIST_SQL,
)


def test_ordered_content_queries_carry_the_stable_id_tiebreak() -> None:
    for sql in (_CHANGELOG_SQL, _LIST_SQL, _ANNOUNCEMENT_SQL):
        assert "ORDER BY published_at DESC, id DESC" in sql, (
            "same-day content_entries must order newest-first via the id DESC tiebreak"
        )
