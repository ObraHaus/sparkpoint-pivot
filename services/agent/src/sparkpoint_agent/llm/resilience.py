"""OAuth 429/529 resilience for the Anthropic calls — retry, jitter, a global limiter.

This module is the single place the LLM boundary hardens itself against the transient
upstream failures the LLM path hits under load:

  - **429 Too Many Requests** (rate limit),
  - **529 Overloaded** (Anthropic server capacity), and
  - **502 / 503 / 504** — transient gateway/proxy blips from the LiteLLM → OpenRouter hop
    (a fresh retry usually clears them; without this they surfaced as "Bad Gateway" turn errors).

Design (credential/resilience work order (a)/(b)/(d)):

  - **Retry on 429/529 only** with exponential backoff + FULL JITTER, honoring the
    ``Retry-After`` response header when the server sends one. Capped at ~3 attempts /
    ~60s total per logical request. Any OTHER status (400/401/404/500…) is NON-retryable
    and propagates immediately — a bad request must never be silently re-sent.
  - **One process-global concurrency limiter** — a module-level :class:`Limiter` wrapping an
    ``asyncio.Semaphore`` (1–2 in-flight Anthropic calls) with a bounded acquire timeout, so
    parallel ``/chat`` + ``/recommendations`` requests SERIALIZE onto the OAuth quota instead
    of fanning out and tripping the limit. The permit is released DURING backoff sleeps so a
    waiting request can proceed.
  - **Fail-closed on exhaustion** — the final failure is re-raised unchanged; the Coordinator
    DAG / SSE surface already degrade that to an inert ``UPSTREAM_UNAVAILABLE`` block
    ("advisory temporarily unavailable — vault, quotes, /exit remain live"). Each 429/529 and
    the exhaustion event is logged WITH the ``Retry-After`` value as structured seed data for
    later ``llm_usage`` observability.

Custody / SSE guarantee: this helper only ever wraps a SINGLE non-streaming
``messages.create`` coroutine (:meth:`AsyncClaudeClient.complete`), which returns a whole
``Message`` atomically. A retry therefore re-issues the call BEFORE any token/block has been
emitted downstream — it can never restart a half-emitted SSE stream and duplicate text. The
streaming SSE surface (``dag.run_chat`` → ``api/chat._event_stream``) fails CLOSED on any
error raised after the first block, so exhaustion mid-turn yields one inert error block, not
a re-run.

**No credential ever reaches this module.** The OAuth token lives inside the SDK client
object (``repr``-suppressed); the exceptions raised by the SDK carry the RESPONSE (status +
``Retry-After``), never the request ``Authorization`` header. Nothing here logs a token, and
the log lines below are asserted token-free by the unit tests.

The retry/limiter logic is pure stdlib + duck typing on ``exc.status_code`` /
``exc.response.headers`` — it never imports the ``anthropic`` SDK and never constructs an
SDK error, so the classifier stays trivially testable with hand-rolled fakes.
"""

from __future__ import annotations

import asyncio
import logging
import random
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime

from .claude import ClaudeError

logger = logging.getLogger("sparkpoint_agent.llm.resilience")

# Transient statuses we retry: 429 (rate limit) / 529 (Anthropic overload), plus the gateway
# 5xx (502/503/504) the LiteLLM → OpenRouter proxy hops return transiently. A 4xx that is NOT 429
# is a client error (never re-sent), and 500 is treated as a real (non-transient) server error.
RETRYABLE_STATUS: frozenset[int] = frozenset({429, 502, 503, 504, 529})

# Global limiter defaults — 1–2 in-flight Anthropic calls, a bounded queue wait.
DEFAULT_MAX_INFLIGHT = 2
DEFAULT_QUEUE_TIMEOUT_S = 30.0

_MODULE_RNG = random.Random()  # noqa: S311 — jitter spread, not a cryptographic use


class LlmBusyError(ClaudeError):
    """The concurrency limiter's bounded queue timed out — fail closed (no unbounded wait)."""


# ─────────────────────────────────────────────────────────────────────────────
# Retry policy + backoff maths (pure, deterministic given an injected rng/clock).
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class RetryPolicy:
    """Bounds for the 429/529 retry loop. ~3 attempts / ~60s total (work order (a))."""

    max_attempts: int = 3
    base_delay_s: float = 0.5
    max_delay_s: float = 8.0
    total_budget_s: float = 60.0


def status_code(exc: BaseException) -> int | None:
    """The HTTP status carried by an SDK error (``anthropic.APIStatusError.status_code``).

    Duck-typed so the module never imports the SDK: any exception exposing an ``int``
    ``status_code`` is classified. ``None`` when absent (e.g. a plain ``ValueError``).
    """
    raw = getattr(exc, "status_code", None)
    return raw if isinstance(raw, int) else None


def is_retryable(exc: BaseException) -> bool:
    """True iff the error is a transient 429 / 529 that a retry could clear."""
    code = status_code(exc)
    return code is not None and code in RETRYABLE_STATUS


def retry_after_seconds(
    exc: BaseException, *, now: Callable[[], datetime] | None = None
) -> float | None:
    """Parse the ``Retry-After`` response header off an SDK error, in seconds.

    Handles both wire forms: an integer delta-seconds (``Retry-After: 5``) and an HTTP-date
    (``Retry-After: Wed, 21 Oct 2026 07:28:00 GMT``). Returns a non-negative float, or
    ``None`` when the header is absent/unparseable (the caller then uses jittered backoff).
    Never raises — a malformed header degrades to ``None``.
    """
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    try:
        raw = headers.get("retry-after")
    except Exception:  # noqa: BLE001 — a foreign headers object; treat as absent
        return None
    if raw is None or not str(raw).strip():
        return None
    text = str(raw).strip()
    try:
        return max(0.0, float(int(text)))
    except ValueError:
        pass
    try:
        when = parsedate_to_datetime(text)
    except (TypeError, ValueError):
        return None
    if when is None:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    current = (now or (lambda: datetime.now(UTC)))()
    return max(0.0, (when - current).total_seconds())


def backoff_delay(
    attempt: int,
    *,
    retry_after: float | None,
    policy: RetryPolicy,
    rng: random.Random | None = None,
) -> float:
    """The seconds to sleep before ``attempt``'s retry (``attempt`` is 1-based).

    ``Retry-After`` wins when the server sent one (we obey the server's own pacing, clamped
    to the total budget). Otherwise FULL JITTER over the exponential window:
    ``uniform(0, min(max_delay, base * 2**(attempt-1)))`` — the jitter spreads a fleet's
    retries so they don't re-collide on the quota (AWS "full jitter").
    """
    if retry_after is not None:
        return max(0.0, min(retry_after, policy.total_budget_s))
    window = min(policy.max_delay_s, policy.base_delay_s * (2 ** (attempt - 1)))
    return (rng or _MODULE_RNG).uniform(0.0, window)


# ─────────────────────────────────────────────────────────────────────────────
# Global concurrency limiter — serialize in-flight Anthropic calls (work order (b)).
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Limiter:
    """A process-global cap on concurrent Anthropic calls, backed by an ``asyncio.Semaphore``.

    The default instance :data:`GLOBAL_LIMITER` is module-level and shared by every request,
    so ``/chat`` + ``/recommendations`` running in parallel take turns on the OAuth quota
    instead of bursting. The semaphore is created lazily and re-bound if the running event
    loop changes (production has exactly one loop; per-test loops each get their own), which
    keeps the "serialize within a loop" guarantee without a cross-loop binding error.
    """

    max_inflight: int = DEFAULT_MAX_INFLIGHT
    queue_timeout_s: float | None = DEFAULT_QUEUE_TIMEOUT_S
    _state: tuple[asyncio.AbstractEventLoop, asyncio.Semaphore] | None = field(
        default=None, repr=False, compare=False
    )

    def _semaphore(self) -> asyncio.Semaphore:
        loop = asyncio.get_running_loop()
        state = self._state
        if state is None or state[0] is not loop:
            state = (loop, asyncio.Semaphore(self.max_inflight))
            self._state = state
        return state[1]

    @asynccontextmanager
    async def slot(self) -> AsyncIterator[None]:
        """Hold one in-flight permit for the duration of the block; fail closed on queue timeout.

        The bounded ``queue_timeout_s`` means a saturated limiter never blocks a request
        forever — it raises :class:`LlmBusyError`, which the DAG degrades to
        ``UPSTREAM_UNAVAILABLE`` (fail-closed, nothing signed).
        """
        sem = self._semaphore()
        try:
            if self.queue_timeout_s is None:
                await sem.acquire()
            else:
                await asyncio.wait_for(sem.acquire(), timeout=self.queue_timeout_s)
        except TimeoutError as exc:
            raise LlmBusyError(
                "assistant is busy (concurrency limit); no request was sent"
            ) from exc
        try:
            yield
        finally:
            sem.release()


# The process-global limiter (work order (b): module-level, shared by every request).
GLOBAL_LIMITER = Limiter()


# ─────────────────────────────────────────────────────────────────────────────
# The retry driver.
# ─────────────────────────────────────────────────────────────────────────────


async def call_with_resilience[T](
    factory: Callable[[], Awaitable[T]],
    *,
    policy: RetryPolicy | None = None,
    limiter: Limiter | None = None,
    rng: random.Random | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> T:
    """Run ``factory()`` under the global limiter, retrying 429/529 with jittered backoff.

    ``factory`` is a zero-arg coroutine factory (re-invoked per attempt) so each retry
    re-issues a fresh, identical request. Non-retryable errors propagate immediately;
    retryable ones are retried until the attempt/time budget is spent, then re-raised
    unchanged (fail-closed). ``clock``/``sleep``/``rng`` are injectable for deterministic
    tests. Every retry and the exhaustion are logged WITH the ``Retry-After`` value and NO
    token (work order (d)).
    """
    policy = policy or RetryPolicy()
    limiter = limiter or GLOBAL_LIMITER
    start = clock()
    attempt = 0
    while True:
        attempt += 1
        last_exc: Exception | None = None
        # The permit is held ONLY around the call itself — released before any backoff sleep.
        async with limiter.slot():
            try:
                return await factory()
            except Exception as exc:  # noqa: BLE001 — classify, then re-raise or retry
                if not is_retryable(exc):
                    raise
                last_exc = exc
        assert last_exc is not None  # noqa: S101 — only reached on a retryable error

        code = status_code(last_exc)
        wait_hint = retry_after_seconds(last_exc)
        elapsed = clock() - start
        if attempt >= policy.max_attempts or elapsed >= policy.total_budget_s:
            logger.error(
                "llm_retry_exhausted status=%s attempts=%d retry_after=%s elapsed=%.2fs",
                code,
                attempt,
                wait_hint,
                elapsed,
            )
            raise last_exc

        delay = backoff_delay(attempt, retry_after=wait_hint, policy=policy, rng=rng)
        remaining = policy.total_budget_s - elapsed
        delay = min(delay, max(0.0, remaining))
        logger.warning(
            "llm_rate_limited status=%s attempt=%d/%d retry_after=%s backoff=%.2fs",
            code,
            attempt,
            policy.max_attempts,
            wait_hint,
            delay,
        )
        await sleep(delay)
