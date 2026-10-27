# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""``/chat`` quota refund (feature 054) — the SSE error path, MOCKED.

Pins the load-bearing behaviour:
  * a turn that fails mid-stream (the ``UPSTREAM_UNAVAILABLE`` path) returns its quota unit for
    the SAME metric and the window captured at consume time;
  * a successful turn is not refunded;
  * a fail-open decision (nothing was charged) is never refunded;
  * a refund-store error is swallowed so the degraded response still completes.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, cast

from sparkpoint_agent.api.chat import _event_stream, _NoopConversationSink, _NoopMemorySink
from sparkpoint_agent.api.quota import LimitDecision
from sparkpoint_agent.coordinator import TextBlock

OWNER = "0xabc0000000000000000000000000000000000001"
WS = datetime(2026, 10, 26, 16, 0, tzinfo=UTC)  # 2026-10-27 00:00 Asia/Manila


class _Dag:
    def __init__(self, *, boom: bool) -> None:
        self._boom = boom

    async def run_chat(self, *_: Any, **__: Any) -> Any:
        yield TextBlock("partial answer")
        if self._boom:
            raise RuntimeError("gateway exhausted")


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


async def _collect(dag: _Dag, limits: _Limits, decision: LimitDecision) -> list[str]:
    return [
        event
        async for event in _event_stream(
            cast(Any, dag),
            "where can I earn yield?",
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
    assert limits.events == [("refund", "chat", "free")]
    assert any("UPSTREAM_UNAVAILABLE" in e for e in events)
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
