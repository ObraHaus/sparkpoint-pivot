# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""047 — the bot-run ledger and, mostly, the ONE rule that decides what an operator sees.

`derive_state` is the whole point of this feature. The bots run off the deployed stack, so the
panel cannot tell from chain state whether the fleet is healthy-and-idle, stopped, or failing on
every attempt — all three look like a quiet chain. This rule is what separates them, and getting it
subtly wrong produces the worst possible outcome: a green panel over a dead fleet.

So it is a pure function over (row, now), and it is tested harder than anything else here.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from sparkpoint_agent.db.bot_runs import (
    OVERDUE_GRACE,
    SILENT_AFTER,
    BotRun,
    PgBotRunStore,
    derive_state,
)

NOW = datetime(2026, 8, 18, 12, 0, tzinfo=UTC)


def _run(**over: Any) -> BotRun:
    base: dict[str, Any] = {
        "run_key": "k-00000001",
        "network_id": "robinhood",
        "command": "swap",
        "started_at": NOW - timedelta(minutes=6),
        "finished_at": NOW - timedelta(minutes=5),
        "ok": True,
        "attempted": 4,
        "succeeded": 4,
        "schedule": "hourly",
        "next_run_at": NOW + timedelta(minutes=55),
        "runner_commit": "abc1234",
        "detail": {},
    }
    base.update(over)
    return BotRun(**base)


# ─────────────────────────────────────────────────────────────────────────────
# The health rule
# ─────────────────────────────────────────────────────────────────────────────


def test_a_recent_productive_run_is_healthy() -> None:
    assert derive_state(_run(), now=NOW) == "healthy"


def test_nothing_reported_is_never_run_not_healthy() -> None:
    """⚠️ The default must not be optimistic. A stream nobody has ever run is not a working one."""
    assert derive_state(None, now=NOW) == "never-run"


def test_a_run_that_attempted_everything_and_landed_nothing_is_failing() -> None:
    """⚠️ The defect this rule exists for.

    A swap run where all ten attempts were refused still *completed*: no exception, `ok` true from
    the runner's point of view, heartbeat fresh. Judging health on "did it report?" alone would
    paint that as green, and a fleet that stopped working would go unnoticed for as long as it kept
    reporting punctually.
    """
    assert derive_state(_run(attempted=10, succeeded=0), now=NOW) == "failing"


def test_a_run_that_reported_failure_is_failing() -> None:
    assert derive_state(_run(ok=False), now=NOW) == "failing"


def test_a_run_with_nothing_to_do_is_not_failing() -> None:
    """Attempting zero actions is a legitimate quiet tick — e.g. no yield above the high-water
    mark — and must not be confused with attempting work and failing at all of it."""
    assert derive_state(_run(attempted=0, succeeded=0), now=NOW) == "healthy"


def test_a_missed_promise_is_overdue() -> None:
    """The runner said it would be back; it was not. That is the signal, not elapsed time."""
    late = _run(next_run_at=NOW - OVERDUE_GRACE - timedelta(minutes=1))
    assert derive_state(late, now=NOW) == "overdue"


def test_the_grace_window_is_honoured() -> None:
    """A runner ticking hourly drifts by seconds. An alarm that cries wolf gets ignored."""
    just_late = _run(next_run_at=NOW - OVERDUE_GRACE + timedelta(minutes=1))
    assert derive_state(just_late, now=NOW) == "healthy"


def test_a_runner_that_declared_no_intent_falls_back_to_silence() -> None:
    fresh = _run(next_run_at=None, finished_at=NOW - timedelta(minutes=5))
    stale = _run(next_run_at=None, finished_at=NOW - SILENT_AFTER - timedelta(minutes=1))
    assert derive_state(fresh, now=NOW) == "healthy"
    assert derive_state(stale, now=NOW) == "overdue"


def test_failing_outranks_overdue() -> None:
    """⚠️ Ordering is a decision, not an accident.

    A fleet that is both late AND achieving nothing is a failing fleet. Reporting it as merely
    'late' would understate it, and 'late' is the one an operator is most likely to wave off.
    """
    both = _run(attempted=8, succeeded=0, next_run_at=NOW - timedelta(hours=2))
    assert derive_state(both, now=NOW) == "failing"


# ─────────────────────────────────────────────────────────────────────────────
# The store
# ─────────────────────────────────────────────────────────────────────────────


class FakeDb:
    """Mimics the asyncpg helper: `execute` returns a command tag, `fetch` returns rows."""

    def __init__(self, *, raise_undefined: bool = False) -> None:
        self.rows: list[dict[str, Any]] = []
        self.raise_undefined = raise_undefined
        self.calls = 0

    async def execute(self, query: str, *args: Any) -> str:
        from asyncpg.exceptions import UndefinedTableError

        if self.raise_undefined:
            raise UndefinedTableError("relation \"bot_runs\" does not exist")
        self.calls += 1
        run_key = args[0]
        if any(r["run_key"] == run_key for r in self.rows):
            return "INSERT 0 0"  # ON CONFLICT DO NOTHING
        self.rows.append({
            "run_key": run_key, "network_id": args[1], "command": args[2],
            "started_at": args[3], "finished_at": args[4], "ok": args[5],
            "attempted": args[6], "succeeded": args[7], "schedule": args[8],
            "next_run_at": args[9], "runner_commit": args[10], "detail": args[11],
        })
        return "INSERT 0 1"

    async def fetch(self, query: str, *args: Any) -> list[dict[str, Any]]:
        from asyncpg.exceptions import UndefinedTableError

        if self.raise_undefined:
            raise UndefinedTableError("relation \"bot_runs\" does not exist")
        return list(self.rows)


@pytest.mark.asyncio
async def test_a_repeated_report_is_not_recorded_twice() -> None:
    """The runner posts AFTER the work. A network blip on that post must not inflate the record."""
    store = PgBotRunStore(FakeDb())
    assert await store.record(_run()) is True
    assert await store.record(_run()) is False


@pytest.mark.asyncio
async def test_detail_is_written_with_ensure_ascii_false() -> None:
    """⚠️ The develop database is SQL_ASCII; default JSON escaping has corrupted jsonb here before.
    Asserting the ENCODED string keeps the next writer honest."""
    db = FakeDb()
    store = PgBotRunStore(db)
    await store.record(_run(run_key="k-unicode1", detail={"note": "swept 0.05 ETH → pot"}))
    encoded = db.rows[-1]["detail"]
    assert "→" in encoded, "non-ASCII must survive verbatim, not become a \\u escape"


@pytest.mark.asyncio
async def test_an_unapplied_migration_degrades_instead_of_raising() -> None:
    """An agent deployed ahead of 0037 must serve an honest empty view, not a 500."""
    store = PgBotRunStore(FakeDb(raise_undefined=True))
    assert await store.record(_run()) is False
    assert await store.latest_per_stream() == []
    assert await store.recent() == []
