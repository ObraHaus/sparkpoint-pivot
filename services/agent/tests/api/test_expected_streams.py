# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""`EXPECTED_STREAMS` must match what the scheduled cycle actually runs.

⚠️ This exists because the two drifted, and the drift was user-visible.

The panel listed `("base", "vault")` as an expected stream while `run-cycle.sh` ran only `swap`
and `accrue`. So **Admin → System → Activity bots** showed a permanent **"never run"** for a job
nothing schedules — and the bots were already at their per-wallet deposit cap, so it could not have
done anything even if it had been scheduled.

A warning that can never clear is one people learn to scroll past, and then they scroll past a real
one. That makes this worse than showing nothing.

It is also the *same failure shape* as the Dockerfile's hand-written dependency list: a second copy
of a fact, kept in sync by memory. The answer is the same — assert it.
"""

from __future__ import annotations

import pathlib
import re

from sparkpoint_agent.api.admin_bots import EXPECTED_STREAMS

_REPO_ROOT = pathlib.Path(__file__).resolve().parents[4]
_CYCLE = _REPO_ROOT / "ops" / "testnet-bots" / "run-cycle.sh"

#: `--chain <id>` → the `network_id` the indexers and the reporter use.
_NETWORK_BY_CHAIN = {"84532": "base", "46630": "robinhood"}


def _scheduled_streams() -> set[tuple[str, str]]:
    """Parse `run <command> --chain <id>` invocations out of the cycle script."""
    assert _CYCLE.is_file(), (
        f"{_CYCLE} is missing. This test must not be allowed to pass vacuously — a guard that "
        "quietly skips is not a guard."
    )
    found: set[tuple[str, str]] = set()
    for line in _CYCLE.read_text().splitlines():
        stripped = line.strip()
        if not stripped.startswith("run "):
            continue
        match = re.match(r"run\s+(\w+)\s+.*--chain\s+(\d+)", stripped)
        if not match:
            continue
        command, chain = match.group(1), match.group(2)
        network = _NETWORK_BY_CHAIN.get(chain)
        assert network, f"run-cycle.sh uses chain {chain}, which this test cannot map to a network"
        found.add((network, command))
    return found


def test_the_cycle_script_is_parseable_and_not_empty() -> None:
    """If the parse silently found nothing, every other assertion here would pass vacuously."""
    assert _scheduled_streams(), "parsed no `run ... --chain ...` lines out of run-cycle.sh"


def test_every_scheduled_job_is_listed_as_an_expected_stream() -> None:
    """A job that runs but is not listed never gets an `overdue` verdict — it just goes missing."""
    missing = _scheduled_streams() - set(EXPECTED_STREAMS)
    assert not missing, (
        f"run-cycle.sh runs {sorted(missing)} but EXPECTED_STREAMS omits them, so the panel would "
        "never report them as overdue when they stop."
    )


def test_every_expected_stream_is_actually_scheduled() -> None:
    """⚠️ THE REGRESSION. The direction that produced a permanent, unclearable 'never run'."""
    phantom = set(EXPECTED_STREAMS) - _scheduled_streams()
    assert not phantom, (
        f"EXPECTED_STREAMS lists {sorted(phantom)} but nothing in run-cycle.sh runs them, so the "
        "panel shows a 'never run' that can never clear. Either schedule the job or drop it from "
        "the list — an alarm nobody can act on trains people to ignore the ones they can."
    )
