# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""058 — the live runner is bounded by a single wall-clock budget.

The per-case timeout alone cannot protect the 45-minute CI job: retries plus the judge can
turn a handful of slow cases into an overrun. These pin the global deadline and the fact that
partial results are still written.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import evals.runner as runner
import pytest
from evals.model import Case, Expectation
from evals.runner import run_live, write_outputs

_BUDGET_REASON = "wall-clock budget exhausted"


class _FakeClient:
    @classmethod
    def from_env(cls) -> _FakeClient:
        return cls()


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now


def _configure(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(runner, "gateway_from_env", lambda: object())
    monkeypatch.setattr(runner, "AsyncClaudeClient", _FakeClient)


def _case(case_id: str) -> Case:
    return Case(
        id=case_id,
        category="budget",
        prompt="hello",
        expected=Expectation(routes=("general",)),
    )


async def test_an_exhausted_budget_still_writes_results_and_summary(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _configure(monkeypatch)
    report = await run_live((_case("first"), _case("second")), budget_s=0.0)

    assert [result.status for result in report.results] == ["infra", "infra"]
    assert [result.observed for result in report.results] == ["skipped", "skipped"]
    assert all(result.infra_reason == _BUDGET_REASON for result in report.results)

    results_path, summary_path = write_outputs(report, tmp_path)
    payload: Any = json.loads(results_path.read_text(encoding="utf-8"))
    assert payload["infra"] == 2
    assert payload["failed"] == 0
    assert _BUDGET_REASON in summary_path.read_text(encoding="utf-8")


async def test_the_budget_stops_executing_and_skips_the_remaining_cases(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _configure(monkeypatch)
    clock = _FakeClock()
    executed: list[str] = []

    async def fake_execute(case: Case, client: Any) -> tuple[list[dict[str, Any]], Any]:
        executed.append(case.id)
        clock.now += 100.0  # the first case blows past the deadline
        return (
            [{"type": "text", "markdown": "The vault is showing 4.41% net APY."}],
            {"first_token": 1.0, "total": 1.0},
        )

    monkeypatch.setattr(runner, "_execute_timed", fake_execute)
    report = await run_live(
        (_case("first"), _case("second"), _case("third")),
        budget_s=10.0,
        clock=clock,
    )

    assert executed == ["first"], "the budget must stop work, not just time it"
    assert [result.status for result in report.results] == ["infra", "infra", "infra"]
    assert report.results[0].infra_reason == _BUDGET_REASON
    assert [result.observed for result in report.results[1:]] == ["skipped", "skipped"]
