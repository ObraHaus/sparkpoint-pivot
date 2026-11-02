# ruff: noqa: S101
"""068 — the cross-chain router through a real FastAPI app (gates + ownership + dry default)."""

from __future__ import annotations

import json
import time
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from sparkpoint_agent.api.crosschain import (
    get_crosschain_config,
    get_crosschain_limiter,
    get_crosschain_service,
    get_crosschain_store,
    router,
)
from sparkpoint_agent.api.errors import ApiError, api_error_handler, validation_error_handler
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.vault import get_account
from sparkpoint_agent.crosschain.config import default_config
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.crosschain.service import CrossChainService

OWNER = "0x2222222222222222222222222222222222222222"
DEPOSIT = "0x9999999999999999999999999999999999999999"
BTC_RECIPIENT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq"


def _quote_payload(*, dry: bool) -> dict[str, Any]:
    quote: dict[str, Any] = {
        "amountIn": "5000000000",
        "amountInFormatted": "5000.0",
        "amountInUsd": "5000.0",
        "amountOut": "6439596",
        "amountOutFormatted": "0.06439596",
        "amountOutUsd": "4986.69",
        "minAmountOut": "6375200",
        "timeEstimate": 480,
    }
    if not dry:
        quote["depositAddress"] = DEPOSIT
        quote["deadline"] = "2026-10-31T12:30:00.000Z"
    return {
        "quote": quote,
        "quoteRequest": {"deadline": "2026-10-31T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


class FakeStore:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, str], dict[str, Any]] = {}
        self.recorded: list[dict[str, Any]] = []
        self.status_updates: list[tuple[str, str]] = []

    async def record(self, **kwargs: Any) -> dict[str, Any]:
        self.recorded.append(kwargs)
        row = {
            "id": "quote-1",
            **kwargs,
        }
        self.rows[(kwargs["owner_eoa"].lower(), kwargs["deposit_address"])] = row
        return {"id": "quote-1", "createdAt": "2026-10-31T12:00:00Z"}

    async def get_owned(self, owner: str, deposit_address: str) -> dict[str, Any] | None:
        return self.rows.get((owner.lower(), deposit_address))

    async def update_status(self, deposit_address: str, status: str) -> None:
        self.status_updates.append((deposit_address, status))


class _AllowAll:
    def allow(self, key: Any) -> bool:
        return True


class _BlockAll:
    def allow(self, key: Any) -> bool:
        return False


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path.endswith("/quote"):
        body = json.loads(request.content)
        return httpx.Response(201, json=_quote_payload(dry=bool(body["dry"])))
    if path.endswith("/deposit/submit"):
        return httpx.Response(200, json={"ok": True})
    if path.endswith("/status"):
        return httpx.Response(200, json={"status": "SUCCESS", "swapDetails": {"amountOut": "0.06"}})
    return httpx.Response(404, json={"message": "not found"})


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(router)

    config = default_config()
    service = CrossChainService(config, OneClickClient(transport=httpx.MockTransport(_handler)))
    store = FakeStore()
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=OWNER, owner=OWNER, chain_id=8453
    )
    app.dependency_overrides[get_crosschain_config] = lambda: config
    app.dependency_overrides[get_crosschain_service] = lambda: service
    app.dependency_overrides[get_crosschain_store] = lambda: store
    app.dependency_overrides[get_crosschain_limiter] = lambda: _AllowAll()
    app.state.store = store
    return TestClient(app)


def test_assets_lists_enabled_and_disabled_routes(client: TestClient) -> None:
    response = client.get("/crosschain/assets")
    assert response.status_code == 200
    body = response.json()
    keys = {asset["key"]: asset for asset in body["assets"]}
    assert keys["base:USDC"]["enabled"] is True
    assert keys["tron:USDT"]["enabled"] is False
    assert "quoting" in keys["tron:USDT"]["unavailableReason"].lower()
    assert "ONECLICK" not in json.dumps(body).upper()


def test_quote_defaults_to_dry_and_does_not_persist(client: TestClient) -> None:
    response = client.post(
        "/crosschain/quote",
        json={"originKey": "base:USDC", "destinationKey": "btc:BTC", "amount": "5,000"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "preview"
    assert body["amountOut"] == "0.06439596"
    assert "depositAddress" not in body
    store: FakeStore = client.app.state.store
    assert store.recorded == []


def test_disabled_tron_is_a_200_unavailable_card(client: TestClient) -> None:
    response = client.post(
        "/crosschain/quote",
        json={
            "originKey": "eth:USDT",
            "destinationKey": "tron:USDT",
            "amount": "3000",
            "dry": False,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "unavailable"
    assert "Tron" in body["unavailableReason"]
    store: FakeStore = client.app.state.store
    assert store.recorded == []


def test_unknown_asset_is_a_400(client: TestClient) -> None:
    response = client.post(
        "/crosschain/quote",
        json={"originKey": "nope:NOPE", "destinationKey": "btc:BTC", "amount": "1"},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"


@pytest.mark.parametrize(
    "amount",
    [
        "0",
        "-1",
        "abc",
        "1.1234567",
        "NaN",
        "Infinity",
        "-Infinity",
        "1e999999999",
        "1e999999000",
        "1e31",
        "9" * 70,
        "1E+40",
    ],
)
def test_bad_amounts_are_rejected(client: TestClient, amount: str) -> None:
    started = time.perf_counter()
    response = client.post(
        "/crosschain/quote",
        json={"originKey": "base:USDC", "destinationKey": "btc:BTC", "amount": amount},
    )
    assert response.status_code == 400
    assert time.perf_counter() - started < 1.0


def test_live_quote_requires_a_valid_destination_address(client: TestClient) -> None:
    response = client.post(
        "/crosschain/quote",
        json={
            "originKey": "base:USDC",
            "destinationKey": "btc:BTC",
            "amount": "5000",
            "dry": False,
            "refundTo": "0x0000000000000000000000000000000000000001",
        },
    )
    assert response.status_code == 400
    assert "recipient" in response.json()["error"]["message"]


def test_live_quote_persists_and_returns_the_deposit_address(client: TestClient) -> None:
    response = client.post(
        "/crosschain/quote",
        json={
            "originKey": "base:USDC",
            "destinationKey": "btc:BTC",
            "amount": "5,000",
            "dry": False,
            "recipient": BTC_RECIPIENT,
            "refundTo": "0x0000000000000000000000000000000000000001",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "live"
    assert body["depositAddress"] == DEPOSIT
    assert body["quoteId"] == "quote-1"
    store: FakeStore = client.app.state.store
    assert len(store.recorded) == 1
    assert store.recorded[0]["owner_eoa"] == OWNER
    assert store.recorded[0]["quote_response"]["signature"] == "ed25519:test"


def test_submit_and_status_only_work_for_an_owned_deposit(client: TestClient) -> None:
    response = client.post(
        "/crosschain/deposit/submit",
        json={"depositAddress": DEPOSIT, "txHash": "0xabc12345"},
    )
    assert response.status_code == 404

    status = client.get("/crosschain/status", params={"depositAddress": DEPOSIT})
    assert status.status_code == 404

    store: FakeStore = client.app.state.store
    store.rows[(OWNER.lower(), DEPOSIT)] = {"id": "quote-1"}

    submitted = client.post(
        "/crosschain/deposit/submit",
        json={"depositAddress": DEPOSIT, "txHash": "0xabc12345"},
    )
    assert submitted.status_code == 200
    assert submitted.json()["ok"] is True

    live = client.get("/crosschain/status", params={"depositAddress": DEPOSIT})
    assert live.status_code == 200
    assert live.json()["status"] == "SUCCESS"
    assert store.status_updates == [(DEPOSIT, "SUCCESS")]


def test_rate_limit_is_enforced(client: TestClient) -> None:
    client.app.dependency_overrides[get_crosschain_limiter] = lambda: _BlockAll()
    response = client.post(
        "/crosschain/quote",
        json={"originKey": "base:USDC", "destinationKey": "btc:BTC", "amount": "1"},
    )
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
