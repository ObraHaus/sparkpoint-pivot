# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Tier-weighted priority on the LLM limiter (feature 008, US4) — real asyncio, no live LLM.

Pins the "priority compute" contract:
  * the request priority defaults to FREE and ``set_priority`` sets it (per-request contextvar);
  * under contention, a FREE caller (short queue budget) times out to ``LlmBusyError`` FIRST, while
    a PREMIUM caller (full budget) waits and wins the freed slot;
  * the limiter is advisory-compute only — it never sits on a funds path (structural, N2).
"""

from __future__ import annotations

import asyncio

from sparkpoint_agent.llm.resilience import (
    FREE_PRIORITY,
    Limiter,
    LlmBusyError,
    current_priority,
    set_priority,
)


def test_priority_defaults_to_free_and_is_settable() -> None:
    assert current_priority() == FREE_PRIORITY
    set_priority(3)
    assert current_priority() == 3


async def test_premium_wins_the_freed_slot_while_free_times_out() -> None:
    # max_inflight=1 so the single permit is the contended resource. queue budget 0.4s =>
    # free waits 0.2s (FREE_QUEUE_FRACTION), premium waits the full 0.4s.
    lim = Limiter(max_inflight=1, queue_timeout_s=0.4)
    outcome: dict[str, str] = {}

    async def hold() -> None:
        async with lim.slot(priority=5):  # occupy the only permit, release at ~0.3s
            await asyncio.sleep(0.3)

    async def acquire(label: str, priority: int) -> None:
        try:
            async with lim.slot(priority=priority):
                outcome[label] = "acquired"
                await asyncio.sleep(0)
        except LlmBusyError:
            outcome[label] = "busy"

    holder = asyncio.create_task(hold())
    await asyncio.sleep(0.02)  # let the holder take the permit first
    await asyncio.gather(acquire("free", FREE_PRIORITY), acquire("premium", 3), holder)

    assert outcome["free"] == "busy"  # free (0.2s) times out before the 0.3s release
    assert outcome["premium"] == "acquired"  # premium (0.4s) waits and wins the freed permit
