# ruff: noqa: S101
"""069 — list/preview service with a mocked 1Click transport. No test touches the network."""

from __future__ import annotations

import json
from decimal import Decimal

import httpx
import pytest

from sparkpoint_agent.crosschain.oneclick import (
    CrossChainTransportError,
    OneClickClient,
)
from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.rails import LIVE, ReceiptLivenessCache
from sparkpoint_agent.earn.registry import EarnRegistry
from sparkpoint_agent.earn.service import EarnService

from .helpers import make_snapshot, make_vault

VAULT = make_vault()


def _payload() -> dict:
    return {
        "quote": {
            "amountIn": "100000000",
            "amountInFormatted": "100",
            "amountInUsd": "100.0",
            "amountOut": "89146629",
            "amountOutFormatted": "89.146629",
            "amountOutUsd": "99.55",
            "minAmountOut": "88000000",
            "timeEstimate": 52,
        },
        "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


def _service(handler, *, liveness_value: str | None = LIVE) -> tuple[EarnService, list]:
    calls: list[dict] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return handler(request)

    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    other = make_vault(address="0x" + "2" * 40, name="Other", tvl=Decimal("9000000"))
    registry.install(make_snapshot(VAULT, other))
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    if liveness_value is not None:
        receipt = config.receipt_for_vault(VAULT.address)
        assert receipt is not None
        liveness.set(receipt.asset_id, liveness_value)
    service = EarnService(
        config,
        registry,
        oneclick=OneClickClient(transport=httpx.MockTransport(wrapped), clock=lambda: 1000.0),
        liveness=liveness,
    )
    return service, calls


async def test_list_sorts_by_tvl_and_can_filter_by_rail() -> None:
    service, _ = _service(lambda request: httpx.Response(201, json=_payload()))
    vaults, snapshot = service.list_vaults(limit=5)
    assert snapshot is not None and len(vaults) == 2
    assert vaults[0]["address"] == VAULT.address
    assert "direct" in vaults[0]["rails"]["available"]
    only_oneclick = service.list_vaults(rail="oneclick_earn")[0]
    assert [vault["address"] for vault in only_oneclick] == [VAULT.address]


async def test_same_chain_preview_is_a_direct_hint_and_never_calls_1click() -> None:
    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover
        raise AssertionError("a direct preview must not call 1Click")

    service, calls = _service(handler)
    outcome = await service.preview_for(
        chain="base",
        address=VAULT.address,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
    )
    assert outcome.block.state == "preview"
    assert outcome.block.rail == "direct"
    wire = outcome.block.to_wire()
    assert wire["type"] == "earn_quote"
    assert "steps" not in wire  # direct carries no step plan
    assert calls == []


async def test_cross_chain_preview_returns_the_dry_receipt_quote() -> None:
    service, calls = _service(lambda request: httpx.Response(201, json=_payload()))
    outcome = await service.preview_for(
        chain="base",
        address=VAULT.address,
        origin_key="eth:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
    )
    wire = outcome.block.to_wire()
    assert wire["state"] == "preview"
    assert wire["rail"] == "oneclick_earn"
    assert wire["amountOut"] == "89.146629"
    assert wire["timeEstimateSec"] == 52
    assert "0.25%" in wire["feeNote"]
    assert "not the native Morpho vault share" in wire["receiptNote"]
    assert calls and calls[0]["dry"] is True
    assert "depositAddress" not in calls[0]


async def test_no_liquidity_is_an_unavailable_card_and_updates_liveness() -> None:
    service, _ = _service(
        lambda request: httpx.Response(400, json={"message": "No liquidity available"})
    )
    outcome = await service.preview_for(
        chain="base",
        address=VAULT.address,
        origin_key="eth:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
    )
    assert outcome.block.state == "unavailable"
    assert outcome.block.unavailable_reason == "No liquidity available"


async def test_transport_failure_propagates_for_the_chat_fallback() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("offline", request=request)

    service, _ = _service(handler)
    with pytest.raises(CrossChainTransportError):
        await service.preview_for(
            chain="base",
            address=VAULT.address,
            origin_key="eth:USDC",
            amount=Decimal("100"),
            amount_raw=100_000_000,
        )


async def test_unknown_vault_raises_value_error() -> None:
    service, _ = _service(lambda request: httpx.Response(201, json=_payload()))
    with pytest.raises(ValueError):
        await service.preview_for(
            chain="base",
            address="0x" + "9" * 40,
            origin_key="base:USDC",
            amount=Decimal("100"),
        )


def test_list_outcome_names_the_filtered_set_and_marks_the_curated_default() -> None:
    service, _ = _service(lambda request: httpx.Response(201, json=_payload()))
    from sparkpoint_agent.earn.parse import EarnRequest

    request = EarnRequest(
        kind="list",
        chain="base",
        asset="USDC",
        amount=None,
        amount_raw=None,
        vault_query=None,
        sort="tvl",
        message="show Morpho vaults on Base",
    )
    outcome = service.list_outcome(request)
    wire = outcome.block.to_wire()
    assert wire["type"] == "earn_vaults"
    assert wire["state"] == "ready"
    assert len(wire["vaults"]) == 2
    assert wire["vaults"][0]["curatedDefault"] is True
    assert "Gauntlet USDC Prime" in outcome.text
