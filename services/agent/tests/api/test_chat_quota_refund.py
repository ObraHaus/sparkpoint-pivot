# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""``/chat`` quota refund (feature 054) — the SSE error path, MOCKED.

Pins the load-bearing behaviour:
  * a turn that fails mid-stream (the ``UPSTREAM_UNAVAILABLE`` path) returns its quota unit for
    the SAME metric and the window captured at consume time;
  * a turn whose DAG does NOT raise but degrades INTERNALLY to an ``UPSTREAM_UNAVAILABLE``
    ``ErrorBlock`` (general/LEARN/curated-outage prose branches) is refunded exactly once;
  * a successful turn is not refunded;
  * a fail-open decision (nothing was charged) is never refunded;
  * a refund-store error is swallowed so the degraded response still completes.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any, cast

import pytest

from sparkpoint_agent.api.chat import _event_stream, _NoopConversationSink, _NoopMemorySink
from sparkpoint_agent.api.quota import LimitDecision
from sparkpoint_agent.coordinator import ErrorBlock, TextBlock, ToolStepBlock
from sparkpoint_agent.db.limits import EVENT_VERDICTS

OWNER = "0xabc0000000000000000000000000000000000001"
WS = datetime(2026, 10, 26, 16, 0, tzinfo=UTC)  # 2026-10-27 00:00 Asia/Manila


class _Dag:
    def __init__(self, *, boom: bool) -> None:
        self._boom = boom

    async def run_chat(self, *_: Any, **__: Any) -> Any:
        yield TextBlock("partial answer")
        if self._boom:
            raise RuntimeError("gateway exhausted")


class _DegradedDag:
    """The real failure shape: ``run_chat`` completes WITHOUT raising.

    Sparky/literacy absorb the upstream error and return ``fell_back=True``; the curated-store
    outage returns early. Both surface as a terminal ``ErrorBlock("UPSTREAM_UNAVAILABLE")``.
    """

    def __init__(self, *, errors: int = 1) -> None:
        self._errors = errors

    async def run_chat(self, *_: Any, **__: Any) -> Any:
        yield ToolStepBlock("Thinking that through", "running")
        for _ in range(self._errors):
            yield ErrorBlock("UPSTREAM_UNAVAILABLE", "The assistant is unavailable right now.")


class _Limits:
    def __init__(self, *, raise_on_refund: bool = False) -> None:
        self.raise_on_refund = raise_on_refund
        self.refunds: list[tuple[str, str, datetime]] = []
        self.events: list[tuple[str, str, str]] = []

    async def refund(self, owner: str, metric: str, window: datetime) -> int:
        if self.raise_on_refund:
            raise RuntimeError("db down")
        self.refunds.append((owner, metric, window))
        return 0

    async def record_event(
        self, verdict: str, metric: str, tier: str, *, subject: str | None, detail: Any = None
    ) -> None:
        # Mirror the real store / 0015 CHECK: a verdict outside the set must fail in tests.
        if verdict not in EVENT_VERDICTS:
            raise ValueError(f"unknown limits_event verdict {verdict!r}")
        self.events.append((verdict, metric, tier))


def _decision(*, consumed: bool = True) -> LimitDecision:
    return LimitDecision(
        allowed=True,
        tier="free",
        metric="chat",
        used=1,
        limit=3,
        window_start=WS,
        consumed=consumed,
    )


async def _collect(
    dag: Any,
    limits: _Limits,
    decision: LimitDecision,
    *,
    message: str = "where can I earn yield?",
) -> list[str]:
    return [
        event
        async for event in _event_stream(
            cast(Any, dag),
            message,
            cast(Any, object()),
            surface="chat",
            conversation_id="cnv_test",
            history=[],
            sink=_NoopConversationSink(),
            owner_eoa=OWNER,
            memory=_NoopMemorySink(),
            memory_lines=[],
            quota=decision,
            limits=cast(Any, limits),
        )
    ]


async def test_failed_turn_refunds_the_consumed_window() -> None:
    limits = _Limits()
    events = await _collect(_Dag(boom=True), limits, _decision())
    assert limits.refunds == [(OWNER, "chat", WS)]
    # 062: refund is logged, not written as a limits_event (a `refund` verdict is outside 0015).
    assert limits.events == []
    assert any("UPSTREAM_UNAVAILABLE" in e for e in events)
    assert events[-1].startswith("event: done")


@pytest.mark.parametrize(
    ("branch", "message"),
    [
        ("general", "who are you?"),
        ("learn", "what is impermanent loss?"),
        ("curated_outage", "what's the best vault right now?"),
    ],
)
async def test_internally_degraded_turn_refunds_exactly_once(branch: str, message: str) -> None:
    # The DAG never raises; the UPSTREAM_UNAVAILABLE ErrorBlock is the only failure signal.
    limits = _Limits()
    events = await _collect(_DegradedDag(), limits, _decision(), message=message)
    assert branch  # the three prose branches share this emitted-block shape
    assert limits.refunds == [(OWNER, "chat", WS)]
    assert limits.events == []
    assert any('"code":"UPSTREAM_UNAVAILABLE"' in e for e in events)
    assert events[-1].startswith("event: done")


async def test_repeated_upstream_errors_refund_only_once() -> None:
    limits = _Limits()
    events = await _collect(_DegradedDag(errors=2), limits, _decision())
    assert limits.refunds == [(OWNER, "chat", WS)]
    assert events[-1].startswith("event: done")


class _Exhausted429Dag:
    """The beta failure shape: LLM retries exhaust a 429 mid-turn and the turn raises."""

    async def run_chat(self, *_: Any, **__: Any) -> Any:
        yield ToolStepBlock("Thinking that through", "running")
        raise RuntimeError("llm_retry_exhausted status=429")


async def test_429_exhausted_turn_refunds_once_without_a_false_alarm(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Regression for the beta `quota_refund_failed` false alarm (062).

    The counter refund committed, then the `refund` limits_event INSERT raised a CHECK violation,
    so every 429-exhausted turn logged `quota_refund_failed` with no traceback. The fake enforces
    the same verdict set as the DB, so reintroducing the event write makes this test fail loudly.
    """
    limits = _Limits()
    with caplog.at_level(logging.INFO, logger="sparkpoint_agent.api.quota"):
        events = await _collect(_Exhausted429Dag(), limits, _decision())
    assert limits.refunds == [(OWNER, "chat", WS)]  # exactly one refund
    assert sum('"code":"UPSTREAM_UNAVAILABLE"' in e for e in events) == 1
    assert "quota_refunded metric=chat" in caplog.text
    assert "quota_refund_failed" not in caplog.text
    assert events[-1].startswith("event: done")


async def test_successful_turn_is_not_refunded() -> None:
    limits = _Limits()
    events = await _collect(_Dag(boom=False), limits, _decision())
    assert limits.refunds == []
    assert any("partial answer" in e for e in events)
    assert events[-1].startswith("event: done")


async def test_fail_open_decision_is_not_refunded() -> None:
    limits = _Limits()
    await _collect(_Dag(boom=True), limits, _decision(consumed=False))
    assert limits.refunds == []


async def test_refund_error_never_breaks_the_response() -> None:
    limits = _Limits(raise_on_refund=True)
    events = await _collect(_Dag(boom=True), limits, _decision())
    assert any("UPSTREAM_UNAVAILABLE" in e for e in events)
    assert events[-1].startswith("event: done")


async def test_client_disconnect_is_not_refunded() -> None:
    limits = _Limits()
    stream = _event_stream(
        cast(Any, _Dag(boom=False)),
        "where can I earn yield?",
        cast(Any, object()),
        surface="chat",
        conversation_id="cnv_test",
        history=[],
        sink=_NoopConversationSink(),
        owner_eoa=OWNER,
        memory=_NoopMemorySink(),
        memory_lines=[],
        quota=_decision(),
        limits=cast(Any, limits),
    )
    await stream.__anext__()  # the user saw the first block...
    await stream.aclose()  # ...then the browser went away (GeneratorExit, not Exception)
    assert limits.refunds == []
