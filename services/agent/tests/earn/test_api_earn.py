# ruff: noqa: S101
"""069 — the earn router through a real FastAPI app (auth override, validation, dry-only)."""

from __future__ import annotations

import json
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from sparkpoint_agent.api.earn import (
    get_earn_limiter,
    get_earn_service,
    router,
)
from sparkpoint_agent.api.errors import ApiError, api_error_handler, validation_error_handler
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.vault import get_account
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.rails import LIVE, ReceiptLivenessCache
from sparkpoint_agent.earn.registry import EarnRegistry
from sparkpoint_agent.earn.service import EarnService

from .helpers import make_snapshot, make_vault

OWNER = "0x2222222222222222222222222222222222222222"
VAULT = make_vault()
OTHER = make_vault(address="0x" + "2" * 40, name="Other USDC", tvl=None)


def _payload() -> dict[str, Any]:
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


class _AllowAll:
    def allow(self, key: Any) -> bool:
        return True


def _handler(request: httpx.Request) -> httpx.Response:
    if request.url.path.endswith("/quote"):
        body = json.loads(request.content)
        assert body["dry"] is True
        return httpx.Response(201, json=_payload())
    return httpx.Response(404, json={"message": "not found"})


@pytest.fixture
def client() -> TestClient:
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(router)

    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(VAULT, OTHER))
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    receipt = config.receipt_for_vault(VAULT.address)
    assert receipt is not None
    liveness.set(receipt.asset_id, LIVE)
    service = EarnService(
        config,
        registry,
        oneclick=OneClickClient(transport=httpx.MockTransport(_handler), clock=lambda: 1000.0),
        liveness=liveness,
    )
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=OWNER, owner=OWNER, chain_id=8453
    )
    app.dependency_overrides[get_earn_service] = lambda: service
    app.dependency_overrides[get_earn_limiter] = lambda: _AllowAll()
    app.state.service = service
    return TestClient(app)


def test_list_returns_rails_and_snapshot_age(client: TestClient) -> None:
    response = client.get("/earn/vaults?chain=base&asset=USDC&sort=tvl&limit=10")
    assert response.status_code == 200
    body = response.json()
    assert body["featureEnabled"] is True
    assert body["snapshot"]["state"] == "ready"
    assert body["count"] == 2
    assert body["vaults"][0]["rails"]["available"]


def test_list_rejects_unknown_chain_and_rail(client: TestClient) -> None:
    assert client.get("/earn/vaults?chain=nope").status_code == 400
    assert client.get("/earn/vaults?rail=nope").status_code == 400


def test_single_vault_and_404(client: TestClient) -> None:
    ok = client.get(f"/earn/vaults/base/{VAULT.address}")
    assert ok.status_code == 200
    assert ok.json()["vault"]["address"] == VAULT.address
    missing = client.get("/earn/vaults/base/0x" + "9" * 40)
    assert missing.status_code == 404


def test_preview_defaults_to_dry_and_maps_the_receipt_quote(client: TestClient) -> None:
    response = client.post(
        "/earn/preview",
        json={
            "chain": "base",
            "vaultAddress": VAULT.address,
            "originKey": "eth:USDC",
            "amount": "100",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "earn_quote"
    assert body["state"] == "preview"
    assert body["rail"] == "oneclick_earn"
    assert body["amountOut"] == "89.146629"
    assert "0.25%" in body["feeNote"]


def test_preview_same_chain_is_direct(client: TestClient) -> None:
    response = client.post(
        "/earn/preview",
        json={
            "chain": "base",
            "vaultAddress": VAULT.address,
            "originKey": "base:USDC",
            "amount": "100",
        },
    )
    assert response.status_code == 200
    assert response.json()["rail"] == "direct"


def test_preview_rejects_dry_false(client: TestClient) -> None:
    response = client.post(
        "/earn/preview",
        json={
            "chain": "base",
            "vaultAddress": VAULT.address,
            "originKey": "eth:USDC",
            "amount": "100",
            "dry": False,
        },
    )
    assert response.status_code == 400
    assert "dry" in response.json()["error"]["message"].lower()


@pytest.mark.parametrize("amount", ["0", "-1", "abc", "1.1234567"])
def test_preview_rejects_bad_amounts(client: TestClient, amount: str) -> None:
    response = client.post(
        "/earn/preview",
        json={
            "chain": "base",
            "vaultAddress": VAULT.address,
            "originKey": "eth:USDC",
            "amount": amount,
        },
    )
    assert response.status_code == 400


def test_preview_unknown_origin_and_vault(client: TestClient) -> None:
    bad_origin = client.post(
        "/earn/preview",
        json={
            "chain": "base",
            "vaultAddress": VAULT.address,
            "originKey": "nope:NOPE",
            "amount": "100",
        },
    )
    assert bad_origin.status_code == 400
    bad_vault = client.post(
        "/earn/preview",
        json={
            "chain": "base",
            "vaultAddress": "0x" + "9" * 40,
            "originKey": "eth:USDC",
            "amount": "100",
        },
    )
    assert bad_vault.status_code == 404


@pytest.fixture
def kamino_client() -> TestClient:
    from .helpers import KV_VAULT, make_kamino_vault

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(router)

    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(make_kamino_vault(), VAULT))
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    receipt = config.receipt_for_vault(KV_VAULT)
    assert receipt is not None
    liveness.set(receipt.asset_id, LIVE)
    service = EarnService(
        config,
        registry,
        oneclick=OneClickClient(transport=httpx.MockTransport(_handler), clock=lambda: 1000.0),
        liveness=liveness,
    )
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=OWNER, owner=OWNER, chain_id=8453
    )
    app.dependency_overrides[get_earn_service] = lambda: service
    app.dependency_overrides[get_earn_limiter] = lambda: _AllowAll()
    return TestClient(app)


def test_list_filters_by_sol_chain_and_kamino_protocol(kamino_client: TestClient) -> None:
    from .helpers import KV_VAULT

    response = kamino_client.get("/earn/vaults?chain=sol&protocol=kamino")
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["vaults"][0]["address"] == KV_VAULT
    assert body["vaults"][0]["protocol"] == "kamino"
    assert kamino_client.get("/earn/vaults?protocol=bogus").status_code == 400


def test_sol_vault_lookup_is_case_sensitive(kamino_client: TestClient) -> None:
    from .helpers import KV_VAULT

    assert kamino_client.get(f"/earn/vaults/sol/{KV_VAULT}").status_code == 200
    assert kamino_client.get(f"/earn/vaults/sol/{KV_VAULT.lower()}").status_code == 404


def test_kamino_preview_validates_the_solana_recipient(kamino_client: TestClient) -> None:
    from .helpers import KV_VAULT

    ok = kamino_client.post(
        "/earn/preview",
        json={
            "chain": "sol",
            "vaultAddress": KV_VAULT,
            "originKey": "base:USDC",
            "amount": "100",
            "recipient": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        },
    )
    assert ok.status_code == 200
    body = ok.json()
    assert body["receiptKind"] == "native_shares"
    assert body["walletSupport"]["recipient"] == "paste_solana_address"

    bad = kamino_client.post(
        "/earn/preview",
        json={
            "chain": "sol",
            "vaultAddress": KV_VAULT,
            "originKey": "base:USDC",
            "amount": "100",
            "recipient": "0x2222222222222222222222222222222222222222",
        },
    )
    assert bad.status_code == 400
    assert "base58 Solana" in bad.json()["error"]["message"]


def test_kamino_preview_without_recipient_uses_the_dry_probe(kamino_client: TestClient) -> None:
    from .helpers import KV_VAULT

    response = kamino_client.post(
        "/earn/preview",
        json={
            "chain": "sol",
            "vaultAddress": KV_VAULT,
            "originKey": "base:USDC",
            "amount": "100",
        },
    )
    assert response.status_code == 200
    assert response.json()["state"] == "preview"
