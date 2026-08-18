# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""047 — the bot routes, exercised THROUGH the app.

⚠️ This file exists because of a bug that shipped. `report_run` originally depended on
`security.authenticate`, which is a plain helper taking a bare `authorization: str | None` — with
no `Header(...)` annotation, FastAPI resolved it as a **query parameter**, so every report failed
`query.authorization: Field required` with a 400 that read like a malformed body.

The unit tests could not catch it: they covered the store and the health rule, and both were
correct. Nothing exercised the wiring between the router and the app, which is exactly where the
defect was. A route's dependency graph is only real once a request goes through it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.testclient import TestClient

from sparkpoint_agent.api.admin_bots import router
from sparkpoint_agent.api.allowlist import get_allowlist_store
from sparkpoint_agent.api.errors import (
    ApiError,
    api_error_handler,
    validation_error_handler,
)
from sparkpoint_agent.api.mandate import get_account
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.db.bot_runs import BotRun

_OWNER = "0xA71e24359A6cb7A939aae2d62dD12b6256365c30"


class FakeStore:
    def __init__(self) -> None:
        self.runs: dict[str, BotRun] = {}

    async def record(self, run: BotRun) -> bool:
        if run.run_key in self.runs:
            return False
        self.runs[run.run_key] = run
        return True

    async def latest_per_stream(self) -> list[BotRun]:
        return list(self.runs.values())

    async def recent(self, limit: int = 20) -> list[BotRun]:
        return list(self.runs.values())[:limit]


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> tuple[TestClient, FakeStore]:
    store = FakeStore()
    monkeypatch.setattr(
        "sparkpoint_agent.api.admin_bots.PgBotRunStore", lambda _db: store
    )
    monkeypatch.setattr("sparkpoint_agent.api.admin_bots.get_database", lambda: None)

    app = FastAPI()
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]
    app.add_exception_handler(RequestValidationError, validation_error_handler)  # type: ignore[arg-type]
    app.include_router(router)
    # Both routes are authenticated by the middleware in production; here we stand in for the
    # identity it attaches, so the test is about the ROUTE's own wiring.
    app.dependency_overrides[get_account] = lambda: AccountContext(
        account=_OWNER, owner=_OWNER, chain_id=84532
    )

    # ⚠️ `require_admin` stays in the graph — only its STORE is faked. Overriding the gate itself
    # would remove the very dependency chain this file exists to exercise, which is how the
    # original defect survived a green suite.
    class FakeAllowlist:
        async def is_admin(self, address: str) -> bool:
            return address.lower() == _OWNER.lower()

    app.dependency_overrides[get_allowlist_store] = lambda: FakeAllowlist()
    return TestClient(app), store


def _body(**over: Any) -> dict[str, Any]:
    now = datetime.now(UTC)
    body = {
        "runKey": "test-run-00000001",
        "networkId": "robinhood",
        "command": "swap",
        "startedAt": (now - timedelta(minutes=2)).isoformat(),
        "finishedAt": now.isoformat(),
        "ok": True,
        "attempted": 4,
        "succeeded": 4,
        "schedule": "hourly",
        "nextRunAt": (now + timedelta(hours=1)).isoformat(),
        "runnerCommit": "abc1234",
        "detail": {},
    }
    body.update(over)
    return body


def test_a_report_with_only_a_body_is_accepted(client: tuple[TestClient, FakeStore]) -> None:
    """⚠️ THE REGRESSION TEST. The runner posts a JSON body and headers — no query string.

    With `Depends(authenticate)` this returned 400 `query.authorization: Field required`, because
    FastAPI treated the helper's bare `authorization` parameter as a query param.
    """
    c, store = client
    resp = c.post("/admin/bots/runs", json=_body())
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "created": True}
    assert len(store.runs) == 1


def test_a_repeated_report_is_idempotent(client: tuple[TestClient, FakeStore]) -> None:
    c, store = client
    assert c.post("/admin/bots/runs", json=_body()).json()["created"] is True
    assert c.post("/admin/bots/runs", json=_body()).json()["created"] is False
    assert len(store.runs) == 1


def test_claiming_more_successes_than_attempts_is_refused(
    client: tuple[TestClient, FakeStore]
) -> None:
    """The one direction of nonsense that matters: it would paint a failing fleet as healthy."""
    c, store = client
    resp = c.post("/admin/bots/runs", json=_body(attempted=1, succeeded=9))
    assert resp.status_code == 400
    assert not store.runs


def test_status_lists_expected_streams_as_never_run_before_anything_reports(
    client: tuple[TestClient, FakeStore]
) -> None:
    """A fleet that was never started must not render like a healthy idle one."""
    c, _ = client
    resp = c.get("/admin/bots/status")
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["configured"] is False
    assert {(s["networkId"], s["command"]) for s in data["streams"]} >= {
        ("base", "accrue"),
        ("base", "vault"),
        ("robinhood", "swap"),
    }
    assert all(s["state"] == "never-run" for s in data["streams"])


def test_a_reported_stream_becomes_healthy_and_configured_flips(
    client: tuple[TestClient, FakeStore]
) -> None:
    c, _ = client
    c.post("/admin/bots/runs", json=_body())
    data = c.get("/admin/bots/status").json()
    assert data["configured"] is True
    swap = next(s for s in data["streams"] if s["command"] == "swap")
    assert swap["state"] == "healthy"
    assert swap["succeeded"] == 4
    assert swap["schedule"] == "hourly"
    assert len(data["recent"]) == 1


def test_a_run_that_landed_nothing_reports_failing(
    client: tuple[TestClient, FakeStore]
) -> None:
    """Attempted ten, landed none — completes cleanly, and must NOT read as healthy."""
    c, _ = client
    c.post("/admin/bots/runs", json=_body(attempted=10, succeeded=0))
    data = c.get("/admin/bots/status").json()
    swap = next(s for s in data["streams"] if s["command"] == "swap")
    assert swap["state"] == "failing"
