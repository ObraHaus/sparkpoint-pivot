# ruff: noqa: S101, S311  (pytest asserts; random is jitter maths, not a cryptographic use)
"""Unit tests for the OAuth 429/529 resilience layer (llm/resilience.py) — no network.

Covers the credential/resilience work order (a)/(b)/(d):
  - 429/529 + transient gateway 5xx (502/503/504) are retryable; other statuses propagate;
  - backoff honors the ``Retry-After`` header; jittered backoff stays within the window;
  - the retry loop retries then succeeds, and re-raises on exhaustion (fail-closed);
  - the process-global limiter SERIALIZES concurrent calls, and fails closed on queue timeout;
  - retry/exhaustion logs carry the Retry-After value but NEVER an exception's (secret) text.

Every error/message is a hand-rolled fake — the ``anthropic`` SDK is never imported.
"""

from __future__ import annotations

import asyncio
import logging
import random
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from sparkpoint_agent.llm.resilience import (
    Limiter,
    LlmBusyError,
    RetryPolicy,
    backoff_delay,
    call_with_resilience,
    is_retryable,
    retry_after_seconds,
    status_code,
)

_LOGGER_NAME = "sparkpoint_agent.llm.resilience"


# ── fake SDK errors ──────────────────────────────────────────────────────────


class _Response:
    def __init__(self, headers: dict[str, Any]) -> None:
        self.headers = headers


class _StatusError(Exception):
    """A stand-in for ``anthropic.APIStatusError`` — carries ``status_code`` + ``response``."""

    def __init__(
        self, status: int, *, retry_after: Any = None, with_response: bool = True
    ) -> None:
        super().__init__(f"status {status}")
        self.status_code = status
        if with_response:
            headers = {"retry-after": str(retry_after)} if retry_after is not None else {}
            self.response = _Response(headers)


async def _noop_sleep(_: float) -> None:
    return None


def _flaky(*errors: Exception, result: Any = "ok"):  # type: ignore[no-untyped-def]
    """A factory that raises each error in turn, then returns ``result``. Tracks call count."""
    state = {"n": 0}

    async def factory() -> Any:
        i = state["n"]
        state["n"] += 1
        if i < len(errors):
            raise errors[i]
        return result

    return factory, state


# ── classification ───────────────────────────────────────────────────────────


def test_status_code_reads_attr() -> None:
    assert status_code(_StatusError(429)) == 429
    assert status_code(ValueError("no status")) is None


@pytest.mark.parametrize(
    "code, retry",
    [(429, True), (529, True), (502, True), (503, True), (504, True), (400, False), (500, False)],
)
def test_is_retryable_transient_and_gateway_5xx(code: int, retry: bool) -> None:
    assert is_retryable(_StatusError(code)) is retry


def test_non_status_exception_not_retryable() -> None:
    assert is_retryable(RuntimeError("boom")) is False


# ── Retry-After parsing ──────────────────────────────────────────────────────


def test_retry_after_integer_seconds() -> None:
    assert retry_after_seconds(_StatusError(429, retry_after=5)) == 5.0


def test_retry_after_http_date() -> None:
    when = datetime.now(UTC) + timedelta(seconds=12)
    header = when.strftime("%a, %d %b %Y %H:%M:%S GMT")
    got = retry_after_seconds(_StatusError(429, retry_after=header))
    assert got is not None
    assert 8.0 <= got <= 13.0  # ~12s, allowing for sub-second clock drift


def test_retry_after_absent_or_malformed() -> None:
    assert retry_after_seconds(_StatusError(429)) is None  # no header
    assert retry_after_seconds(_StatusError(429, retry_after="soon")) is None  # unparseable
    assert retry_after_seconds(_StatusError(429, with_response=False)) is None  # no response


# ── backoff maths ────────────────────────────────────────────────────────────


def test_backoff_honors_retry_after_clamped_to_budget() -> None:
    policy = RetryPolicy(total_budget_s=60.0)
    assert backoff_delay(1, retry_after=7.0, policy=policy, rng=random.Random(0)) == 7.0
    # A server asking for longer than our budget is clamped to the budget.
    assert backoff_delay(1, retry_after=999.0, policy=policy) == 60.0


def test_backoff_full_jitter_within_exponential_window() -> None:
    policy = RetryPolicy(base_delay_s=0.5, max_delay_s=8.0)
    rng = random.Random(1234)
    for attempt in range(1, 5):
        window = min(policy.max_delay_s, policy.base_delay_s * (2 ** (attempt - 1)))
        for _ in range(50):
            delay = backoff_delay(attempt, retry_after=None, policy=policy, rng=rng)
            assert 0.0 <= delay <= window


# ── the retry driver ─────────────────────────────────────────────────────────


async def test_retries_then_succeeds_and_honors_retry_after() -> None:
    factory, state = _flaky(_StatusError(429, retry_after=3), result="done")
    slept: list[float] = []

    async def record_sleep(d: float) -> None:
        slept.append(d)

    out = await call_with_resilience(
        factory,
        policy=RetryPolicy(max_attempts=3),
        limiter=Limiter(max_inflight=2),
        sleep=record_sleep,
    )
    assert out == "done"
    assert state["n"] == 2  # one failure + one success
    assert slept == [3.0]  # backoff honored the Retry-After header exactly


async def test_non_retryable_propagates_without_retry() -> None:
    factory, state = _flaky(_StatusError(400), result="never")
    with pytest.raises(_StatusError) as exc:
        await call_with_resilience(factory, limiter=Limiter(), sleep=_noop_sleep)
    assert exc.value.status_code == 400
    assert state["n"] == 1  # tried exactly once — a 400 is never re-sent


async def test_exhaustion_reraises_and_logs_retry_after_not_secret(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Simulate an SDK error whose text carries a secret-looking value; it must NOT be logged.
    leaky = _StatusError(429, retry_after=1)
    leaky.args = ("Authorization: Bearer SUPERSECRET-LEAK",)
    factory, state = _flaky(leaky, leaky, leaky)

    with caplog.at_level(logging.WARNING, logger=_LOGGER_NAME):
        with pytest.raises(_StatusError):
            await call_with_resilience(
                factory,
                policy=RetryPolicy(max_attempts=3),
                limiter=Limiter(),
                sleep=_noop_sleep,
            )
    assert state["n"] == 3  # capped at max_attempts
    assert "llm_retry_exhausted" in caplog.text
    assert "retry_after=1.0" in caplog.text
    assert "SUPERSECRET" not in caplog.text  # the exception's text never reaches a log line


async def test_time_budget_stops_retrying() -> None:
    # A tiny budget with a clock that jumps 100s per tick exhausts on the first check.
    factory, state = _flaky(_StatusError(429), _StatusError(429), result="late")
    ticks = iter([0.0, 100.0, 200.0, 300.0])

    def clock() -> float:
        return next(ticks)

    with pytest.raises(_StatusError):
        await call_with_resilience(
            factory,
            policy=RetryPolicy(max_attempts=5, total_budget_s=60.0),
            limiter=Limiter(),
            sleep=_noop_sleep,
            clock=clock,
        )
    assert state["n"] == 1  # budget spent before a second attempt


# ── global concurrency limiter ───────────────────────────────────────────────


async def test_limiter_serializes_concurrent_calls() -> None:
    limiter = Limiter(max_inflight=1)
    active = 0
    peak = 0

    async def factory() -> str:
        nonlocal active, peak
        active += 1
        peak = max(peak, active)
        await asyncio.sleep(0.01)
        active -= 1
        return "ok"

    results = await asyncio.gather(
        *(call_with_resilience(factory, limiter=limiter, sleep=_noop_sleep) for _ in range(5))
    )
    assert results == ["ok"] * 5
    assert peak == 1  # never more than one in-flight — serialized onto the quota


async def test_limiter_allows_up_to_max_inflight() -> None:
    limiter = Limiter(max_inflight=2)
    active = 0
    peak = 0

    async def body() -> None:
        nonlocal active, peak
        async with limiter.slot():
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            active -= 1

    await asyncio.gather(*(body() for _ in range(6)))
    assert peak == 2


async def test_limiter_queue_timeout_fails_closed() -> None:
    limiter = Limiter(max_inflight=1, queue_timeout_s=0.02)

    async def hold() -> None:
        async with limiter.slot():
            await asyncio.sleep(0.2)

    holder = asyncio.create_task(hold())
    await asyncio.sleep(0.01)  # let the holder take the only permit
    with pytest.raises(LlmBusyError):
        async with limiter.slot():
            pass  # pragma: no cover — never entered; the acquire times out
    await holder
