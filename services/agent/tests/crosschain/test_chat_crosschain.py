# ruff: noqa: S101
"""068 — the chat turn routes cross-chain demo prompts BEFORE the planner (zero LLM credits)."""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any

import httpx
import pytest

from sparkpoint_agent.agents.planner import Intent, IntentKind
from sparkpoint_agent.coordinator.dag import ChainContext, CoordinatorDag
from sparkpoint_agent.crosschain.config import default_config
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.crosschain.service import CrossChainService
from sparkpoint_agent.policy import CapHeadroom

USER = "0x2222222222222222222222222222222222222222"
BIG = 10**15


def _payload() -> dict[str, Any]:
    return {
        "quote": {
            "amountIn": "5000000000",
            "amountInFormatted": "5000.0",
            "amountInUsd": "5000.0",
            "amountOut": "6439596",
            "amountOutFormatted": "0.06439596",
            "amountOutUsd": "4986.69",
            "minAmountOut": "6375200",
            "timeEstimate": 480,
        },
        "quoteRequest": {"deadline": "2026-10-31T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


class _ExplodingPlanner:
    calls = 0

    async def classify(self, *_: Any, **__: Any) -> Intent:
        type(self).calls += 1
        raise AssertionError("the cross-chain path must not call the LLM planner")


class _OtherPlanner:
    def __init__(self) -> None:
        self.calls = 0

    async def classify(self, *_: Any, **__: Any) -> Intent:
        self.calls += 1
        return Intent(kind=IntentKind.OTHER)


class _NoopRecommender:
    async def propose(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


class _NoopLiteracy:
    async def tip(self, *_: Any, **__: Any) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


class _NoopPortfolio:
    async def read(self, chain: ChainContext) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


class _NoopMandate:
    async def active(self, chain: ChainContext) -> Any:  # pragma: no cover - not reached
        raise AssertionError("not reached")


def _dag(service: CrossChainService | None, planner: Any) -> CoordinatorDag:
    return CoordinatorDag(
        planner=planner,
        recommender=_NoopRecommender(),
        literacy=_NoopLiteracy(),
        portfolio_provider=_NoopPortfolio(),
        mandate_provider=_NoopMandate(),
        crosschain=service,
    )


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=USER,
        resolved_targets={},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
    )


def _service(handler: Any) -> CrossChainService:
    return CrossChainService(
        default_config(), OneClickClient(transport=httpx.MockTransport(handler))
    )


def _ok_handler(request: httpx.Request) -> httpx.Response:
    return httpx.Response(201, json=_payload())


async def _collect(dag: CoordinatorDag, prompt: str) -> list[dict[str, Any]]:
    return [block.to_wire() async for block in dag.run_chat(prompt, _chain())]


@pytest.mark.parametrize(
    "prompt",
    [
        "Swap 5,000 USDC into native BTC.",
        "Move 10,000 USDC from Ethereum to Base.",
        "Turn 2,000 USDC into SOL on Solana.",
        "Swap 500 USDG to USDC on Base",
    ],
)
async def test_demo_prompts_emit_a_crosschain_block_without_the_llm(prompt: str) -> None:
    _ExplodingPlanner.calls = 0
    service = _service(_ok_handler)
    wires = await _collect(_dag(service, _ExplodingPlanner()), prompt)

    types = [wire["type"] for wire in wires]
    assert "text" in types
    assert types[-1] == "crosschain_quote"
    block = wires[-1]
    assert block["state"] == "preview"
    assert block["origin"]["amount"] in {"5000", "10000", "2000", "500"}
    assert _ExplodingPlanner.calls == 0


async def test_tron_prompt_is_parsed_but_answered_as_unavailable() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return _ok_handler(request)

    wires = await _collect(
        _dag(_service(handler), _ExplodingPlanner()),
        "Pay my supplier 3,000 USDT on Tron.",
    )
    block = wires[-1]
    assert block["type"] == "crosschain_quote"
    assert block["state"] == "unavailable"
    assert "Tron" in block["unavailableReason"]
    assert calls == [], "a paused route must not reach 1Click"


async def test_a_transport_error_is_a_friendly_text_not_a_stack_trace() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    wires = await _collect(_dag(_service(handler), _ExplodingPlanner()), _DEMO_BTC)
    assert "crosschain_quote" not in {wire["type"] for wire in wires}
    text = "\n".join(wire.get("markdown", "") for wire in wires)
    assert "couldn't reach" in text
    assert "Traceback" not in text and "httpx" not in text


_DEMO_BTC = "Swap 5,000 USDC into native BTC."


async def test_the_old_bridge_answer_still_applies_when_no_route_parses() -> None:
    planner = _OtherPlanner()
    wires = await _collect(_dag(_service(_ok_handler), planner), "Bridge my USDC to Sui")
    assert "crosschain_quote" not in {wire["type"] for wire in wires}
    text = "\n".join(wire.get("markdown", "") for wire in wires).lower()
    assert "bridg" in text and "available" in text


async def test_same_chain_swap_is_not_stolen_from_the_existing_flow() -> None:
    planner = _OtherPlanner()
    wires = await _collect(_dag(_service(_ok_handler), planner), "swap 0.1 ETH to USDC")
    assert "crosschain_quote" not in {wire["type"] for wire in wires}
    assert planner.calls == 1


async def test_feature_flag_off_falls_through_to_existing_behaviour() -> None:
    disabled = replace(default_config(), feature_enabled=False)
    service = CrossChainService(
        disabled, OneClickClient(transport=httpx.MockTransport(_ok_handler))
    )
    planner = _OtherPlanner()
    wires = await _collect(_dag(service, planner), "Move 10,000 USDC from Ethereum to Base.")
    assert "crosschain_quote" not in {wire["type"] for wire in wires}
    assert planner.calls == 1


async def test_the_sse_wire_carries_camel_case_fields() -> None:
    wires = await _collect(_dag(_service(_ok_handler), _ExplodingPlanner()), _DEMO_BTC)
    block = wires[-1]
    assert block["origin"]["chainLabel"] == "Base"
    assert block["origin"]["evmChainId"] == 8453
    assert block["destination"]["addressKind"] == "btc"
    assert block["timeEstimateSec"] == 480
    assert json.dumps(block)  # serializable SSE payload
