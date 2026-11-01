# ruff: noqa: S101, S105, S106  (pytest asserts; test-only fixture token)
"""073 — guarded prose never reaches the HTTP SSE client.

A real uvicorn server, the real ``/chat`` route + middleware, and a fake streaming model. Every
``text-delta`` the client receives is concatenated and checked against the shared guard examples;
a comparative turn must emit NO prose delta at all; a clean turn must paint before ``done`` and
reconcile exactly with the authoritative final block.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
import uvicorn
from fastapi import FastAPI

from sparkpoint_agent.agents.guard_text import _META_SHAPED
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
TOKEN = "073-test-token"
BIG = 10**15

#: One literal example per guard pattern family. Every one must be caught by the live predicates;
#: the test asserts that too, so a future pattern cannot silently have no E2E cover.
GUARDED_EXAMPLES = (
    # One literal for every _META_SHAPED pattern, in the module's order.
    "The reference notes are unavailable.",
    "That is in the memory data.",
    "We need to answer this.",
    "The user asks about Aave.",
    "USER_MEMORY was attached.",
    "The system prompt says so.",
    "The notes I am reviewing do not cover it.",
    "Based on the notes, it cannot say.",
    "The documents provided are incomplete.",
    "My instructions are unclear.",
    "The reference information does not include it.",
    "The information provided to me is partial.",
    "The information provided does not cover it.",
    "The information I have is partial.",
    "The context does not include Morpho.",
    "My sources are silent.",
    "The reference material available is thin.",
    # One literal for every _ACTION_SHAPED pattern.
    "It emitted proposedAction here.",
    '{"type": "vault_deposit", "amount": "1"}',
    "It called vault_deposit now.",
    "It called aave_supply now.",
    "Send 0x" + "ab" * 32 + " right away.",
)


class _ScriptedLlm:
    """Pops one ``(deltas, full_text)`` entry per streaming call; fixed intent for the planner."""

    def __init__(self, *, intent: Intent, answers: list[tuple[list[str], str]]) -> None:
        self._intent = intent
        self._answers = list(answers)
        self.stream_calls = 0

    def queue(self, *answers: tuple[list[str], str]) -> None:
        self._answers.extend(answers)

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return StructuredResult(ok=True, value=self._intent)

    async def complete(self, **_: Any) -> LlmResult:
        _, text = self._answers.pop(0)
        return LlmResult(text=text, stop_reason="end_turn")

    async def stream_complete(self, **_: Any) -> AsyncIterator[StreamChunk]:
        self.stream_calls += 1
        deltas, text = self._answers.pop(0)
        for delta in deltas:
            yield StreamChunk(delta=delta)
        yield StreamChunk(result=LlmResult(text=text, stop_reason="end_turn"))


class _Portfolio:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView(net_worth_usd="0.00", idle_usdc=0)


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return None


class _Prices:
    async def get(self, symbols: tuple[str, ...]) -> PriceSnapshot:
        stamp = datetime(2026, 10, 29, 12, 0, tzinfo=UTC)
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
        return conversation_id or "cnv_073"

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


def _build_app(llm: _ScriptedLlm) -> FastAPI:
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


async def _chat(port: int, message: str) -> tuple[list[tuple[str, dict[str, Any]]], list[float]]:
    """Return parsed events plus a timestamp per event, so paint-before-done is assertable."""
    import time

    events: list[tuple[str, dict[str, Any]]] = []
    stamps: list[float] = []
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
                events.append((event, json.loads(line[len("data:") :].strip())))
                stamps.append(time.monotonic() - start)
    return events, stamps


def _painted(events: list[tuple[str, dict[str, Any]]]) -> str:
    return "".join(payload["delta"] for name, payload in events if name == "text-delta")


def _final_prose(events: list[tuple[str, dict[str, Any]]]) -> str:
    finals = [
        payload
        for name, payload in events
        if name == "block" and payload.get("type") in {"text", "tip"}
    ]
    assert finals, events
    return str(finals[0].get("markdown") or finals[0].get("body") or "")


def test_every_guard_example_is_live() -> None:
    from sparkpoint_agent.agents.guard_text import looks_action_shaped, looks_meta_shaped

    assert len(GUARDED_EXAMPLES) >= len(_META_SHAPED)
    assert any(looks_action_shaped(example) for example in GUARDED_EXAMPLES)
    assert any(looks_meta_shaped(example) for example in GUARDED_EXAMPLES)
    for example in GUARDED_EXAMPLES:
        assert looks_action_shaped(example) or looks_meta_shaped(example), example


async def test_general_meta_mid_body_never_reaches_the_sse_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    clean = "Aave is a shared lending pool. "
    llm = _ScriptedLlm(intent=Intent(kind=IntentKind.OTHER), answers=[])
    app = _build_app(llm)
    server, task, port = await _serve(app)
    try:
        for guarded in GUARDED_EXAMPLES:
            answer = clean + guarded + " This tail must never be painted."
            # Non-comparative content failures retry once; queue two identical attempts.
            llm.queue(([clean, guarded + " ", "tail"], answer))
            llm.queue(([clean, guarded + " ", "tail"], answer))
            events, _ = await _chat(port, "How does Aave lending work?")
            painted = _painted(events)
            assert guarded not in painted
            assert "tail" not in painted
            # The first attempt painted its clean sentence, then retracted it on the trip.
            assert any(
                name == "text-delta"
                and payload["streamId"] == "general-1-r"
                and payload["delta"] == ""
                for name, payload in events
            ), events
            assert "general-2-r" in {
                payload["streamId"]
                for name, payload in events
                if name == "text-delta" and payload["delta"] == ""
            }
    finally:
        server.should_exit = True
        await task


async def test_tip_meta_mid_body_never_reaches_the_sse_client(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    clean = "APY means the yearly return on a deposit. "
    good = "It is an estimate, and it can move with utilization."
    guarded = "The user asks about APY."
    llm = _ScriptedLlm(
        intent=Intent(kind=IntentKind.LEARN, topic="apy"),
        answers=[
            ([clean, guarded + " ", "tail"], clean + guarded + " tail"),
            ([good], good),
        ],
    )
    app = _build_app(llm)
    server, task, port = await _serve(app)
    try:
        events, _ = await _chat(port, "What is APY?")
    finally:
        server.should_exit = True
        await task

    painted = _painted(events)
    assert "The user asks" not in painted
    assert "reference notes" not in painted
    assert any(
        name == "text-delta" and payload["streamId"] == "tip-1-r" and payload["delta"] == ""
        for name, payload in events
    )
    assert _final_prose(events) == good


async def test_a_comparative_turn_emits_no_prose_delta_at_all(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    answer = (
        "Morpho and Aave both carry lending-market risk. A Morpho-based vault adds curator and "
        "isolated-market risk, so neither is automatically safer."
    )
    llm = _ScriptedLlm(intent=Intent(kind=IntentKind.OTHER), answers=[([answer], answer)])
    app = _build_app(llm)
    server, task, port = await _serve(app)
    try:
        events, _ = await _chat(port, "Is Morpho safer than Aave?")
    finally:
        server.should_exit = True
        await task

    assert not [event for event in events if event[0] == "text-delta"]
    text = _final_prose(events)
    assert "Morpho" in text and "Aave" in text
    assert text == answer


async def test_a_meta_comparative_turn_serves_the_code_fallback_without_paint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    bad = "The user asks about Morpho and Aave using the reference notes."
    llm = _ScriptedLlm(intent=Intent(kind=IntentKind.OTHER), answers=[([bad], bad)])
    app = _build_app(llm)
    server, task, port = await _serve(app)
    try:
        events, _ = await _chat(port, "Is Morpho safer than Aave?")
    finally:
        server.should_exit = True
        await task

    assert not [event for event in events if event[0] == "text-delta"]
    text = _final_prose(events)
    assert "reference notes" not in text
    assert "The user asks" not in text
    assert "I can't rank Morpho and Aave" in text


async def test_a_clean_answer_paints_before_done_and_reconciles_with_the_final_block(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    text = (
        "Aave is one shared lending market. Morpho adds curator and isolated-market risk. "
        "Neither one is automatically safer for a cautious user."
    )
    pieces = [text[i : i + 20] for i in range(0, len(text), 20)]
    llm = _ScriptedLlm(intent=Intent(kind=IntentKind.OTHER), answers=[(pieces, text)])
    app = _build_app(llm)
    server, task, port = await _serve(app)
    try:
        events, stamps = await _chat(port, "How does Aave lending work?")
    finally:
        server.should_exit = True
        await task

    names = [name for name, _ in events]
    assert "text-delta" in names and "done" in names
    first_delta = names.index("text-delta")
    assert names.index("done") > first_delta
    assert _painted(events) == text
    assert _final_prose(events) == text
