# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)


# ── 030 · the mandate holds what the product asks for ─────────────────────────


def test_every_030_column_appears_in_both_projections() -> None:
    """The INSERT and SELECT column lists are written out longhand for greppability.

    That is a readability choice with a drift risk, so it is covered here rather than by trusting
    two hand-maintained lists to stay in step.
    """
    from sparkpoint_agent.db.mandates import (
        _030_COLUMNS,
        _INSERT_SQL,
        _SELECT_ACTIVE_SQL,
    )

    for column in _030_COLUMNS:
        assert column in _INSERT_SQL, f"{column} missing from the INSERT"
        assert f"m.{column}" in _SELECT_ACTIVE_SQL, f"{column} missing from the SELECT"
    # The RETURNING projection must carry them too, or row_to_record reads nothing back.
    returning = _INSERT_SQL.split("RETURNING", 1)[1]
    for column in _030_COLUMNS:
        assert column in returning, f"{column} missing from RETURNING"


def test_the_pre_030_fallback_omits_exactly_the_new_columns() -> None:
    """The fallback exists so an un-migrated database still saves the user's plan."""
    from sparkpoint_agent.db.mandates import _030_COLUMNS, _INSERT_SQL_PRE_030

    for column in _030_COLUMNS:
        assert column not in _INSERT_SQL_PRE_030


def test_a_record_without_the_new_fields_omits_them_from_the_wire() -> None:
    """Absence is 'the user never said' — never null, never zero.

    A zero exposure limit would read as a real limit of nothing and silently forbid every
    proposal; the web must be able to tell the two apart (FR-021).
    """
    from datetime import UTC, datetime
    from uuid import uuid4

    from sparkpoint_agent.db.mandates import MandateRecord

    record = MandateRecord(
        id=uuid4(),
        version=1,
        status="confirmed",
        confirmed_at=datetime.now(UTC),
        risk_tier="conservative",
        max_slippage_bps=50,
        horizon_months=12,
        drawdown_tolerance="low",
        goals=[],
        risk_params={},
        summary_text="Lower risk (1/5), capital-preservation-first.",
    )
    wire = record.to_wire()
    for key in (
        "exposureLimitUsdc",
        "exposureLimitPctBps",
        "goalTargetUsdc",
        "goalTargetDate",
        "allowedProtocols",
        "contribution",
        "riskTier",
    ):
        assert key not in wire, f"{key} must be OMITTED when not stated, not null"


def test_stated_fields_round_trip_to_the_wire() -> None:
    from datetime import UTC, date, datetime
    from uuid import uuid4

    from sparkpoint_agent.db.mandates import MandateRecord

    record = MandateRecord(
        id=uuid4(),
        version=7,
        status="confirmed",
        confirmed_at=datetime.now(UTC),
        risk_tier="growth",
        max_slippage_bps=50,
        horizon_months=48,
        drawdown_tolerance="high",
        goals=[{"kind": "reach_target", "label": "Reach a target"}],
        risk_params={},
        summary_text="",
        exposure_limit_usdc=500_000_000,
        goal_target_usdc=10_000_000_000,
        goal_target_date=date(2027, 3, 1),
        allowed_protocols=["aave_v3"],
        contribution={"amountUsdc": "200000000", "cadence": "monthly"},
        risk_tier_display=5,
    )
    wire = record.to_wire()
    # Amounts cross the wire as STRINGS — a 38-digit NUMERIC does not survive a JS number.
    assert wire["exposureLimitUsdc"] == "500000000"
    assert wire["goalTargetUsdc"] == "10000000000"
    assert wire["goalTargetDate"] == "2027-03-01"
    assert wire["allowedProtocols"] == ["aave_v3"]
    assert wire["contribution"]["cadence"] == "monthly"
    assert wire["riskTier"] == 5, "the tier the user actually chose, not the profile's default"


def test_the_schema_capability_is_resolved_before_the_transaction_opens() -> None:
    """The bug this design exists to avoid, found only against a real database.

    The obvious implementation is: attempt the 030 INSERT, catch `UndefinedColumnError`, retry the
    pre-030 one. It CANNOT WORK. The insert runs inside a transaction, and Postgres aborts the
    whole transaction on any statement error — every later command in it, including the retry,
    fails with `InFailedSQLTransactionError`. Unit tests with fakes report success either way,
    which is exactly why this was only caught by running it against the un-migrated database.

    So the capability is probed BEFORE the transaction opens. This test pins the structure, since
    a well-meaning refactor back to try/except would look tidier and be silently broken.
    """
    import inspect

    from sparkpoint_agent.db import mandates

    source = inspect.getsource(mandates.PgMandateStore.persist)
    probe_at = source.index("_probe_030_schema")
    transaction_at = source.index("conn.transaction()")
    assert probe_at < transaction_at, (
        "the schema probe must happen BEFORE the transaction opens — a failed statement inside a "
        "transaction poisons every statement after it"
    )
    assert "except UndefinedColumnError" not in source, (
        "a try/except around the insert cannot recover inside an aborted transaction"
    )


def test_a_failed_probe_assumes_the_older_schema() -> None:
    """Fail-safe direction: the pre-030 statement works against BOTH schemas, so an unanswerable
    probe must resolve to False. Losing four new fields beats losing the user's plan."""
    import asyncio

    from sparkpoint_agent.db import mandates

    class _Broken:
        async def fetchval(self, *_a: object, **_k: object) -> object:
            raise RuntimeError("probe unavailable")

    mandates._has_030_schema = None
    try:
        assert asyncio.run(mandates._probe_030_schema(_Broken())) is False
    finally:
        mandates._has_030_schema = None
