# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""App lifespan + honest readyz (regression for the pool-not-connected 500).

Before this, the FastAPI app had NO startup hook, so the process-wide asyncpg pool was
never ``connect()``-ed and every DB-backed endpoint (mandate / recommendations / onboarding)
500'd with ``RuntimeError: Database pool is not connected``. These tests pin:

1. the lifespan connects the pool on startup and disconnects it on shutdown, and
2. /readyz reports ``postgres`` from a REAL healthcheck round-trip — ``true`` when the pool
   answers, ``false`` when it is unreachable/unconnected (no more env-presence masking).

They use a fake ``Database`` so no real Postgres is required (mirrors the fail-open,
never-trap-funds posture: a DB outage degrades intelligence, never custody — N2).
"""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api import main


class _FakeDB:
    """A stand-in ``Database`` recording connect/disconnect + a scriptable healthcheck."""

    def __init__(self, *, healthy: bool = True, connect_fails: bool = False) -> None:
        self.connected = False
        self.disconnected = False
        self._healthy = healthy
        self._connect_fails = connect_fails

    async def connect(self) -> None:
        if self._connect_fails:
            raise RuntimeError("simulated DB unreachable at boot")
        self.connected = True

    async def disconnect(self) -> None:
        self.disconnected = True

    async def healthcheck(self) -> bool:
        if not self.connected:
            # Mirrors Database._require_pool raising when the pool was never connected.
            raise RuntimeError("Database pool is not connected; call connect() first.")
        return self._healthy


def test_lifespan_connects_pool_and_readyz_reports_postgres_true(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = _FakeDB(healthy=True)
    monkeypatch.setattr(main, "get_database", lambda: fake)

    # Entering the context manager runs the lifespan startup (connect).
    with TestClient(main.app) as client:
        assert fake.connected is True, "lifespan must connect the pool on startup"
        body = client.get("/readyz").json()
        assert body["checks"]["postgres"] is True, "readyz must reflect a live DB round-trip"

    # Leaving the context runs shutdown (disconnect).
    assert fake.disconnected is True, "lifespan must close the pool on shutdown"


def test_readyz_postgres_false_when_db_unreachable(monkeypatch: pytest.MonkeyPatch) -> None:
    # Boot with a DB that fails to connect: the app must still start (fail-open for serving),
    # and readyz must honestly report postgres=false rather than masking with env-presence.
    fake = _FakeDB(connect_fails=True)
    monkeypatch.setattr(main, "get_database", lambda: fake)

    with TestClient(main.app) as client:
        body = client.get("/readyz").json()
        assert body["checks"]["postgres"] is False
        # The app is still up + serving (liveness unaffected by the DB outage).
        assert client.get("/healthz").json()["status"] == "ok"


class _HangingDB(_FakeDB):
    """A DB whose connect never resolves — models an unreachable host where asyncpg's
    create_pool blocks until its own (long) timeout. Startup must NOT wait on it."""

    async def connect(self) -> None:
        await asyncio.sleep(3600)  # would hang boot without the bounded wait_for


def test_startup_does_not_block_on_a_hanging_db_connect(monkeypatch: pytest.MonkeyPatch) -> None:
    # Regression for the exited:unhealthy deploy: a hanging connect must not stall startup past
    # the orchestrator's readiness deadline. With the connect bounded, the app comes up promptly
    # and reports postgres=false — never a killed container.
    monkeypatch.setattr(main, "_DB_CONNECT_TIMEOUT_S", 0.05)
    fake = _HangingDB()
    monkeypatch.setattr(main, "get_database", lambda: fake)

    with TestClient(main.app) as client:  # must enter promptly despite the 1h-hanging connect
        assert client.get("/healthz").json()["status"] == "ok"
        assert client.get("/readyz").json()["checks"]["postgres"] is False
