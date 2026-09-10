"""Thin async Postgres connection helper (asyncpg pool) for the data layer.

Deliberately minimal: lazy pool lifecycle + parameterized query pass-throughs +
a healthcheck for /readyz. It contains NO custody logic and no query builder --
callers pass parameterized SQL, and asyncpg binds arguments server-side (no
string interpolation of user data). The data layer is never on the withdrawal
path (N2); losing Postgres degrades intelligence but cannot trap funds
(data-model.md sec.16 VR-DS1, sec.18).

D5 -- SURVIVES A POSTGRES RESTART. The pool is created once at boot (fail-open, so a
DB blip can't kill boot), but a Postgres restart *after* boot leaves every pooled
connection dead. asyncpg does not on its own guarantee the pool re-establishes, so
the agent used to stay wedged -- ``/readyz`` reporting ``postgres:false`` forever and
every DB-backed route 500ing -- until its container was restarted by hand. Every
query now runs through ``_run``: on a connection-level error it TERMINATES the broken
pool, rebuilds it, and retries the query ONCE, so the first query after Postgres comes
back reconnects the pool for everyone. ``healthcheck`` degrades to ``False`` (an honest
readiness signal) rather than raising while the DB is unreachable.
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any, TypeVar

import asyncpg
from asyncpg import Connection, Record
from asyncpg.pool import Pool

from .config import DatabaseConfig

_T = TypeVar("_T")

# Errors that mean the pooled connection is GONE (Postgres restarted / network dropped /
# the server is still starting up) rather than the query being wrong. These -- and only
# these -- trigger a pool rebuild + one retry; a real query error (bad SQL, constraint
# violation) is NOT retried and propagates unchanged.
_CONNECTION_ERRORS: tuple[type[BaseException], ...] = (
    asyncpg.PostgresConnectionError,
    asyncpg.InterfaceError,
    ConnectionError,
    OSError,
)


class Database:
    """Owns a lazily-created asyncpg connection pool that self-heals after a Postgres restart.

    Construct once (typically at app startup), ``await connect()``, and share the
    instance. All query helpers acquire/release a pooled connection per call;
    ``acquire()`` is provided for multi-statement/transactional work.
    """

    def __init__(self, config: DatabaseConfig | None = None) -> None:
        self._config = config or DatabaseConfig.from_env()
        self._pool: Pool[Record] | None = None

    @property
    def is_connected(self) -> bool:
        return self._pool is not None

    async def connect(self) -> None:
        """Create the pool if not already connected (idempotent)."""
        if self._pool is None:
            self._pool = await asyncpg.create_pool(
                dsn=self._config.dsn,
                min_size=self._config.min_size,
                max_size=self._config.max_size,
                command_timeout=self._config.command_timeout,
            )

    async def disconnect(self) -> None:
        """Gracefully close the pool if open (idempotent)."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None

    async def _reset(self) -> None:
        """Drop a broken pool so the next call rebuilds it.

        Uses ``terminate()`` (immediate) rather than ``close()``: a graceful close waits for
        every connection to be released, which can hang indefinitely on connections whose
        server has gone away -- exactly the situation this exists to recover from.
        """
        pool, self._pool = self._pool, None
        if pool is not None:
            try:
                pool.terminate()
            except Exception:  # noqa: BLE001, S110 -- pool already broken; discarding it, nothing to salvage or log
                pass

    async def _ensure_pool(self) -> Pool[Record]:
        """The live pool, (re)connecting it first if it was never opened or has been reset."""
        if self._pool is None:
            await self.connect()
        return self._require_pool()

    async def _run(self, op: Callable[[Pool[Record]], Awaitable[_T]]) -> _T:
        """Run ``op`` against the pool; on a connection-level failure, rebuild the pool and
        retry ONCE (the D5 re-establish path). ``op`` must be idempotent -- it is a single
        pooled statement, never a transaction, so replaying it after a dropped connection is
        safe. A non-connection error (bad SQL, constraint) is not caught and propagates.
        """
        pool = await self._ensure_pool()
        try:
            return await op(pool)
        except _CONNECTION_ERRORS:
            await self._reset()
            pool = await self._ensure_pool()
            return await op(pool)

    def _require_pool(self) -> Pool[Record]:
        if self._pool is None:
            raise RuntimeError("Database pool is not connected; call connect() first.")
        return self._pool

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[Connection[Record]]:
        """Acquire a pooled connection for multi-statement/transaction work.

        Reconnects the pool if it was reset (e.g. after a Postgres restart), but does NOT
        auto-retry the caller's body -- replaying a partially-applied transaction is unsafe,
        so a mid-transaction disconnect surfaces to the caller to handle.
        """
        pool = await self._ensure_pool()
        async with pool.acquire() as connection:
            yield connection

    async def execute(self, query: str, *args: Any) -> str:
        """Run a statement returning its command status (e.g. ``INSERT 0 1``)."""
        return await self._run(lambda pool: pool.execute(query, *args))

    async def fetch(self, query: str, *args: Any) -> list[Record]:
        """Run a query returning all rows."""
        return await self._run(lambda pool: pool.fetch(query, *args))

    async def fetchrow(self, query: str, *args: Any) -> Record | None:
        """Run a query returning the first row, or ``None``."""
        return await self._run(lambda pool: pool.fetchrow(query, *args))

    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any:
        """Run a query returning a single scalar from the first row."""
        return await self._run(lambda pool: pool.fetchval(query, *args, column=column))

    async def healthcheck(self) -> bool:
        """Return True iff a trivial round-trip succeeds (drives /readyz).

        Degrades to False -- never raises -- when Postgres is unreachable, so /readyz reports
        ``postgres:false`` honestly instead of 500ing. Because the underlying ``_run`` rebuilds
        the pool on a connection error, the first successful probe after Postgres returns also
        reconnects the pool for the DB-backed routes.
        """
        try:
            return bool(await self.fetchval("SELECT 1") == 1)
        except Exception:  # noqa: BLE001 -- a down DB is a False readiness signal, not a crash
            return False


_default: Database | None = None


def get_database() -> Database:
    """Return the process-wide default ``Database`` (lazily constructed).

    Import-safe: constructing the singleton reads ``DATABASE_URL`` only on first
    call, so importing this module never requires the env to be present.
    """
    global _default
    if _default is None:
        _default = Database()
    return _default
