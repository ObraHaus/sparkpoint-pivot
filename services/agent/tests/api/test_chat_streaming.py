# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism in pytest)
"""059/A2 — ``/chat`` SSE ``text-delta`` framing (additive, never persisted).

Pins the wire contract the web BFF/UI depend on:
  * ``text-delta`` events carry ``{target, delta, streamId}`` and are NOT counted in ``blockCount``;
  * the final ``text`` block still arrives and is the ONLY prose persisted;
  * a mid-stream failure after deltas refunds exactly once and ends in an ERROR block — no partial
    answer is recorded as a successful turn (056 semantics unchanged).
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, cast

from sparkpoint_agent.api.chat import _event_stream
from sparkpoint_agent.api.quota import LimitDecision
from sparkpoint_agent.coordinator import (
    Citation,
    CitationBlock,
    ProseDelta,
    TextBlock,
    ToolStepBlock,
)

OWNER = "0xabc0000000000000000000000000000000000001"
WS = datetime(2026, 10, 26, 16, 0, tzinfo=UTC)


class _StreamingDag:
    def __init__(self, *, boom: bool = False) -> None:
        self._boom = boom

    async def run_chat(self, *_: Any, **__: Any) -> Any:
        yield ToolStepBlock("Thinking that through", "running")
        yield ProseDelta(target="text", delta="Hel", stream_id="general-1")
        yield ProseDelta(target="text", delta="lo", stream_id="general-1")
        if self._boom:
            raise RuntimeError("stream died mid-way")
        yield ToolStepBlock("Thinking that through", "done")
        yield TextBlock("Hello")
        yield CitationBlock(
            sources=(
                Citation(
                    provider="sparkpoint",
                    endpoint="knowledge",
                    field="note",
                    value="v",
                    as_of="2026-10-26T00:00:00Z",
                    stale=False,
                ),
            )
        )


class _Limits:
    def __init__(self) -> None:
        self.refunds: list[tuple[str, str, datetime]] = []

    async def refund(self, owner: str, metric: str, window: datetime) -> int:
        self.refunds.append((owner, metric, window))
        return 0

    async def record_event(self, *_: Any, **__: Any) -> None:
        return None


class _RecordingSink:
    def __init__(self) -> None:
        self.turns: list[tuple[str, str, list[dict[str, Any]] | None]] = []

    async def record(
        self,
        conversation_id: str,
        role: str,
        content: str,
        blocks: Any = None,
    ) -> None:
        self.turns.append((role, content, list(blocks) if blocks else None))


class _Memory:
    def __init__(self) -> None:
        self.remembered: list[Any] = []

    async def remember(self, owner: str, lines: Any) -> None:
        self.remembered.append(list(lines))


def _decision() -> LimitDecision:
    return LimitDecision(
        allowed=True,
        tier="free",
        metric="chat",
        used=1,
        limit=3,
        window_start=WS,
        consumed=True,
    )


def _parse(events: list[str]) -> list[tuple[str, dict[str, Any]]]:
    parsed: list[tuple[str, dict[str, Any]]] = []
    for record in events:
        name = ""
        data: dict[str, Any] | None = None
        for line in record.strip().splitlines():
            if line.startswith("event:"):
                name = line[len("event:") :].strip()
            elif line.startswith("data:"):
                data = json.loads(line[len("data:") :].strip())
        if name and data is not None:
            parsed.append((name, data))
    return parsed


async def _collect(
    dag: Any, limits: _Limits, sink: _RecordingSink
) -> list[tuple[str, dict[str, Any]]]:
    events = [
        event
        async for event in _event_stream(
            cast(Any, dag),
            "hi",
            cast(Any, object()),
            surface="chat",
            conversation_id="cnv_test",
            history=[],
            sink=cast(Any, sink),
            owner_eoa=OWNER,
            memory=cast(Any, _Memory()),
            memory_lines=[],
            quota=_decision(),
            limits=cast(Any, limits),
        )
    ]
    return _parse(events)


async def test_text_deltas_are_framed_and_not_counted_or_persisted() -> None:
    sink = _RecordingSink()
    limits = _Limits()
    events = await _collect(_StreamingDag(), limits, sink)
    deltas = [data for name, data in events if name == "text-delta"]
    assert deltas == [
        {"target": "text", "delta": "Hel", "streamId": "general-1"},
        {"target": "text", "delta": "lo", "streamId": "general-1"},
    ]
    blocks = [data for name, data in events if name == "block"]
    assert [b["type"] for b in blocks] == ["tool_step", "tool_step", "text", "citation"]
    done = next(data for name, data in events if name == "done")
    assert done["blockCount"] == len(blocks)  # deltas are paint, never blocks

    # Persistence sees the FINAL answer only — never the partial paint.
    assistant = next(t for t in sink.turns if t[0] == "assistant")
    assert assistant[1] == "Hello"
    assert [b["type"] for b in (assistant[2] or [])] == ["text", "citation"]
    assert limits.refunds == []


async def test_mid_stream_failure_refunds_once_and_records_no_partial_answer() -> None:
    sink = _RecordingSink()
    limits = _Limits()
    events = await _collect(_StreamingDag(boom=True), limits, sink)
    blocks = [data for name, data in events if name == "block"]
    errors = [b for b in blocks if b["type"] == "error"]
    assert len(errors) == 1 and errors[0]["code"] == "UPSTREAM_UNAVAILABLE"
    assert not any(b["type"] == "text" for b in blocks)
    assert limits.refunds == [(OWNER, "chat", WS)]
    assistant = next(t for t in sink.turns if t[0] == "assistant")
    assert assistant[1] == ""  # nothing partial persisted as a successful answer
    done = next(data for name, data in events if name == "done")
    assert done["blockCount"] == len(blocks)
