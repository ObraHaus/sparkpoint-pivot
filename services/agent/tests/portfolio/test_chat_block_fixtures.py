# ruff: noqa: S101
"""072 — the Python→TypeScript ``portfolio_overview`` contract cannot drift.

The SAME JSON fixtures are parsed by the web's zod schema in the web phase. Each test here
regenerates the real ``PortfolioOverviewBlock.to_wire()`` output through the production models and
asserts exact equality, so a field rename/nullability change on either side fails one suite.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from evals.portfolio_fixtures import portfolio_overview

from sparkpoint_agent.portfolio.chat import build_outcome

_FIXTURE_DIR = (
    Path(__file__).resolve().parents[4] / "packages" / "shared" / "tests" / "fixtures" / "portfolio"
)


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((_FIXTURE_DIR / name).read_text(encoding="utf-8"))


@pytest.mark.parametrize("mode", ["ready", "degraded", "empty"])
def test_portfolio_overview_matches_the_shared_fixture(mode: str) -> None:
    fixture = _fixture(f"portfolio-overview-{mode}.json")
    block = build_outcome(portfolio_overview(mode), "all").block
    assert block.to_wire() == fixture


def test_ready_fixture_carries_every_section_and_camel_case_keys() -> None:
    fixture = _fixture("portfolio-overview-ready.json")
    assert fixture["type"] == "portfolio_overview"
    assert fixture["state"] == "ready"
    assert fixture["focus"] == "all"
    assert {section["key"] for section in fixture["sections"]} == {
        "balances",
        "morpho",
        "kamino",
        "rhea",
        "swaps",
    }
    assert "asOf" in fixture
    assert "totalUsd" in fixture["totals"]
    assert "byChain" in fixture["totals"]


def test_degraded_fixture_marks_each_section_status() -> None:
    fixture = _fixture("portfolio-overview-degraded.json")
    statuses = {section["key"]: section["status"] for section in fixture["sections"]}
    assert statuses["morpho"] == "unavailable"
    assert statuses["kamino"] == "not_linked"
    assert statuses["rhea"] == "unavailable"
    assert statuses["swaps"] == "ok"


@pytest.mark.parametrize("mode", ["ready", "degraded", "empty"])
def test_chat_block_fixture_carries_only_the_non_signable_chat_shape(mode: str) -> None:
    """The endpoint adds `wallet`/`text`; the streamed block must never carry them or a policy."""
    fixture = _fixture(f"portfolio-overview-{mode}.json")
    for forbidden in ("wallet", "text", "policy", "proposedAction"):
        assert forbidden not in fixture


@pytest.mark.parametrize("mode", ["ready", "degraded", "empty"])
def test_every_section_and_row_has_the_common_required_fields(mode: str) -> None:
    """The TS schema requires these; a missing key here fails the web parity suite."""
    fixture = _fixture(f"portfolio-overview-{mode}.json")
    for section in fixture["sections"]:
        assert isinstance(section["key"], str)
        assert isinstance(section["label"], str)
        assert section["status"] in {"ok", "unavailable", "not_linked"}
        assert isinstance(section["rows"], list)
        for row in section["rows"]:
            for field in ("chain", "chainLabel", "protocol", "kind", "symbol"):
                assert isinstance(row[field], str), (section["key"], field)
