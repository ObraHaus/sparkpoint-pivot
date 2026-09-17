"""045 — a rolling, in-process record of SRK-gate outcomes, so the gate's real health is a number
you can read rather than one you infer.

Why this exists: the gate is FAIL-OPEN, which means every failure is silent by construction — the
wallet simply sees the application form, exactly as a non-holder would. That is the right product
behaviour and the wrong operational behaviour: alpha spent weeks stalling ~20s per non-allowlisted
login, and the only trace was users saying sign-in "sometimes" felt stuck. A fail-open path needs
its own telemetry precisely BECAUSE it never surfaces as an error.

Deliberately in-memory and deliberately small:

  * No migration, no table, no write on the login path — this must never become a second thing that
    can make signing in slow. Recording an outcome is a list append under no lock contention.
  * A restart clears it. That is acceptable: this answers "is the gate healthy *now*", which is the
    question being asked. The durable record of who was granted access remains the allowlist audit
    log, which is unchanged.
  * Bounded at :data:`_MAX_SAMPLES`, so memory is flat regardless of traffic.

⚠️ Per-process, so with multiple agent replicas each reports only its own share. Read it as a
health signal, not an exact count.
"""

from __future__ import annotations

import time
from collections import Counter, deque
from dataclasses import dataclass
from threading import Lock

#: How many recent outcomes to retain. ~1 KB of tuples; enough to see a rate, not an audit log.
_MAX_SAMPLES = 500

#: Outcomes that mean "the gate could not answer", as opposed to answering "no". Only these
#: represent a DEFECT — `below_threshold` is the gate working correctly.
FAILURE_REASONS = frozenset({"rpc_error", "timed_out"})


@dataclass(frozen=True)
class GateSample:
    """One gate check: when it ran, how it ended, and how long the user waited for it."""

    at: float  # epoch seconds
    reason: str
    elapsed_ms: int
    attempts: int


_samples: deque[GateSample] = deque(maxlen=_MAX_SAMPLES)
_lock = Lock()


def record(reason: str, elapsed_ms: int, attempts: int) -> None:
    """Append one outcome. Never raises — telemetry must not be able to break a login."""
    try:
        with _lock:
            _samples.append(
                GateSample(at=time.time(), reason=reason, elapsed_ms=elapsed_ms, attempts=attempts)
            )
    except Exception:  # noqa: BLE001, S110 — a stats failure must never surface on the login path,
        pass          # and there is nothing useful to say about a failed *observation* of a failure


def snapshot() -> dict[str, object]:
    """Summarise the retained window for the admin panel.

    ``failureRatePct`` is the headline: the share of checks that could not answer. It was ~4% in
    steady state before the 045 retry landed, and 100% during an eRPC outage window.
    """
    with _lock:
        rows = list(_samples)

    if not rows:
        return {
            "samples": 0,
            "failureRatePct": None,
            "timedOutPct": None,
            "p50Ms": None,
            "p95Ms": None,
            "maxMs": None,
            "reasons": {},
            "oldestAt": None,
            "newestAt": None,
        }

    times = sorted(r.elapsed_ms for r in rows)
    counts = Counter(r.reason for r in rows)
    failures = sum(counts[r] for r in FAILURE_REASONS if r in counts)

    def pct(idx: float) -> int:
        # Nearest-rank; with n>=1 the index is always in range.
        return times[min(len(times) - 1, max(0, int(idx * len(times))))]

    return {
        "samples": len(rows),
        "failureRatePct": round(100.0 * failures / len(rows), 2),
        "timedOutPct": round(100.0 * counts.get("timed_out", 0) / len(rows), 2),
        "p50Ms": pct(0.50),
        "p95Ms": pct(0.95),
        "maxMs": times[-1],
        "reasons": dict(counts),
        "oldestAt": rows[0].at,
        "newestAt": rows[-1].at,
    }


def reset() -> None:
    """Clear the window (tests)."""
    with _lock:
        _samples.clear()
