# ruff: noqa: S101  (this is a benchmark script, not product code)
"""073 — time-to-first-delta: old 40-char hold vs sentence-gated ``StreamGuard``.

Runs entirely offline against a fake model. Each scenario emits 4-character tokens every 25 ms,
which is roughly the cadence of a small free-tier model and makes the effect of the release rule
easy to see. The OLD behaviour is the 059/063 40-character opening hold, reconstructed here (its
constant was removed from ``guard_text`` in 073) so the comparison is like-for-like on the same
stream. The NEW behaviour drives the real ``Sparky.stream_reply``.

Usage:
    cd services/agent && uv run python scripts/stream_guard_bench.py
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass

from sparkpoint_agent.agents.guard_text import looks_action_shaped, looks_meta_shaped
from sparkpoint_agent.agents.sparky import MAX_CHARS, Sparky
from sparkpoint_agent.llm import LlmResult, StreamChunk

TOKEN_CHARS = 4
TOKEN_DELAY_S = 0.025
OLD_HOLD_CHARS = 40

THREE_SENTENCES = (
    "Aave is a shared lending market where suppliers earn the variable borrow rate. "
    "Morpho lets curators allocate isolated markets with their own risk parameters. "
    "A curated Morpho vault therefore adds curator and market-selection risk on top of the "
    "underlying lending risk, so neither option is automatically safer."
)
ONE_SENTENCE = (
    "Sparky explains how a lending pool turns borrower interest into a variable supplier yield."
)
LONG_FIRST_SENTENCE = (
    "A lending market matches suppliers who deposit an asset with borrowers who post collateral "
    "and pay interest, and the protocol continuously adjusts the borrow rate to keep utilization "
    "inside a target band, so the supplier yield moves with real demand rather than a fixed "
    "schedule or a promise."
) + " That is why the quoted rate is variable."


@dataclass
class Timed:
    first_delta_s: float | None
    total_s: float


class _TokenLlm:
    """Yields ``text`` in 4-character tokens, 25 ms apart, then the terminal result."""

    def __init__(self, text: str) -> None:
        self._text = text
        self.consumed = 0

    async def stream_complete(self, **_: object) -> AsyncIterator[StreamChunk]:
        for index in range(0, len(self._text), TOKEN_CHARS):
            await asyncio.sleep(TOKEN_DELAY_S)
            self.consumed += 1
            yield StreamChunk(delta=self._text[index : index + TOKEN_CHARS])
        yield StreamChunk(result=LlmResult(text=self._text, stop_reason="end_turn"))


def _prefix_usable(text: str) -> bool:
    return not (looks_action_shaped(text) or looks_meta_shaped(text))


async def _old_hold(text: str) -> Timed:
    """The 059/063 stream loop: hold 40 characters, then paint every later chunk unchecked."""
    llm = _TokenLlm(text)
    pending: list[str] = []
    pending_len = 0
    released = False
    forwarded = 0
    started = time.perf_counter()
    first: float | None = None
    async for chunk in llm.stream_complete():
        if not chunk.delta:
            continue
        if not released:
            pending.append(chunk.delta)
            pending_len += len(chunk.delta)
            if pending_len < OLD_HOLD_CHARS:
                continue
            held = "".join(pending)
            pending.clear()
            if not _prefix_usable(held):
                continue
            released = True
            piece = held[: MAX_CHARS - forwarded]
            forwarded += len(piece)
            if piece and first is None:
                first = time.perf_counter() - started
            continue
        room = MAX_CHARS - forwarded
        if room <= 0:
            continue
        piece = chunk.delta[:room]
        forwarded += len(piece)
        if piece and first is None:
            first = time.perf_counter() - started
    if not released:
        held = "".join(pending)
        if held and _prefix_usable(held):
            first = time.perf_counter() - started
    return Timed(first_delta_s=first, total_s=time.perf_counter() - started)


async def _new_sentence_gated(text: str, *, comparative: bool = False) -> Timed:
    """The real 073 path: ``Sparky.stream_reply`` with sentence-gated release."""
    llm = _TokenLlm(text)
    agent = Sparky(llm=llm)  # type: ignore[arg-type]
    started = time.perf_counter()
    first: float | None = None
    async for chunk in agent.stream_reply("benchmark", comparative=comparative):
        if chunk.delta and first is None:
            first = time.perf_counter() - started
    return Timed(first_delta_s=first, total_s=time.perf_counter() - started)


def _fmt(value: float | None) -> str:
    return "none (held)" if value is None else f"{value:.2f}s"


async def main() -> None:
    scenarios = (
        ("3 sentences (~450 chars)", THREE_SENTENCES, False),
        ("1 sentence (~85 chars)", ONE_SENTENCE, False),
        ("long first sentence (~320 chars)", LONG_FIRST_SENTENCE, False),
        ("comparative (held whole)", THREE_SENTENCES, True),
    )
    print(f"tokens: {TOKEN_CHARS} chars every {TOKEN_DELAY_S * 1000:.0f} ms\n")
    header = (
        f"{'scenario':<34} {'old TTFT':>10} {'old total':>10} {'new TTFT':>12} {'new total':>10}"
    )
    print(header)
    print("-" * len(header))
    for label, text, comparative in scenarios:
        old = await _old_hold(text)
        new = await _new_sentence_gated(text, comparative=comparative)
        print(
            f"{label:<34} {_fmt(old.first_delta_s):>10} {old.total_s:>9.2f}s "
            f"{_fmt(new.first_delta_s):>12} {new.total_s:>9.2f}s"
        )


if __name__ == "__main__":
    asyncio.run(main())
