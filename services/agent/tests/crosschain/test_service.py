# ruff: noqa: S101
"""068 — preview/live quoting with a mocked 1Click transport. No test touches the network."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from sparkpoint_agent.crosschain.config import default_config
from sparkpoint_agent.crosschain.oneclick import (
    CrossChainTransportError,
    OneClickClient,
    QuoteUnavailable,
)
from sparkpoint_agent.crosschain.parse import parse_cross_chain_request
from sparkpoint_agent.crosschain.service import CrossChainService

_DEADLINE = "2026-10-31T12:30:00.000Z"


def _payload(*, deposit: str | None = None) -> dict[str, Any]:
    quote: dict[str, Any] = {
        "amountIn": "5000000000",
        "amountInFormatted": "5000.0",
        "amountInUsd": "5000.000000",
        "amountOut": "6439596",
        "amountOutFormatted": "0.06439596",
        "amountOutUsd": "4986.694350",
        "minAmountOut": "6375200",
        "timeEstimate": 480,
    }
    if deposit is not None:
        quote["depositAddress"] = deposit
        quote["deadline"] = _DEADLINE
    return {
        "quote": quote,
        "quoteRequest": {"deadline": _DEADLINE},
        "signature": "ed25519:test-signature",
        "timestamp": "2026-10-31T12:00:00.000Z",
    }


def _service(
    handler: Any,
    *,
    api_key: str | None = None,
) -> tuple[CrossChainService, OneClickClient]:
    client = OneClickClient(
        transport=httpx.MockTransport(handler), api_key=api_key, clock=lambda: 1000.0
    )
    return CrossChainService(default_config(), client), client


def _request(prompt: str = "Swap 5,000 USDC into native BTC."):
    request = parse_cross_chain_request(prompt, default_config())
    assert request is not None
    return request


async def test_preview_maps_a_dry_quote_and_surfaces_the_keyless_fee() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        assert request.headers["user-agent"] == "sparkpoint-agent/1.0"
        return httpx.Response(201, json=_payload())

    service, _ = _service(handler)
    outcome = await service.preview(_request())

    assert outcome.block.state == "preview"
    wire = outcome.block.to_wire()
    assert wire["type"] == "crosschain_quote"
    assert wire["origin"]["key"] == "base:USDC"
    assert wire["origin"]["amount"] == "5000"
    assert wire["destination"]["key"] == "btc:BTC"
    assert wire["amountOut"] == "0.06439596"
    assert wire["minAmountOut"] == "0.063752"
    assert wire["timeEstimateSec"] == 480
    assert wire["feeNote"] == "Includes 1Click's 0.25% keyless routing fee."
    assert "about $4,986.69" in outcome.text
    assert "4986.694350" not in outcome.text
    assert seen and seen[0]["dry"] is True
    assert "depositAddress" not in seen[0]


async def test_an_api_key_removes_the_fee_note_and_adds_bearer_auth() -> None:
    seen_auth: list[str | None] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen_auth.append(request.headers.get("authorization"))
        return httpx.Response(201, json=_payload())

    service, _ = _service(handler, api_key="do-not-print-me")
    outcome = await service.preview(_request())
    assert "feeNote" not in outcome.block.to_wire()
    assert seen_auth == ["Bearer do-not-print-me"]


async def test_disabled_tron_route_is_an_unavailable_card_and_no_http_call() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("a disabled route must not reach 1Click")

    service, _ = _service(handler)
    outcome = await service.preview(_request("Pay my supplier 3,000 USDT on Tron."))

    wire = outcome.block.to_wire()
    assert wire["state"] == "unavailable"
    assert "Tron" in wire["unavailableReason"]
    assert "tron:USDT" == wire["destination"]["key"]
    assert "can't quote" in outcome.text


async def test_a_400_minimum_amount_becomes_unavailable_not_an_exception() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"message": "Temporary swap limits: minimum swap amount is $100"},
        )

    service, _ = _service(handler)
    outcome = await service.preview(_request())
    assert outcome.block.state == "unavailable"
    assert outcome.block.unavailable_reason == "Temporary swap limits: minimum swap amount is $100"


async def test_a_transport_failure_propagates_for_the_chat_friendly_fallback() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    service, _ = _service(handler)
    with pytest.raises(CrossChainTransportError):
        await service.preview(_request())


async def test_live_quote_is_the_only_call_that_returns_a_deposit_address() -> None:
    seen: list[dict[str, Any]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(json.loads(request.content))
        return httpx.Response(201, json=_payload(deposit="0xdeposit"))

    service, _ = _service(handler)
    request = _request()
    quote, origin, destination = await service.live_quote(
        origin_key=request.origin_key,
        destination_key=request.destination_key,
        amount=request.amount,
        amount_raw=request.amount_raw,
        recipient="bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
        refund_to="0x0000000000000000000000000000000000000001",
    )

    assert seen[0]["dry"] is False
    assert quote.deposit_address == "0xdeposit"
    assert quote.deadline == _DEADLINE
    assert origin.key == "base:USDC" and destination.key == "btc:BTC"


async def test_tokens_are_cached_within_the_ttl() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(
            200,
            json=[
                {
                    "assetId": "nep141:btc.omft.near",
                    "decimals": 8,
                    "blockchain": "btc",
                    "symbol": "BTC",
                }
            ],
        )

    client = OneClickClient(transport=httpx.MockTransport(handler), clock=lambda: 1000.0)
    first = await client.tokens()
    second = await client.tokens()
    assert first == second and calls == 1
    await client.tokens(force=True)
    assert calls == 2


async def test_a_rejected_live_quote_is_typed() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, json={"message": "Quoting for this pair is not available"})

    service, _ = _service(handler)
    request = _request()
    with pytest.raises(QuoteUnavailable) as raised:
        await service.live_quote(
            origin_key=request.origin_key,
            destination_key=request.destination_key,
            amount=request.amount,
            amount_raw=request.amount_raw,
            recipient="bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq",
            refund_to="0x0000000000000000000000000000000000000001",
        )
    assert raised.value.reason == "Quoting for this pair is not available"


# ── 1112 — a 1Click minimum is base units; show it in the sending asset's human units ──


def test_minimum_amount_error_is_formatted_with_the_sending_asset_decimals() -> None:
    from sparkpoint_agent.crosschain.service import format_quote_error_amount

    raw = "Amount is too low for bridge, try at least 150000"
    assert format_quote_error_amount(raw, decimals=6, symbol="USDC") == (
        "Amount is too low for bridge, try at least 0.15 USDC"
    )
    # 18-dec ETH, 9-dec SOL, 24-dec NEAR: the same threshold renders in each asset's units.
    assert (
        format_quote_error_amount("try at least 150000000000000000", decimals=18, symbol="ETH")
        == "try at least 0.15 ETH"
    )
    assert format_quote_error_amount("minimum amount is 150000000", decimals=9, symbol="SOL") == (
        "minimum amount is 0.15 SOL"
    )
    assert (
        format_quote_error_amount(
            "below the minimum: 150000000000000000000000", decimals=24, symbol="NEAR"
        )
        == "below the minimum: 0.15 NEAR"
    )


def test_already_human_or_unrelated_numbers_are_left_alone() -> None:
    from sparkpoint_agent.crosschain.service import format_quote_error_amount

    for human in (
        "Amount is too low for bridge, try at least 0.15",
        "Temporary swap limits: minimum swap amount is $100",
        "Quoting for this pair is not available",
        "RPC HTTP 400",
    ):
        assert format_quote_error_amount(human, decimals=6, symbol="USDC") == human


async def test_preview_surfaces_the_minimum_in_human_units_not_base_units() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            400,
            json={"message": "Amount is too low for bridge, try at least 150000"},
        )

    service, _ = _service(handler)
    outcome = await service.preview(_request())
    wire = outcome.block.to_wire()
    assert wire["state"] == "unavailable"
    assert wire["unavailableReason"] == ("Amount is too low for bridge, try at least 0.15 USDC")
    assert "0.15 USDC" in outcome.text
    assert "150000" not in outcome.text
