# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""058 — the golden eval set, pinned in the blocking agent CI.

The offline run is deterministic (canned LLM + fixed reads) and goes through the REAL
``CoordinatorDag``: routing, the policy gate and block assembly. It must stay fast enough
to run with every agent PR (the suite is capped well below the CI timeout).
"""

from __future__ import annotations

import time

import pytest
from evals.model import load_cases
from evals.runner import run_offline


async def test_golden_offline_suite_passes() -> None:
    started = time.monotonic()
    report = await run_offline()
    elapsed = time.monotonic() - started
    failures = [
        f"{result.id}: {'; '.join(result.failures)}"
        for result in report.results
        if result.status != "pass"
    ]
    assert not failures, "\n".join(failures)
    assert report.infra == 0
    assert report.passed == report.total
    assert elapsed < 60, f"offline suite took {elapsed:.1f}s (budget 60s)"


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("single_call", [False, True])
async def test_golden_routes_are_identical_for_every_flag_combo(
    streaming: bool, single_call: bool
) -> None:
    """059 flags are a latency widening — they must never change a golden route or card.

    Same 72-case set, same canned LLM/reads, all four ``SPARKY_STREAMING`` x ``SPARKY_SINGLE_CALL``
    combos: the route, the blocks and every must(-not)-contain rule must match the pre-059 path.
    """
    report = await run_offline(streaming=streaming, single_call=single_call)
    failures = [
        f"{result.id}: {'; '.join(result.failures)}"
        for result in report.results
        if result.status != "pass"
    ]
    assert not failures, (
        f"streaming={streaming} single_call={single_call}\n" + "\n".join(failures)
    )
    assert report.infra == 0
    assert report.passed == report.total


def test_golden_set_shape() -> None:
    cases = load_cases()
    assert len(cases) >= 56, "the set must cover the 26 audit prompts plus the NEAR/edge cases"
    assert len({case.id for case in cases}) == len(cases)
    audit = [case for case in cases if case.id.startswith("audit-")]
    assert len(audit) == 26, "all 26 beta-audit prompts must be present"
    assert any(case.category == "near" for case in cases)
    assert any(case.category == "injection" for case in cases)
    assert any(case.category == "english_only" for case in cases)
    for case in cases:
        if case.category == "english_only":
            assert case.expected.english, "Taglish prompts must assert an English reply"
        assert case.expected.routes, case.id
