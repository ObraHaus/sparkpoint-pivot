"""A small in-process per-user rate cap for lightweight, non-custody endpoints.

The feedback endpoint accepts a client-controlled ``message_id``; without a cap a caller could grow
its own row set without bound (the upsert makes repeats idempotent, but not the number of distinct
ids). This is an abuse cap on advisory telemetry, NOT a security boundary.

Process-global, like the LLM concurrency limiter: in a multi-worker deployment each worker enforces
its own window, so the effective cap can be up to ``workers × limit``. That is acceptable here
because nothing reads feedback to grant or deny anything. Fail-OPEN by construction — any limiter
error admits the request so a feedback tap can never turn into a failed UI action.
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Callable, Hashable
from threading import Lock

#: Opportunistic memory bound: if many distinct owners hit the limiter, stale/old windows are
#: evicted rather than letting the key set grow forever. Eviction only RELAXES an advisory cap.
_MAX_KEYS = 10_000


class SlidingWindowLimiter:
    """Allow at most ``limit`` admits per key in any trailing ``window_s`` seconds.

    ``clock`` is injectable so tests can advance time without sleeping. All failures admit.
    """

    def __init__(
        self,
        *,
        limit: int,
        window_s: float,
        clock: Callable[[], float] = time.monotonic,
        max_keys: int = _MAX_KEYS,
    ) -> None:
        if limit < 1:
            raise ValueError("limit must be >= 1")
        if window_s <= 0:
            raise ValueError("window_s must be > 0")
        self._limit = limit
        self._window_s = window_s
        self._clock = clock
        self._max_keys = max_keys
        self._hits: dict[Hashable, deque[float]] = {}
        self._lock = Lock()
        self._last_sweep = 0.0

    def allow(self, key: Hashable) -> bool:
        """Record one hit and return True, or return False when the key is over its cap."""
        try:
            now = self._clock()
            with self._lock:
                hits = self._hits.get(key)
                if hits is None:
                    hits = deque()
                    self._hits[key] = hits
                cutoff = now - self._window_s
                while hits and hits[0] <= cutoff:
                    hits.popleft()
                if len(hits) >= self._limit:
                    return False
                hits.append(now)
                self._sweep(now)
                return True
        except Exception:
            return True

    def _sweep(self, now: float) -> None:
        """Drop empty/expired windows, and cap the key set if a burst of distinct owners arrives."""
        if len(self._hits) <= self._max_keys and now - self._last_sweep < self._window_s:
            return
        cutoff = now - self._window_s
        stale = [key for key, hits in self._hits.items() if not hits or hits[-1] <= cutoff]
        for key in stale:
            self._hits.pop(key, None)
        self._last_sweep = now
        overflow = len(self._hits) - self._max_keys
        if overflow > 0:
            oldest = sorted(self._hits.items(), key=lambda item: item[1][-1])[:overflow]
            for key, _ in oldest:
                self._hits.pop(key, None)


#: 061 A9 follow-up — a generous per-wallet cap on thumbs taps. A normal user sends at most a
#: handful; the point is to bound a scripted client, not to police honest use.
FEEDBACK_RATE_LIMIT_PER_HOUR = 60


def feedback_limiter() -> SlidingWindowLimiter:
    """The process-wide limiter for ``POST /chat/feedback`` (overridable in tests)."""
    return _FEEDBACK_LIMITER


_FEEDBACK_LIMITER = SlidingWindowLimiter(
    limit=FEEDBACK_RATE_LIMIT_PER_HOUR,
    window_s=3600,
)
