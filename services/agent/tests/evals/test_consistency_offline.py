# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""074 — the comparative consistency suite runs in blocking agent CI.

Every comparative prompt is replayed five times through the REAL ``CoordinatorDag`` with a
seeded noisy model. The assertions are the product guarantee: identical route, skeleton, subject
order and citations; a Bottom line always present; no meta/action text; English only.
"""

from __future__ import annotations

import time

import pytest
from evals.consistency import (
    PROMPTS,
    LiveNotConfigured,
    render,
    run_live,
    run_modes,
    run_offline,
)


async def test_consistency_offline_suite_passes() -> None:
    started = time.monotonic()
    report = await run_offline(repeats=5)
    elapsed = time.monotonic() - started
    failures = [
        f"{result.id}: {'; '.join(result.failures)}"
        for result in report.results
        if result.status != "pass"
    ]
    assert not failures, "\n".join(failures)
    assert report.infra == 0
    assert report.total >= 8
    assert report.passed == report.total
    assert report.structural_agreement == 1.0
    assert elapsed < 60, f"consistency suite took {elapsed:.1f}s (budget 60s)"


@pytest.mark.parametrize("streaming", [False, True])
@pytest.mark.parametrize("single_call", [False, True])
async def test_consistency_is_identical_for_every_flag_combo(
    streaming: bool, single_call: bool
) -> None:
    report = await run_offline(repeats=5, streaming=streaming, single_call=single_call)
    failures = [
        f"{result.id}: {'; '.join(result.failures)}"
        for result in report.results
        if result.status != "pass"
    ]
    assert not failures, f"streaming={streaming} single_call={single_call}\n" + "\n".join(failures)
    assert report.structural_agreement == 1.0


async def test_all_modes_report_is_green() -> None:
    report = await run_modes(repeats=3)
    assert report.failed == 0, render(report)
    assert report.structural_agreement == 1.0


async def test_live_consistency_skips_cleanly_without_gateway_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("LITELLM_BASE_URL", raising=False)
    monkeypatch.delenv("LITELLM_API_KEY", raising=False)
    monkeypatch.delenv("LITELLM_MODEL", raising=False)
    with pytest.raises(LiveNotConfigured):
        await run_live(PROMPTS[:1], repeats=1)


def test_consistency_prompt_set_covers_the_required_shapes() -> None:
    ids = {prompt.id for prompt in PROMPTS}
    assert len(PROMPTS) >= 8
    assert any("safer" in prompt.message for prompt in PROMPTS)
    assert any("Lido" in prompt.message and "Rocket Pool" in prompt.message for prompt in PROMPTS)
    assert any("Aerodrome" in prompt.message for prompt in PROMPTS)
    assert any("SparkPoint Vault" in prompt.message for prompt in PROMPTS)
    assert any(
        "Gauntlet" in prompt.message and "Steakhouse" in prompt.message for prompt in PROMPTS
    )
    assert any(prompt.history for prompt in PROMPTS), "a deictic follow-up is covered"
    assert any("Yearn" in prompt.message for prompt in PROMPTS), "an unknown subject is covered"
    assert len(ids) == len(PROMPTS)
