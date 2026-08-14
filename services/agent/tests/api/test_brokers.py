# ruff: noqa: S101
"""Tests for `/brokers/owned` (feature 044).

The one behaviour worth most of this file: **an unreadable chain must not render as "you own
nothing"**. That is the difference between a holder seeing a temporary error and a holder seeing
their collection disappear.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sparkpoint_agent.api import brokers as brokers_api
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.vault import get_account

WALLET = "0xAaAaAaAa00000000000000000000000000000001"


class FakeLedger:
    def __init__(self, result: list[int] | None, raises: bool = False) -> None:
        self.result = result
        self.raises = raises
        self.asked: list[str] = []

    async def tokens_owned_by(self, wallet: str) -> list[int] | None:
        self.asked.append(wallet)
        if self.raises:
            raise RuntimeError("rpc exploded")
        return self.result


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Any:
    app = FastAPI()
    app.include_router(brokers_api.router)
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=WALLET, owner=WALLET, chain_id=46630
    )
    return TestClient(app)


def _use(monkeypatch: pytest.MonkeyPatch, ledger: Any) -> None:
    monkeypatch.setattr(brokers_api, "get_ledger", lambda: ledger)


def test_returns_the_wallets_token_ids(monkeypatch: pytest.MonkeyPatch, client: Any) -> None:
    ledger = FakeLedger([2, 9])
    _use(monkeypatch, ledger)
    body = client.get("/brokers/owned").json()
    assert body == {"available": True, "tokenIds": [2, 9]}
    # Scoped to the SESSION wallet, so this cannot be used to look up arbitrary addresses.
    assert ledger.asked == [WALLET]


def test_a_wallet_that_genuinely_owns_nothing_gets_an_empty_list(
    monkeypatch: pytest.MonkeyPatch, client: Any
) -> None:
    _use(monkeypatch, FakeLedger([]))
    assert client.get("/brokers/owned").json() == {"available": True, "tokenIds": []}


def test_an_UNREADABLE_chain_is_never_reported_as_owning_nothing(
    monkeypatch: pytest.MonkeyPatch, client: Any
) -> None:
    """The failure this endpoint exists to avoid.

    `available: false` and `available: true, tokenIds: []` are both "no brokers shown", but only one
    of them tells the holder their collection is gone.
    """
    _use(monkeypatch, FakeLedger(None))
    body = client.get("/brokers/owned").json()
    assert body["available"] is False
    assert body["reason"] == "chain-unreadable"
    assert body["tokenIds"] == []


def test_an_unconfigured_ledger_says_so_rather_than_pretending(
    monkeypatch: pytest.MonkeyPatch, client: Any
) -> None:
    _use(monkeypatch, None)
    body = client.get("/brokers/owned").json()
    assert body["available"] is False
    assert body["reason"] == "unconfigured"


def test_a_raising_ledger_degrades_instead_of_500ing(
    monkeypatch: pytest.MonkeyPatch, client: Any
) -> None:
    """The ledger promises not to raise; this route does not rely on that promise.

    A gallery that 500s on a transient RPC blip is worse than one that says "unavailable".
    """
    _use(monkeypatch, FakeLedger(None, raises=True))
    res = client.get("/brokers/owned")
    assert res.status_code == 200
    assert res.json()["available"] is False


def test_the_route_writes_nothing(monkeypatch: pytest.MonkeyPatch, client: Any) -> None:
    """044 adds no migration and no write path. Enforced, not claimed."""
    import inspect

    source = inspect.getsource(brokers_api)
    for forbidden in ("INSERT", "UPDATE", "DELETE", "execute(", "commit("):
        assert forbidden not in source, f"{forbidden} must not appear in a read-only route"
