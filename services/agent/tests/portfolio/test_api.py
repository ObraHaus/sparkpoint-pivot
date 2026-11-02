# ruff: noqa: S101
"""072 — GET /portfolio/multichain is session-wallet only, rate-limited and read-only."""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from sparkpoint_agent.api.errors import ApiError, api_error_handler, validation_error_handler
from sparkpoint_agent.api.multichain_portfolio import (
    get_portfolio_limiter,
    get_portfolio_service,
    router,
)
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.vault import get_account
from sparkpoint_agent.portfolio.models import PortfolioOverview

from .helpers import row, section

OWNER = "0x2222222222222222222222222222222222222222"


def _overview() -> PortfolioOverview:
    return PortfolioOverview(
        wallet=OWNER,
        focus="all",
        as_of="2026-11-01T00:00:00+00:00",
        sections=(
            section("balances", rows=(row(),), source="rpc"),
            section("morpho", source="morpho_api"),
            section(
                "kamino",
                status="not_linked",
                reason="link a Solana address",
                source="solana_rpc",
            ),
            section("rhea", source="rhea_rpc"),
            section("swaps", source="db"),
        ),
    )


class _Service:
    def __init__(self, overview: PortfolioOverview) -> None:
        self.overview = overview
        self.calls: list[tuple[str, str]] = []

    async def read(self, wallet: str, *, focus: str = "all") -> PortfolioOverview:
        self.calls.append((wallet, focus))
        return self.overview


class _AllowAll:
    def allow(self, key: Any) -> bool:
        return True


class _Deny:
    def allow(self, key: Any) -> bool:
        return False


@pytest.fixture
def service() -> _Service:
    return _Service(_overview())


@pytest.fixture
def client(service: _Service) -> Iterator[TestClient]:
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.include_router(router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=OWNER, owner=OWNER, chain_id=8453
    )
    app.dependency_overrides[get_portfolio_service] = lambda: service
    app.dependency_overrides[get_portfolio_limiter] = lambda: _AllowAll()
    yield TestClient(app)


def test_reads_the_session_wallet_and_returns_the_block(
    client: TestClient, service: _Service
) -> None:
    response = client.get("/portfolio/multichain")
    assert response.status_code == 200
    body = response.json()
    assert body["type"] == "portfolio_overview"
    assert body["state"] == "ready"
    assert body["wallet"] == OWNER
    assert body["focus"] == "all"
    assert len(body["sections"]) == 5
    assert body["totals"]["totalUsd"] == "100.00"
    assert body["text"]
    assert service.calls == [(OWNER, "all")]


def test_a_wallet_query_parameter_is_rejected_and_never_read(
    client: TestClient, service: _Service
) -> None:
    response = client.get(f"/portfolio/multichain?wallet={OWNER}")
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "VALIDATION_ERROR"
    assert service.calls == []


def test_an_address_query_parameter_is_rejected(client: TestClient, service: _Service) -> None:
    response = client.get(f"/portfolio/multichain?address={OWNER}")
    assert response.status_code == 400
    assert service.calls == []


def test_rate_limit_returns_429(service: _Service) -> None:
    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)
    app.include_router(router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=OWNER, owner=OWNER, chain_id=8453
    )
    app.dependency_overrides[get_portfolio_service] = lambda: service
    app.dependency_overrides[get_portfolio_limiter] = lambda: _Deny()
    response = TestClient(app).get("/portfolio/multichain")
    assert response.status_code == 429
    assert response.json()["error"]["code"] == "RATE_LIMITED"
    assert service.calls == []
