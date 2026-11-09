# ruff: noqa: S101
"""079 — cross-chain Rhea Phase C: flags, gate, unsigned transfer plan, withdraw review."""

from __future__ import annotations

import json
from decimal import Decimal
from typing import Any

import httpx
import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from sparkpoint_agent.api.earn import (
    get_earn_limiter,
    get_earn_service,
    get_rhea_wallet,
    router,
)
from sparkpoint_agent.api.errors import (
    ApiError,
    api_error_handler,
    validation_error_handler,
)
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.vault import get_account
from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.rails import ReceiptLivenessCache
from sparkpoint_agent.earn.registry import EarnRegistry
from sparkpoint_agent.earn.rhea_xchain import (
    ERC20_TRANSFER_SELECTOR,
    RheaXchainDisabled,
    RheaXchainError,
    build_origin_transfer_plan,
    erc20_transfer_calldata,
    gate_wire,
    live_gate,
    oneclick_key_present,
    origin_token_address,
    withdraw_review,
    xchain_live_enabled,
)
from sparkpoint_agent.earn.service import EarnService

from .helpers import RHEA_TOKEN_ID, make_rhea_vault, make_snapshot

WALLET = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
WALLET_NO_0X = "d8dA6BF26964aF9D7eEd9e03E53415D37aA96045"
MCA = "abc.multica.near"
DEPOSIT = "0x" + "ab" * 20
USDC_DETAIL = {
    "supplied": {"balance": "12733763455236751230092183"},
    "config": {"extra_decimals": 12},
    "supply_apr": "0.140459036159116681312316847",
}


def _payload(*, out: str = "99.9808", deposit: str | None = None) -> dict[str, Any]:
    quote: dict[str, Any] = {
        "amountIn": "100000000",
        "amountInFormatted": "100",
        "amountInUsd": "100.0",
        "amountOut": str(int(Decimal(out) * 10**6)),
        "amountOutFormatted": out,
        "amountOutUsd": out,
        "minAmountOut": "98980992",
        "timeEstimate": 35,
    }
    if deposit is not None:
        quote["depositAddress"] = deposit
    return {
        "quote": quote,
        "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


class FakeViews:
    def __init__(self, *, mca: str | None = None) -> None:
        self.mca = mca

    async def mca_for_wallet(self, wallet: str) -> str | None:
        return self.mca

    async def create_mca_fee(self) -> dict[str, str]:
        return {RHEA_TOKEN_ID: "300000"}

    async def asset(self, token_id: str) -> dict[str, Any] | None:
        return USDC_DETAIL

    async def positions(self, account_id: str) -> dict[str, Any] | None:
        return None


def _service(
    views: FakeViews,
    *,
    api_key: str | None = None,
    handler: Any = None,
) -> tuple[EarnService, list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []

    def wrapped(request: httpx.Request) -> httpx.Response:
        if request.content:
            calls.append(json.loads(request.content))
        if handler is not None:
            return handler(request)
        return httpx.Response(201, json=_payload())

    config = default_config()
    registry = EarnRegistry(config, writable_path="/nonexistent/earn.json")
    registry.install(make_snapshot(make_rhea_vault()))
    service = EarnService(
        config,
        registry,
        oneclick=OneClickClient(
            api_key=api_key, transport=httpx.MockTransport(wrapped), clock=lambda: 1000.0
        ),
        liveness=ReceiptLivenessCache(clock=lambda: 1000.0),
        rhea_views=views,  # type: ignore[arg-type]
    )
    return service, calls


# ── flags / gate ──────────────────────────────────────────────────────────────


def test_xchain_flag_defaults_off_and_only_exact_on_values_enable() -> None:
    assert xchain_live_enabled({}) is False
    assert xchain_live_enabled({"EARN_LIVE_RHEA_XCHAIN": ""}) is False
    assert xchain_live_enabled({"EARN_LIVE_RHEA_XCHAIN": "false"}) is False
    assert xchain_live_enabled({"EARN_LIVE_RHEA_XCHAIN": "1"}) is False
    assert xchain_live_enabled({"EARN_LIVE_RHEA_XCHAIN": "true"}) is True
    assert xchain_live_enabled({"EARN_LIVE_RHEA_XCHAIN": " TRUE "}) is True


def test_key_presence_is_a_boolean_only() -> None:
    assert oneclick_key_present({}) is False
    assert oneclick_key_present({"ONECLICK_API_KEY": "   "}) is False
    assert oneclick_key_present({"ONECLICK_API_KEY": "test-presence-only"}) is True


def test_live_gate_requires_both_flag_and_key() -> None:
    assert live_gate(server_enabled=False, key_present=True)[0] is False
    assert live_gate(server_enabled=True, key_present=False)[0] is False
    allowed, reason = live_gate(server_enabled=True, key_present=True)
    assert allowed is True and reason is None


def test_gate_wire_never_includes_a_key_value() -> None:
    sentinel = "not-a-real-key-presence-sentinel"
    wire = gate_wire(server_enabled=True, key_present=True)
    assert "not-a-real-key" not in json.dumps(wire)
    assert wire["keyPresent"] is True
    assert wire["flagEnv"] == "EARN_LIVE_RHEA_XCHAIN"
    assert wire["keyEnv"] == "ONECLICK_API_KEY"
    assert sentinel not in json.dumps(wire)


# ── unsigned origin transfer plan ─────────────────────────────────────────────


def test_origin_token_comes_from_the_1click_asset_id() -> None:
    service, _ = _service(FakeViews())
    asset = service.crosschain.asset("base:USDC")
    assert asset is not None
    assert origin_token_address(asset) == "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"


def test_erc20_transfer_calldata_is_the_public_selector_plus_two_words() -> None:
    calldata = erc20_transfer_calldata(
        token_address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",  # noqa: S106 - public token
        recipient=DEPOSIT,
        amount_raw=100_000_000,
    )
    assert calldata.startswith("0x" + ERC20_TRANSFER_SELECTOR)
    assert len(calldata) == 2 + 8 + 64 + 64


def test_build_plan_is_unsigned_and_never_carries_a_signature() -> None:
    service, _ = _service(FakeViews())
    asset = service.crosschain.asset("base:USDC")
    assert asset is not None
    plan = build_origin_transfer_plan(
        asset=asset,
        wallet=WALLET,
        deposit_address=DEPOSIT,
        amount_human="100",
        amount_raw=100_000_000,
    )
    assert plan["kind"] == "erc20_transfer"
    assert plan["unsigned"] is True
    assert plan["chainId"] == 8453
    assert plan["functionSignature"] == "transfer(address,uint256)"
    assert plan["tokenAddress"] == "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
    assert "signature" not in plan and "signed" not in plan
    # The encoded recipient word is the deposit address, lowercased and left-padded.
    assert DEPOSIT[2:] in plan["calldata"]


def test_non_evm_origin_is_an_honest_unsupported_plan() -> None:
    service, _ = _service(FakeViews())
    asset = service.crosschain.asset("sol:USDC")
    assert asset is not None
    plan = build_origin_transfer_plan(
        asset=asset,
        wallet=WALLET,
        deposit_address="solana-deposit",
        amount_human="100",
        amount_raw=100_000_000,
    )
    assert plan["kind"] == "unsupported"
    assert plan["calldata"] is None


# ── withdraw review ───────────────────────────────────────────────────────────


def test_withdraw_review_is_honest_about_nep413_and_custody() -> None:
    review = withdraw_review()
    assert review["nep413IsTransaction"] is False
    assert review["custodian"] is None
    ids = {path["id"] for path in review["paths"]}
    assert ids == {"rhea_app", "rhea_relayer", "near_mca_withdraw_tx"}
    assert all("signature" not in path for path in review["paths"])
    assert any("rhea-sdk-docs" in source["url"] for source in review["sources"])


# ── service gate + live commit ────────────────────────────────────────────────


async def test_dry_review_still_works_with_flags_off(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EARN_LIVE_RHEA_XCHAIN", raising=False)
    service, calls = _service(FakeViews(mca=MCA))
    outcome = await service.rhea_xchain_quote(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
        dry=True,
    )
    wire = outcome.block.to_wire()
    assert wire["rail"] == "oneclick_rhea"
    assert "live" not in wire
    assert "transferPlan" not in wire
    assert calls[0]["dry"] is True


async def test_live_commit_is_refused_when_the_flag_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EARN_LIVE_RHEA_XCHAIN", raising=False)
    service, calls = _service(FakeViews(mca=MCA), api_key="presence-only")
    with pytest.raises(RheaXchainDisabled):
        await service.rhea_xchain_quote(
            chain="near",
            address=RHEA_TOKEN_ID,
            origin_key="base:USDC",
            amount=Decimal("100"),
            amount_raw=100_000_000,
            wallet=WALLET,
            dry=False,
        )
    assert calls == []


async def test_live_commit_is_refused_when_the_key_is_absent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EARN_LIVE_RHEA_XCHAIN", "true")
    service, calls = _service(FakeViews(mca=MCA))
    with pytest.raises(RheaXchainDisabled):
        await service.rhea_xchain_quote(
            chain="near",
            address=RHEA_TOKEN_ID,
            origin_key="base:USDC",
            amount=Decimal("100"),
            amount_raw=100_000_000,
            wallet=WALLET,
            dry=False,
        )
    assert calls == []


async def test_live_existing_mca_returns_a_quote_and_unsigned_plan(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EARN_LIVE_RHEA_XCHAIN", "true")
    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"status": "SUCCESS"})
        return httpx.Response(201, json=_payload(deposit=DEPOSIT))

    service, calls = _service(
        FakeViews(mca=MCA), api_key="presence-only", handler=handler
    )
    outcome = await service.rhea_xchain_quote(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
        dry=False,
    )
    wire = outcome.block.to_wire()
    assert calls[0]["dry"] is False
    assert wire["live"] is True
    assert wire["depositAddress"] == DEPOSIT
    assert wire["transferPlan"]["unsigned"] is True
    assert wire["transferPlan"]["to"] == DEPOSIT
    assert "signature" not in wire["transferPlan"]
    status = await service.rhea_xchain_status(wallet=WALLET, deposit_address=DEPOSIT)
    assert status["status"] == "SUCCESS"


async def test_live_first_deposit_without_a_signature_does_not_quote(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EARN_LIVE_RHEA_XCHAIN", "true")
    service, calls = _service(FakeViews(mca=None), api_key="presence-only")
    outcome = await service.rhea_xchain_quote(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
        dry=False,
    )
    wire = outcome.block.to_wire()
    assert calls == []
    assert wire["requiresSignature"] is True
    assert wire["messageToSign"] == f'[{{"EVM":"{WALLET_NO_0X}"}}]'
    assert "live" not in wire


async def test_live_first_deposit_with_signature_quotes_and_plans(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EARN_LIVE_RHEA_XCHAIN", "true")
    service, calls = _service(
        FakeViews(mca=None),
        api_key="presence-only",
        handler=lambda request: httpx.Response(201, json=_payload(deposit=DEPOSIT)),
    )
    signature = "0x" + "cd" * 65
    outcome = await service.rhea_xchain_quote(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
        dry=False,
        signature=signature,
    )
    wire = outcome.block.to_wire()
    assert calls[0]["dry"] is False
    assert "BurrowRegisterAndSupply" in wire["customRecipientMsg"]
    assert "cd" * 65 in wire["customRecipientMsg"]
    assert wire["transferPlan"]["kind"] == "erc20_transfer"


async def test_status_is_scoped_to_the_wallet_that_prepared_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EARN_LIVE_RHEA_XCHAIN", "true")
    service, _ = _service(
        FakeViews(mca=MCA),
        api_key="presence-only",
        handler=lambda request: httpx.Response(201, json=_payload(deposit=DEPOSIT)),
    )
    await service.rhea_xchain_quote(
        chain="near",
        address=RHEA_TOKEN_ID,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        wallet=WALLET,
        dry=False,
    )
    with pytest.raises(RheaXchainError):
        await service.rhea_xchain_status(
            wallet="0x" + "9" * 40, deposit_address=DEPOSIT
        )


# ── HTTP surface ──────────────────────────────────────────────────────────────


class _AllowAll:
    def allow(self, key: Any) -> bool:
        return True


def _client(service: EarnService) -> TestClient:
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=WALLET, owner=WALLET, chain_id=8453
    )
    app.dependency_overrides[get_earn_service] = lambda: service
    app.dependency_overrides[get_earn_limiter] = lambda: _AllowAll()
    app.dependency_overrides[get_rhea_wallet] = lambda: WALLET
    return TestClient(app)


def test_api_gate_is_key_free(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EARN_LIVE_RHEA_XCHAIN", raising=False)
    service, _ = _service(FakeViews(mca=MCA))
    client = _client(service)
    response = client.get("/earn/rhea/xchain")
    assert response.status_code == 200
    body = response.json()
    assert body["serverEnabled"] is False
    assert body["liveAllowed"] is False
    assert body["keyEnv"] == "ONECLICK_API_KEY"
    assert "test-presence-only" not in json.dumps(body)


def test_api_live_commit_is_403_when_the_flag_is_off(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("EARN_LIVE_RHEA_XCHAIN", raising=False)
    service, _ = _service(FakeViews(mca=MCA), api_key="presence-only")
    client = _client(service)
    response = client.post(
        "/earn/rhea/xchain/quote",
        json={
            "chain": "near",
            "vaultAddress": RHEA_TOKEN_ID,
            "originKey": "base:USDC",
            "amount": "100",
            "dry": False,
        },
    )
    assert response.status_code == 403


def test_api_first_live_deposit_asks_for_a_signature(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("EARN_LIVE_RHEA_XCHAIN", "true")
    service, calls = _service(FakeViews(mca=None), api_key="presence-only")
    client = _client(service)
    response = client.post(
        "/earn/rhea/xchain/quote",
        json={
            "chain": "near",
            "vaultAddress": RHEA_TOKEN_ID,
            "originKey": "base:USDC",
            "amount": "100",
            "dry": False,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["requiresSignature"] is True
    assert body["messageToSign"]
    assert calls == []


def test_api_withdraw_review_is_not_a_transaction() -> None:
    service, _ = _service(FakeViews(mca=MCA))
    client = _client(service)
    response = client.get("/earn/rhea/xchain/withdraw")
    assert response.status_code == 200
    body = response.json()
    assert body["nep413IsTransaction"] is False
    assert body["custodian"] is None
