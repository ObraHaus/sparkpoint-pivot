# ruff: noqa: S101
"""028 · pure derivation — platform activity → memory lines (activity.py).

No I/O anywhere in the module under test, so these cover the whole risky surface directly:
line formats for every kind/label combination, the tx-hash dedup join, the first-fold sample,
the per-fold cap, cursor arithmetic, and the honesty rules (approx-marked swap notionals,
unitless unknown tokens, amountless faucet claims).
"""

from __future__ import annotations

from datetime import UTC, datetime

from sparkpoint_agent.activity import (
    FIRST_FOLD_SAMPLE,
    MAX_FOLD_LINES,
    ActivityEvent,
    format_line,
    merge_and_dedup,
    normalize_tx,
    plan_fold,
)
from sparkpoint_agent.memory import MAX_LINE_CHARS


def _at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 8, day, hour, tzinfo=UTC)


def _flow(
    day: int,
    kind: str = "deposit",
    amount: int = 500_000_000,
    tx: str = "aa" * 32,
    block: int = 100,
    log: int = 0,
) -> ActivityEvent:
    return ActivityEvent(
        source="flow",
        kind=kind,
        at=_at(day),
        amount_raw=amount,
        decimals=6,
        unit="USDC",
        tx=tx,
        network="base",
        position=(block, log),
    )


def _exec(
    day: int,
    kind: str = "vault_deposit",
    tx: str | None = "aa" * 32,
    reverted: bool = False,
) -> ActivityEvent:
    return ActivityEvent(
        source="exec", kind=kind, at=_at(day, 11), tx=tx, reverted=reverted, position="row-1"
    )


# ── line formats (data-model §3) ────────────────────────────────────────────────


def test_manual_deposit_line() -> None:
    assert format_line(_flow(1)) == "deposited 500.00 USDC into the vault (yourself, Aug 1)"


def test_manual_withdraw_line() -> None:
    line = format_line(_flow(2, kind="withdraw", amount=120_000_000))
    assert line == "withdrew 120.00 USDC from the vault (yourself, Aug 2)"


def test_via_sparky_label() -> None:
    event = ActivityEvent(
        source="flow",
        kind="deposit",
        at=_at(2),
        amount_raw=500_000_000,
        decimals=6,
        unit="USDC",
        via_sparky=True,
    )
    assert format_line(event) == "deposited 500.00 USDC into the vault (via Sparky's plan, Aug 2)"


def test_reverted_line_is_gentle_and_amountless() -> None:
    line = format_line(_exec(2, kind="vault_withdraw", reverted=True))
    assert line == "a vault withdrawal you signed didn't go through (reverted, Aug 2)"
    assert "USDC" not in line


def test_exec_only_kinds_fold_standalone() -> None:
    line = format_line(_exec(2, kind="session_key_grant", tx=None))
    assert line == "granted a session key (yourself, Aug 2)"


def test_unknown_exec_kind_humanizes_never_raises() -> None:
    line = format_line(_exec(2, kind="mystery_new_kind", tx=None))
    assert "mystery new kind" in line and line.endswith("(yourself, Aug 2)")


def test_swap_line_is_marked_approximate() -> None:
    event = ActivityEvent(
        source="swap",
        kind="swap",
        at=_at(2),
        amount_raw=1_000_000_000,
        decimals=6,
        unit="USDC",
        approx=True,
        network="base",
        position=(200, 1),
    )
    assert format_line(event) == "made a token swap (~1,000.00 USDC, Aug 2)"


def test_swap_in_an_unknown_token_renders_unitless_no_invented_symbol() -> None:
    # Constitution III: honest over specific — we know decimals, not the symbol.
    event = ActivityEvent(
        source="swap",
        kind="swap",
        at=_at(3),
        amount_raw=5_000_000_000_000_000_000,
        decimals=18,
        unit=None,
        approx=True,
    )
    assert format_line(event) == "made a token swap (~5.00 tokens, Aug 3)"


def test_faucet_line_has_a_date_but_no_amount() -> None:
    event = ActivityEvent(source="faucet", kind="faucet_claim", at=_at(2))
    line = format_line(event)
    assert line == "claimed test SRK from the faucet (Aug 2)"
    assert "SRK " not in line.replace("test SRK from", "")


def test_every_line_obeys_the_clamp() -> None:
    event = ActivityEvent(
        source="exec", kind="x" * 300, at=_at(2), tx=None
    )
    assert len(format_line(event)) <= MAX_LINE_CHARS


# ── dedup (research R6) ─────────────────────────────────────────────────────────


def test_flow_plus_exec_same_tx_is_one_via_sparky_line() -> None:
    merged = merge_and_dedup([_flow(1), _exec(1)])
    assert len(merged) == 1
    only = merged[0]
    assert only.source == "flow" and only.via_sparky and only.amount_raw == 500_000_000


def test_dedup_works_regardless_of_input_order() -> None:
    merged = merge_and_dedup([_exec(1), _flow(1)])
    assert len(merged) == 1 and merged[0].via_sparky


def test_events_without_tx_never_dedup() -> None:
    merged = merge_and_dedup([_exec(1, kind="session_key_grant", tx=None), _flow(1, tx="bb" * 32)])
    assert len(merged) == 2


def test_a_reverted_exec_twin_marks_the_merged_event_reverted() -> None:
    merged = merge_and_dedup([_flow(1), _exec(1, reverted=True)])
    assert len(merged) == 1 and merged[0].reverted


def test_normalize_tx_bridges_bytea_and_hex_strings() -> None:
    assert normalize_tx(b"\xaa" * 32) == "aa" * 32
    assert normalize_tx("0x" + "AA" * 32) == "aa" * 32
    assert normalize_tx(None) is None and normalize_tx("") is None


# ── plan_fold (D1 / caps / cursor advance) ──────────────────────────────────────



def test_first_fold_takes_the_most_recent_sample_and_jumps_to_head() -> None:
    events = [_flow(day=d, tx=f"{d:064x}", block=100 + d) for d in range(1, 13)]
    plan = plan_fold(events, prior_cursor=None)
    assert plan.first_fold
    assert len(plan.events) == FIRST_FOLD_SAMPLE
    assert [e.at.day for e in plan.events] == [8, 9, 10, 11, 12]  # the most recent 5
    # Cursor jumped past EVERYTHING seen, not just the sample.
    assert plan.cursor["flows"]["base"] == {"block": 112, "log": 0}


def test_steady_state_folds_oldest_first_capped_at_ten() -> None:
    events = [_flow(day=d, tx=f"{d:064x}", block=100 + d) for d in range(1, 15)]
    plan = plan_fold(events, prior_cursor={"v": 1})
    assert not plan.first_fold
    assert len(plan.events) == MAX_FOLD_LINES
    assert [e.at.day for e in plan.events] == list(range(1, 11))  # oldest first
    # Cursor advanced only past what FOLDED — days 11-14 will fold next turn.
    assert plan.cursor["flows"]["base"] == {"block": 110, "log": 0}


def test_cursor_preserves_other_sources_sub_cursors() -> None:
    prior = {"v": 1, "faucet": "2026-08-01T00:00:00+00:00", "execs": {"ts": "x", "deferred": []}}
    plan = plan_fold([_flow(2)], prior_cursor=prior)
    assert plan.cursor["faucet"] == "2026-08-01T00:00:00+00:00"
    assert plan.cursor["execs"] == {"ts": "x", "deferred": []}


def test_empty_delta_is_a_no_op_plan() -> None:
    plan = plan_fold([], prior_cursor={"v": 1, "flows": {"base": {"block": 5, "log": 0}}})
    assert plan.events == ()
    assert plan.cursor["flows"]["base"] == {"block": 5, "log": 0}


def test_swap_positions_advance_their_own_bucket_per_network() -> None:
    swap = ActivityEvent(
        source="swap",
        kind="swap",
        at=_at(2),
        amount_raw=10,
        decimals=6,
        unit="USDC",
        approx=True,
        network="robinhood",
        position=(991, 1),
    )
    plan = plan_fold([swap], prior_cursor={"v": 1})
    assert plan.cursor["swaps"]["robinhood"] == {"block": 991, "log": 1}
    assert "flows" not in plan.cursor
