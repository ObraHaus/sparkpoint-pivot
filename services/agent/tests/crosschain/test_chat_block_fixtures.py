# ruff: noqa: S101
"""068 — the Python→TypeScript chat-block contract cannot drift.

The SAME JSON fixtures are parsed by `packages/shared/tests/crosschain-chat-block.test.ts` with
`ChatBlockSchema`. Each test here regenerates the real `CrossChainQuoteBlock.to_wire()` output
(through `CrossChainService`, with a mocked 1Click transport) and asserts exact equality, so a
field rename/nullability change on either side fails one of the two suites.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path
from typing import Any

import httpx
import pytest

from sparkpoint_agent.crosschain.config import default_config
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.crosschain.parse import parse_cross_chain_request
from sparkpoint_agent.crosschain.service import CrossChainService

_FIXTURE_DIR = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "shared"
    / "tests"
    / "fixtures"
    / "crosschain"
)


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((_FIXTURE_DIR / name).read_text(encoding="utf-8"))


def _payload() -> dict[str, Any]:
    return {
        "quote": {
            "amountIn": "5000000000",
            "amountInFormatted": "5000.0",
            "amountInUsd": "5000.000000",
            "amountOut": "6439596",
            "amountOutFormatted": "0.06439596",
            "amountOutUsd": "4986.694350",
            "minAmountOut": "6375200",
            "timeEstimate": 480,
        },
        "quoteRequest": {"deadline": "2026-10-31T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


def _service(handler: Any) -> CrossChainService:
    return CrossChainService(
        default_config(),
        OneClickClient(transport=httpx.MockTransport(handler), clock=lambda: 1000.0),
    )


@pytest.mark.asyncio
async def test_preview_wire_output_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("crosschain-preview.json")

    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(201, json=_payload())

    service = _service(handler)
    request = parse_cross_chain_request("Swap 5,000 USDC into native BTC.", default_config())
    assert request is not None
    outcome = await service.preview(request)

    # `quotedAt` is wall-clock by design; the fixture pins the value so both languages compare
    # the exact same document.
    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture


@pytest.mark.asyncio
async def test_unavailable_wire_output_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("crosschain-unavailable.json")

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("a disabled route must not reach 1Click")

    service = _service(handler)
    request = parse_cross_chain_request("Pay my supplier 3,000 USDT on Tron.", default_config())
    assert request is not None
    outcome = await service.preview(request)

    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture
