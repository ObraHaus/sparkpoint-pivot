"""Idempotency-Key handling (agent-service-api.md §1.3) — replays return the original.

All POST build/mutating endpoints accept an ``Idempotency-Key`` (UUID); a replay returns the
original response, so a retried build cannot double-emit an ``IntentBundle`` (they are idempotent
and short-lived). Only successful (2xx) JSON responses are cached — streamed (SSE) and error
responses are never replayed from cache.

023 (FR-023-013/014/015) — two defects closed here:

1. **The cache key carried no tenant component.** It was the raw ``Idempotency-Key`` alone — a value
   the CLIENT supplies — so a key collision across wallets could serve one caller's cached
   ``IntentBundle`` to another. The key is now the :class:`IdempotencyScope`
   ``(account, method, path, key)``, so a key is only ever valid for the caller AND the route that
   created it. (Open medium from the alpha security audit R1.)
2. **The store was process-local**, so replay protection died on every restart and could not span
   workers. :class:`IdempotencyStore` remains as the in-process fast path, and
   ``db/idempotency.PgIdempotencyStore`` (migration ``0027``) backs it durably.

FAIL-OPEN (N2): a store failure ADMITS the request. Idempotency guards a double-emit on an ADVISORY
build and is never on the withdraw/exit path, so it must never become a new way for a DB blip to
block a build — the same posture the quota gate already takes. The cost is that a MISSING table
looks exactly like a working store at the request level, which is why the durable store logs a
table-missing warning (FR-023-015a) rather than letting a mis-ordered deploy run unprotected in
silence.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Protocol

# RFC-4122 canonical form; the spec calls the key a UUID (§1.3).
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def is_valid_key(key: str) -> bool:
    """True iff ``key`` is a canonical UUID (§1.3)."""
    return bool(_UUID_RE.match(key))


@dataclass(frozen=True)
class IdempotencyScope:
    """What a cached response is valid FOR — the composite cache key (023).

    ``account`` is the middleware's already-parsed ``X-Account`` (lower-cased, since addresses are
    checksum-agnostic). ``method`` + ``path`` stop a key that is valid for one route from replaying
    onto another. Frozen so it can be a dict key.
    """

    account: str
    method: str
    path: str
    key: str

    @classmethod
    def build(cls, *, account: str | None, method: str, path: str, key: str) -> IdempotencyScope:
        """Normalize a scope. A missing account becomes ``"-"``: every non-exempt route is
        account-scoped by the middleware, so this is unreachable in practice — and if it ever were
        reachable, an explicit sentinel shares nothing across callers, which is the safe direction.
        """
        return cls(account=(account or "-").lower(), method=method.upper(), path=path, key=key)


@dataclass(frozen=True)
class StoredResponse:
    """A cached response body for an idempotent replay."""

    status_code: int
    media_type: str
    body: bytes


class ScopedStore(Protocol):
    """The store seam the middleware depends on — in-process or Postgres-backed."""

    async def get(self, scope: IdempotencyScope) -> StoredResponse | None: ...

    async def put(self, scope: IdempotencyScope, response: StoredResponse) -> None: ...


class IdempotencyStore:
    """A process-local, async-safe idempotency cache.

    Keyed by the full :class:`IdempotencyScope`. ``get``/``put`` are guarded by a lock so
    concurrent replays of the same scope stay consistent within a worker; cross-worker consistency
    comes from the durable store's UNIQUE constraint, not from this lock.
    """

    def __init__(self) -> None:
        self._store: dict[IdempotencyScope, StoredResponse] = {}
        self._lock = asyncio.Lock()

    async def get(self, scope: IdempotencyScope) -> StoredResponse | None:
        async with self._lock:
            return self._store.get(scope)

    async def put(self, scope: IdempotencyScope, response: StoredResponse) -> None:
        async with self._lock:
            # First write wins — a concurrent original in flight is not overwritten.
            self._store.setdefault(scope, response)


class LayeredIdempotencyStore:
    """The in-process cache in front of a durable store (023).

    Reads hit memory first, then the durable store (so a replay works after a restart or on another
    worker); writes go to both. FAIL-OPEN: any durable-store error is swallowed — the in-process
    layer still answers, and at worst a replay is treated as a fresh request. Never raises into the
    request path (N2).
    """

    def __init__(self, memory: IdempotencyStore, durable: ScopedStore | None) -> None:
        self._memory = memory
        self._durable = durable

    async def get(self, scope: IdempotencyScope) -> StoredResponse | None:
        cached = await self._memory.get(scope)
        if cached is not None:
            return cached
        if self._durable is None:
            return None
        try:
            found = await self._durable.get(scope)
        except Exception:
            return None
        if found is not None:
            # Warm the fast path so a hot replay does not re-query.
            await self._memory.put(scope, found)
        return found

    async def put(self, scope: IdempotencyScope, response: StoredResponse) -> None:
        await self._memory.put(scope, response)
        if self._durable is None:
            return
        try:
            await self._durable.put(scope, response)
        except Exception:
            # Fail-open: losing durability degrades replay protection, never the build (N2).
            return
