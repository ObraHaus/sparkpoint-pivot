# ruff: noqa: S101
"""076 — NEAR address shape matches the web account-id helper (named + implicit hex)."""

from __future__ import annotations

from sparkpoint_agent.crosschain.addresses import is_valid_address

IMPLICIT = "93a4f6f8c1a9d3b7e2f5a8c4d6b1e9f3a7c2d8b5e4f1a6c9d3b7e2f5a8c4d6b1"


def test_near_accepts_named_and_implicit_accounts() -> None:
    assert is_valid_address("sparkpoint2026.near", "near")
    assert is_valid_address("app.rhea.finance", "near")
    assert is_valid_address(IMPLICIT, "near")
    assert is_valid_address(f"  {IMPLICIT}  ", "near")


def test_near_rejects_uppercase_wrong_length_and_malformed_ids() -> None:
    assert not is_valid_address("Sparkpoint2026.near", "near")
    assert not is_valid_address(IMPLICIT.upper(), "near")
    assert not is_valid_address(IMPLICIT[:63], "near")
    assert not is_valid_address(f"{IMPLICIT}0", "near")
    assert not is_valid_address("bad..near", "near")
    assert not is_valid_address(".near", "near")
    assert not is_valid_address("a" * 65, "near")
