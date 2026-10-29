# ruff: noqa: S101, S105, S106  (pytest asserts; test-only fixture token)
"""063 — model tokens reach the HTTP SSE client WHILE they are generated.

Uses a real uvicorn server on a free localhost port, the real ``/chat`` route + request middleware,
and a slow fake LLM (5 deltas, 150 ms apart). The old 40-char opening hold painted nothing until
the model had finished for a short answer, so the first ``text-delta`` arrived with ``done``. This
test pins that the first delta is a small fraction of the total turn time.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import uvicorn
from fastapi import FastAPI

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.api.chat import (
    get_chain_provider,
    get_conversation_sink,
    get_coordinator_dag,
    get_memory_sink,
)
from sparkpoint_agent.api.chat import (
    router as chat_router,
)
from sparkpoint_agent.api.middleware import RequestContextMiddleware
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.data.prices import PriceQuote, PriceSnapshot
from sparkpoint_agent.llm import LlmResult, StreamChunk, StructuredResult
from sparkpoint_agent.policy import CapHeadroom

USER = "0x2222222222222222222222222222222222222222"
VAULT = "0x1111111111111111111111111111111111111111"
TOKEN = "063-test-token"
BIG = 10**15
GENERAL_TEXT = (
    "The Aave pool pays yield to suppliers while borrowers pay interest on their loans. Rates "
    "move with utilization, and the protocol routes a share of the fees back to the treasury over "
    "time, so suppliers earn a variable return that reflects real borrowing demand."
)
TIP_TEXT = (
    "APY is the yearly return on a deposit, and it compounds when rewards are reinvested. It lets "
    "you compare products with different payout schedules, but it is an estimate rather than a "
    "promise, and it can move as utilization and reward rates change."
)
PRICE_TEXT = "ETH is about $2,500 as of 12:00 UTC."

DELAY_S = 0.15
CHUNKS = 5


class _SlowLlm:
    """Every streaming call emits 5 small deltas, 150 ms apart (0.75 s total)."""

    def __init__(self, intent: Intent) -> None:
        self._intent = intent
        self.structured_calls = 0

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.structured_calls += 1
        return StructuredResult(ok=True, value=self._intent)

    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text=GENERAL_TEXT, stop_reason="end_turn")

    async def stream_complete(self, *, system: str = "", **_: Any) -> AsyncIterator[StreamChunk]:
        text = TIP_TEXT if "financial-literacy tutor" in system else GENERAL_TEXT
        # Split into CHUNKS near-equal character pieces. Each piece is wider than the 40-character
        # opening hold, so the first paint lands on the first generated chunk (the timing this test
        # pins) while a normal short answer is covered by the agent-layer streaming tests.
        size = (len(text) + CHUNKS - 1) // CHUNKS
        pieces = [text[i : i + size] for i in range(0, len(text), size)][:CHUNKS]
        for piece in pieces:
            await asyncio.sleep(DELAY_S)
            yield StreamChunk(delta=piece)
        yield StreamChunk(result=LlmResult(text=text, stop_reason="end_turn"))


class _Portfolio:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView(net_worth_usd="0.00", idle_usdc=0)


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return None


class _Prices:
    async def get(self, symbols: tuple[str, ...]) -> PriceSnapshot:
        stamp = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)
        return PriceSnapshot(
            quotes={
                symbol.upper(): PriceQuote(
                    symbol=symbol.upper(), usd=2500.0, source="test-feed", as_of=stamp
                )
                for symbol in symbols
            }
        )


class _ChainProvider:
    async def context(self, account: AccountContext, *, surface: str) -> ChainContext:
        return ChainContext(
            chain_id=account.chain_id,
            user_account=account.account,
            owner=account.owner,
            resolved_targets={"sparkpoint_vault": VAULT},
            caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
            market=MarketData(gross_apy_bps=421, projected_apy_bps=379, performance_fee_bps=1000),
        )


class _Sink:
    async def resolve(self, owner: str, conversation_id: str | None, message: str) -> str:
        return conversation_id or "cnv_063"

    async def history(self, conversation_id: str) -> list[tuple[str, str]]:
        return []

    async def record(self, *_: Any, **__: Any) -> None:
        return None


class _Memory:
    async def lines(self, owner: str) -> list[str]:
        return []

    async def remember(self, owner: str, lines: Any) -> None:
        return None

    async def fold_platform_activity(self, **_: Any) -> None:
        return None


class _Store:
    async def get(self, scope: Any) -> None:
        return None

    async def put(self, scope: Any, response: Any) -> None:
        return None


def _build_app(intent: Intent) -> FastAPI:
    llm = _SlowLlm(intent)
    dag = CoordinatorDag(
        planner=Planner(llm=llm),
        recommender=Recommender(llm=llm),
        literacy=Literacy(llm=llm),
        sparky=Sparky(llm=llm),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(),
        prices=_Prices(),  # type: ignore[arg-type]
        streaming=True,
        single_call=False,
    )
    app = FastAPI()
    app.add_middleware(RequestContextMiddleware, store=_Store())
    app.include_router(chat_router)
    app.dependency_overrides[get_coordinator_dag] = lambda: dag
    app.dependency_overrides[get_chain_provider] = lambda: _ChainProvider()
    app.dependency_overrides[get_conversation_sink] = lambda: _Sink()
    app.dependency_overrides[get_memory_sink] = lambda: _Memory()
    return app


async def _serve(app: FastAPI) -> tuple[uvicorn.Server, asyncio.Task[None], int]:
    config = uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error", lifespan="off")
    server = uvicorn.Server(config)
    task = asyncio.create_task(server.serve())
    for _ in range(500):
        if server.started:
            break
        await asyncio.sleep(0.01)
    port = server.servers[0].sockets[0].getsockname()[1]
    return server, task, port


async def _timed_stream(
    port: int, message: str
) -> tuple[dict[str, float], list[tuple[str, dict[str, Any]]], float]:
    """Return (first text-delta, first text block, done timestamps), parsed events, total."""
    marks: dict[str, float] = {}
    events: list[tuple[str, dict[str, Any]]] = []
    start = time.monotonic()
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "X-Account": USER,
        "X-Owner": USER,
        "X-Chain-Id": "8453",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        async with client.stream(
            "POST", f"http://127.0.0.1:{port}/chat", json={"message": message}, headers=headers
        ) as response:
            assert response.status_code == 200, response.aread()
            event = ""
            async for line in response.aiter_lines():
                if line.startswith("event:"):
                    event = line[len("event:") :].strip()
                    continue
                if not line.startswith("data:"):
                    continue
                payload = json.loads(line[len("data:") :].strip())
                events.append((event, payload))
                now = time.monotonic() - start
                if event == "text-delta" and "delta" not in marks:
                    marks["delta"] = now
                if (
                    event == "block"
                    and payload.get("type") in {"text", "tip"}
                    and "block" not in marks
                ):
                    marks["block"] = now
                if event == "done":
                    marks["done"] = now
    return marks, events, time.monotonic() - start


@pytest.mark.parametrize(
    ("message", "intent", "kind", "progressive"),
    [
        ("How does Aave lending work?", Intent(kind=IntentKind.OTHER), "delta", True),
        ("What is APY?", Intent(kind=IntentKind.LEARN, topic="apy"), "delta", True),
        # Deterministic fast path: both first content and done are near-instant (no model).
        ("What is the price of ETH today?", Intent(kind=IntentKind.OTHER), "block", False),
    ],
)
async def test_first_content_reaches_the_http_client_long_before_done(
    monkeypatch: pytest.MonkeyPatch,
    message: str,
    intent: Intent,
    kind: str,
    progressive: bool,
) -> None:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    app = _build_app(intent)
    server, task, port = await _serve(app)
    try:
        marks, events, total = await _timed_stream(port, message)
    finally:
        server.should_exit = True
        await task

    assert "done" in marks
    first_key = "delta" if kind == "delta" else "block"
    assert first_key in marks, events
    if progressive:
        assert marks[first_key] < 0.4 * total, (marks, total)
    else:
        assert marks[first_key] < 1.0, "the deterministic fast path is not held by any model"
        assert not [e for e, _ in events if e == "text-delta"]
    # The final authoritative block still arrives after the paint and reconciles the text.
    finals = [p for e, p in events if e == "block" and p.get("type") in {"text", "tip"}]
    assert finals
    if kind == "delta":
        painted = "".join(p["delta"] for e, p in events if e == "text-delta")
        body = str(finals[0].get("markdown") or finals[0].get("body") or "")
        assert body.startswith(painted.strip()[:10])
        assert marks["delta"] < marks["done"]
