# ruff: noqa: S101  (pytest asserts)
"""023 T019 — the idempotency cache is scoped per caller and survives a restart.

FR-023-013/014/015/015a. The cache used to be keyed on the raw ``Idempotency-Key`` ALONE — a value
the CLIENT supplies, with no tenant component — so a key collision across wallets could serve one
caller's cached ``IntentBundle`` to another (an open medium from audit R1). It was also
process-local, so replay protection died on every restart.
"""

from __future__ import annotations

import logging
from typing import Any

import pytest

from sparkpoint_agent.api.idempotency import (
    IdempotencyScope,
    IdempotencyStore,
    LayeredIdempotencyStore,
    StoredResponse,
)
from sparkpoint_agent.db.idempotency import PgIdempotencyStore

_KEY = "11111111-2222-3333-4444-555555555555"
_A = "0xaaaa000000000000000000000000000000000001"
_B = "0xbbbb000000000000000000000000000000000002"


def _scope(account: str, *, path: str = "/build-tx", key: str = _KEY) -> IdempotencyScope:
    return IdempotencyScope.build(account=account, method="POST", path=path, key=key)


def _response(marker: str) -> StoredResponse:
    return StoredResponse(status_code=200, media_type="application/json", body=marker.encode())


# ── the security half: scoping ───────────────────────────────────────────────


async def test_two_accounts_sharing_a_key_never_cross_hit() -> None:
    """FR-023-013 — the defect this closes. One wallet's cached bundle must be unreachable to
    another even when both supply the same Idempotency-Key."""
    store = IdempotencyStore()
    await store.put(_scope(_A), _response("A's bundle"))

    assert await store.get(_scope(_B)) is None
    assert (await store.get(_scope(_A))).body == b"A's bundle"  # type: ignore[union-attr]


async def test_same_key_on_a_different_route_is_not_a_hit() -> None:
    """A key valid for one route must not replay onto another — the path is part of the scope."""
    store = IdempotencyStore()
    await store.put(_scope(_A, path="/build-tx"), _response("build"))

    assert await store.get(_scope(_A, path="/submit-signed-tx")) is None


async def test_replay_of_your_own_key_returns_the_original() -> None:
    """FR-023-014 — the §1.3 contract itself, unchanged: first write wins."""
    store = IdempotencyStore()
    await store.put(_scope(_A), _response("first"))
    await store.put(_scope(_A), _response("second"))  # a concurrent original is not clobbered

    assert (await store.get(_scope(_A))).body == b"first"  # type: ignore[union-attr]


async def test_scope_is_account_case_insensitive_but_key_exact() -> None:
    """Addresses are checksum-agnostic, so 0xABC… and 0xabc… are the SAME caller; the key is not."""
    store = IdempotencyStore()
    await store.put(_scope(_A.upper()), _response("mine"))

    assert (await store.get(_scope(_A.lower()))).body == b"mine"  # type: ignore[union-attr]
    other_key = _KEY.replace("1111", "9999", 1)
    assert await store.get(_scope(_A, key=other_key)) is None


# ── the durability half: the layered store ──────────────────────────────────


class _FakeDurable:
    """A stand-in for the Postgres store: shared dict = a shared database across "restarts"."""

    def __init__(self, table: dict[IdempotencyScope, StoredResponse], *, broken: bool = False):
        self._table = table
        self._broken = broken
        self.gets = 0

    async def get(self, scope: IdempotencyScope) -> StoredResponse | None:
        self.gets += 1
        if self._broken:
            raise RuntimeError("db down")
        return self._table.get(scope)

    async def put(self, scope: IdempotencyScope, response: StoredResponse) -> None:
        if self._broken:
            raise RuntimeError("db down")
        self._table.setdefault(scope, response)  # first-write-wins, as ON CONFLICT DO NOTHING does


async def test_replay_survives_a_restart() -> None:
    """FR-023-015 / SC-023-011 — a FRESH in-process store over the SAME database still replays.
    That is exactly the deploy case the old process-local dict lost."""
    table: dict[IdempotencyScope, StoredResponse] = {}
    before = LayeredIdempotencyStore(IdempotencyStore(), _FakeDurable(table))
    await before.put(_scope(_A), _response("original"))

    after_restart = LayeredIdempotencyStore(IdempotencyStore(), _FakeDurable(table))
    found = await after_restart.get(_scope(_A))

    assert found is not None and found.body == b"original"


async def test_memory_hit_avoids_a_durable_read() -> None:
    """The in-process layer is a fast path, not just a mirror: a hot replay must not re-query."""
    durable = _FakeDurable({})
    store = LayeredIdempotencyStore(IdempotencyStore(), durable)
    await store.put(_scope(_A), _response("hot"))

    assert (await store.get(_scope(_A))).body == b"hot"  # type: ignore[union-attr]
    assert durable.gets == 0


async def test_durable_failure_fails_open_on_read_and_write() -> None:
    """FR-023-015 (N2) — a store outage must ADMIT the request, never block a build. Idempotency
    guards a double-emit on an advisory build; it is not a custody gate."""
    store = LayeredIdempotencyStore(IdempotencyStore(), _FakeDurable({}, broken=True))

    await store.put(_scope(_A), _response("x"))  # must not raise
    # The in-process layer still answers; a cold read simply misses rather than erroring.
    assert (await store.get(_scope(_A))).body == b"x"  # type: ignore[union-attr]
    cold = LayeredIdempotencyStore(IdempotencyStore(), _FakeDurable({}, broken=True))
    assert await cold.get(_scope(_A)) is None


async def test_no_durable_store_degrades_to_memory_only() -> None:
    """The pre-023 behavior, kept safe: replays work in-process, just not across a restart."""
    store = LayeredIdempotencyStore(IdempotencyStore(), None)
    await store.put(_scope(_A), _response("mem"))
    assert (await store.get(_scope(_A))).body == b"mem"  # type: ignore[union-attr]


# ── the Postgres store itself ───────────────────────────────────────────────


class _FakeDb:
    def __init__(self, *, error: Exception | None = None, row: dict[str, Any] | None = None):
        self._error = error
        self._row = row
        self.executed: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchrow(self, query: str, *args: Any) -> dict[str, Any] | None:
        if self._error is not None:
            raise self._error
        return self._row

    async def execute(self, query: str, *args: Any) -> str:
        if self._error is not None:
            raise self._error
        self.executed.append((query, args))
        return "DELETE 3"


async def test_pg_store_warns_once_and_distinctly_when_the_table_is_missing(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """FR-023-015a — the guard for the one HIGH finding from /speckit-analyze. Because the layered
    store fails OPEN, a missing table is indistinguishable from a working one at request level, so
    a deploy landing before 0026 is applied would run unprotected in total silence."""
    caplog.set_level(logging.WARNING, logger="sparkpoint_agent.db.idempotency")
    boom = RuntimeError('relation "idempotency_records" does not exist')
    store = PgIdempotencyStore(_FakeDb(error=boom))  # type: ignore[arg-type]

    for _ in range(3):
        with pytest.raises(RuntimeError):
            await store.get(_scope(_A))

    warnings = [r for r in caplog.records if "idempotency_table_missing" in r.getMessage()]
    assert len(warnings) == 1, "warn once, not per request"
    assert "0026" in warnings[0].getMessage()


async def test_pg_store_does_not_claim_a_missing_table_for_an_unrelated_error(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """A generic DB failure must NOT be reported as 'migration not applied' — that would send an
    operator to the wrong problem."""
    caplog.set_level(logging.WARNING, logger="sparkpoint_agent.db.idempotency")
    db = _FakeDb(error=RuntimeError("connection reset"))
    store = PgIdempotencyStore(db)  # type: ignore[arg-type]

    with pytest.raises(RuntimeError):
        await store.get(_scope(_A))

    assert not [r for r in caplog.records if "idempotency_table_missing" in r.getMessage()]


async def test_pg_store_sweep_reports_rows_removed_and_never_raises() -> None:
    """FR-023-015 — the retention sweep keeps a cache bounded, and a sweep failure is never worth
    surfacing."""
    ok = PgIdempotencyStore(_FakeDb())  # type: ignore[arg-type]
    assert await ok.sweep() == 3
    assert ok._db.executed, "the sweep must actually issue a DELETE"  # type: ignore[attr-defined]

    broken = PgIdempotencyStore(_FakeDb(error=RuntimeError("db down")))  # type: ignore[arg-type]
    assert await broken.sweep() == 0
