# ruff: noqa: S101
"""060 — as-of stamps and the 48-hour staleness caveat."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import Any

from sparkpoint_agent.coordinator.curated import (
    CuratedContext,
    CuratedPick,
    curated_answer,
    curated_list_answer,
    curated_rate_answer,
)
from sparkpoint_agent.coordinator.guidance import yield_guidance_answer
from sparkpoint_agent.coordinator.staleness import (
    STALE_AFTER_HOURS,
    as_of_date,
    as_of_suffix,
    parse_as_of,
    staleness_caveat,
)

NOW = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)


def _iso(delta: timedelta) -> str:
    return (NOW - delta).isoformat()


def _ago(delta: timedelta) -> str:
    """An as-of relative to the REAL clock, for the non-injected call sites."""
    return (datetime.now(UTC) - delta).isoformat()


def _pick(as_of: str | None) -> CuratedPick:
    return CuratedPick(
        address="0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
        label="Gauntlet USDC Prime",
        net_apy_bps=441,
        tvl_usd=420_747_952.0,
        curator="Gauntlet",
        curator_verified=True,
        reason="Highest screen score.",
        as_of=as_of,
        wrapped=False,
    )


# ── pure helpers ────────────────────────────────────────────────────────────


def test_the_threshold_is_48_hours() -> None:
    assert STALE_AFTER_HOURS == 48


def test_as_of_parses_iso_and_renders_a_date() -> None:
    assert as_of_date("2026-09-18T00:05:00+00:00") == "2026-09-18"
    assert as_of_date("2026-09-18T00:05:00Z") == "2026-09-18"
    assert as_of_date("2026-09-18") == "2026-09-18"
    assert as_of_date(None) is None
    assert as_of_date("not a date") is None
    parsed = parse_as_of("2026-09-18T00:05:00Z")
    assert parsed is not None and parsed.tzinfo is not None


def test_the_suffix_has_both_styles_and_is_empty_without_a_date() -> None:
    assert as_of_suffix("2026-09-18T00:05:00Z") == " (as of 2026-09-18)"
    assert as_of_suffix("2026-09-18T00:05:00Z", style="space") == " as of 2026-09-18"
    assert as_of_suffix(None) == ""


def test_fresh_data_has_no_caveat() -> None:
    assert staleness_caveat(_iso(timedelta(hours=47)), now=NOW) == ""
    assert staleness_caveat(None, now=NOW) == ""


def test_old_data_gets_an_explicit_caveat_naming_the_age_and_the_live_page() -> None:
    caveat = staleness_caveat(_iso(timedelta(days=5)), now=NOW)
    assert "5 days old" in caveat
    assert "check /vault for the live rate" in caveat

    two_days = staleness_caveat(_iso(timedelta(hours=49)), now=NOW)
    assert "2 days old" in two_days


# ── curated / guidance integration ──────────────────────────────────────────


def test_the_curated_rate_answer_carries_the_as_of_and_a_staleness_caveat() -> None:
    old = _ago(timedelta(days=4))
    text = curated_rate_answer(CuratedContext(vault_count=1, pick=_pick(old)))
    assert "as of" in text
    assert "4 days old" in text
    assert "/vault" in text


def test_a_fresh_curated_answer_has_no_staleness_caveat() -> None:
    fresh = _ago(timedelta(hours=2))
    text = curated_answer(CuratedContext(vault_count=1, pick=_pick(fresh)))
    assert "as of" in text
    assert "days old" not in text


def test_the_curated_list_stamps_every_row_and_names_the_oldest() -> None:
    old = _ago(timedelta(days=6))
    fresh = _ago(timedelta(hours=1))
    second = replace(
        _pick(fresh),
        address="0x1111111111111111111111111111111111111111",
        label="Steakhouse USDG",
    )
    text = curated_list_answer(
        CuratedContext(vault_count=2, pick=_pick(fresh), vaults=(_pick(old), second))
    )
    assert text.count("as of") >= 2
    assert "6 days old" in text
    assert "Steakhouse USDG's figure" not in text, "the oldest row owns the caveat"


def test_yield_guidance_options_and_estimates_carry_the_caveat() -> None:
    old = _ago(timedelta(days=9))
    text = yield_guidance_answer(
        message="I have 2,000 USDC for 6 months",
        history=None,
        offers_vault=True,
        curated=CuratedContext(vault_count=1, pick=_pick(old)),
        has_positions=False,
        idle_usdc=200_000_000,
        mandate_risk=None,
        projected_apy_bps=None,
        gross_apy_bps=None,
        performance_fee_bps=1000,
        per_user_cap_base=None,
    )
    assert "as of" in text
    assert "9 days old" in text
    assert "check /vault for the live rate" in text


def test_a_curated_pick_without_an_as_of_is_not_given_a_fake_date() -> None:
    dag_pick: Any = _pick(None)
    text = curated_rate_answer(CuratedContext(vault_count=1, pick=dag_pick))
    assert "as of" not in text
    assert "days old" not in text
