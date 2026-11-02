# ruff: noqa: S101
"""Bounds applied to human amounts before the smallest-unit conversion."""

from __future__ import annotations

import time
from decimal import Decimal

import pytest

from sparkpoint_agent.amounts import (
    MAX_AMOUNT_TEXT_LENGTH,
    bounded_smallest_units,
)
from sparkpoint_agent.crosschain.service import amount_from_human


@pytest.mark.parametrize(
    ("text", "decimals", "raw"),
    [
        ("20", 6, 20_000_000),
        ("0.5", 6, 500_000),
        ("5,000.50", 6, 5_000_500_000),
        ("1e30", 6, 10**36),
        ("9.99e30", 6, 9_990_000_000_000_000_000_000_000_000_000_000_000),
        ("0" * 63 + "1", 6, 1_000_000),
    ],
)
def test_normal_and_boundary_amounts_convert(text: str, decimals: int, raw: int) -> None:
    assert bounded_smallest_units(text, decimals) == (Decimal(text.replace(",", "")), raw)


def test_multiplier_is_applied_within_bounds() -> None:
    assert bounded_smallest_units("5", 6, multiplier=Decimal(1000)) == (
        Decimal(5000),
        5_000_000_000,
    )


@pytest.mark.parametrize(
    "text",
    [
        "NaN",
        "Infinity",
        "-Infinity",
        "1e31",
        "1E+40",
        "1e999999000",
        "9" * (MAX_AMOUNT_TEXT_LENGTH + 1),
        "0",
        "-1",
        "",
    ],
)
def test_unsafe_amounts_are_rejected(text: str) -> None:
    assert bounded_smallest_units(text, 6) is None


def test_huge_exponent_is_rejected_before_the_conversion() -> None:
    started = time.perf_counter()
    assert amount_from_human("1e999999000", 6) is None
    assert time.perf_counter() - started < 1.0


@pytest.mark.parametrize("text", ["20", "0.5", "5,000.50"])
def test_amount_from_human_matches_the_shared_helper(text: str) -> None:
    assert amount_from_human(text, 6) == bounded_smallest_units(text, 6)
