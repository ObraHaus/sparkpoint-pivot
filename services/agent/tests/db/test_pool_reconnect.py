# ruff: noqa: S101 -- pytest assertions are the point of a test
"""D5 — the Database pool must SELF-HEAL after a Postgres restart.

Before the fix, ``Database`` built its asyncpg pool once and never re-established it,
so a Postgres restart *after* boot wedged the agent forever (``/readyz`` postgres:false,
every DB route 500ing) until the container was restarted by hand. These tests pin the
re-establish path with a fake pool — no real Postgres needed.
"""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import asyncpg
import pytest

from sparkpoint_agent.db.pool import Database

_CFG = SimpleNamespace(dsn="postgresql://test", min_size=1, max_size=2, command_timeout=5.0)


class _FakePool:
    """A stand-in asyncpg pool. ``healthy=False`` raises a connection error on every query,
    exactly as a pool whose Postgres has gone away does."""

    def __init__(self, *, healthy: bool) -> None:
        self._healthy = healthy
        self.terminated = False
        self.fetchval_calls = 0

    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any:
        self.fetchval_calls += 1
        if not self._healthy:
            raise asyncpg.InterfaceError("connection is closed")
        return 1

    def terminate(self) -> None:
        self.terminated = True

    async def close(self) -> None:  # pragma: no cover - the reset path uses terminate()
        pass


def _install(monkeypatch: pytest.MonkeyPatch, pools: list[_FakePool]) -> list[_FakePool]:
    """Make ``asyncpg.create_pool`` hand out ``pools`` in order, and record what it built."""
    created: list[_FakePool] = []

    async def fake_create_pool(**_kwargs: Any) -> _FakePool:
        pool = pools[len(created)]
        created.append(pool)
        return pool

    monkeypatch.setattr(asyncpg, "create_pool", fake_create_pool)
    return created


async def test_query_rebuilds_pool_and_retries_after_connection_drop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dead = _FakePool(healthy=False)  # the pool whose Postgres restarted
    fresh = _FakePool(healthy=True)  # the pool rebuilt after the reset
    created = _install(monkeypatch, [dead, fresh])

    db = Database(config=_CFG)  # type: ignore[arg-type]
    await db.connect()
    value = await db.fetchval("SELECT 1")

    assert value == 1  # the retry succeeded transparently
    assert dead.terminated is True  # the broken pool was force-closed
    assert len(created) == 2  # a fresh pool was built
    assert fresh.fetchval_calls == 1  # the retry ran on the fresh pool, exactly once


async def test_healthcheck_is_false_while_down_then_true_on_recovery(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    dead = _FakePool(healthy=False)
    still_dead = _FakePool(healthy=False)  # Postgres is still down after the first reset
    fresh = _FakePool(healthy=True)  # Postgres is back for the second probe
    _install(monkeypatch, [dead, still_dead, fresh])

    db = Database(config=_CFG)  # type: ignore[arg-type]
    await db.connect()

    # DB down: probe -> dead raises -> reset -> rebuild(still_dead) -> retry raises -> honest False
    assert await db.healthcheck() is False
    # DB back: probe -> still_dead raises -> reset -> rebuild(fresh) -> retry ok -> reconnected True
    assert await db.healthcheck() is True


async def test_a_real_query_error_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-connection error (bad SQL, constraint) must propagate unchanged — never a rebuild."""

    class _SyntaxPool(_FakePool):
        async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any:
            self.fetchval_calls += 1
            raise asyncpg.PostgresSyntaxError("syntax error")

    pool = _SyntaxPool(healthy=True)
    _install(monkeypatch, [pool])

    db = Database(config=_CFG)  # type: ignore[arg-type]
    await db.connect()
    with pytest.raises(asyncpg.PostgresSyntaxError):
        await db.fetchval("SELCT 1")

    assert pool.terminated is False  # the pool was NOT reset
    assert pool.fetchval_calls == 1  # the query was NOT retried
