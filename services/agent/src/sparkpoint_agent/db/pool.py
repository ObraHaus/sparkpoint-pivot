"""Thin async Postgres connection helper (asyncpg pool) for the data layer.

Deliberately minimal: lazy pool lifecycle + parameterized query pass-throughs +
a healthcheck for /readyz. It contains NO custody logic and no query builder --
callers pass parameterized SQL, and asyncpg binds arguments server-side (no
string interpolation of user data). The data layer is never on the withdrawal
path (N2); losing Postgres degrades intelligence but cannot trap funds
(data-model.md sec.16 VR-DS1, sec.18).
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import asyncpg
from asyncpg import Connection, Record
from asyncpg.pool import Pool

from .config import DatabaseConfig


class Database:
    """Owns a lazily-created asyncpg connection pool.

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

    def _require_pool(self) -> Pool[Record]:
        if self._pool is None:
            raise RuntimeError("Database pool is not connected; call connect() first.")
        return self._pool

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[Connection[Record]]:
        """Acquire a pooled connection for multi-statement/transaction work."""
        pool = self._require_pool()
        async with pool.acquire() as connection:
            yield connection

    async def execute(self, query: str, *args: Any) -> str:
        """Run a statement returning its command status (e.g. ``INSERT 0 1``)."""
        status: str = await self._require_pool().execute(query, *args)
        return status

    async def fetch(self, query: str, *args: Any) -> list[Record]:
        """Run a query returning all rows."""
        rows: list[Record] = await self._require_pool().fetch(query, *args)
        return rows

    async def fetchrow(self, query: str, *args: Any) -> Record | None:
        """Run a query returning the first row, or ``None``."""
        row: Record | None = await self._require_pool().fetchrow(query, *args)
        return row

    async def fetchval(self, query: str, *args: Any, column: int = 0) -> Any:
        """Run a query returning a single scalar from the first row."""
        return await self._require_pool().fetchval(query, *args, column=column)

    async def healthcheck(self) -> bool:
        """Return True iff a trivial round-trip succeeds (drives /readyz)."""
        return bool(await self.fetchval("SELECT 1") == 1)


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
