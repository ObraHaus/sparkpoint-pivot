"""Idempotency-Key handling (agent-service-api.md §1.3) — replays return the original.

All POST build/mutating endpoints accept an ``Idempotency-Key`` (UUID); a replay
returns the original response so a retried build cannot double-emit an ``IntentBundle``
(bundles are idempotent + short-lived). This scaffold keeps a process-local store;
production backs it with Postgres/Redis so replays survive restarts and span workers.
Only successful (2xx) JSON responses are cached — streamed (SSE) and error responses
are never replayed from cache.
"""

from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass

# RFC-4122 canonical form; the spec calls the key a UUID (§1.3).
_UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def is_valid_key(key: str) -> bool:
    """True iff ``key`` is a canonical UUID (§1.3)."""
    return bool(_UUID_RE.match(key))


@dataclass(frozen=True)
class StoredResponse:
    """A cached response body for an idempotent replay."""

    status_code: int
    media_type: str
    body: bytes


class IdempotencyStore:
    """A process-local, async-safe idempotency cache (scaffold).

    Keyed by the raw ``Idempotency-Key``. ``get``/``put`` are guarded by a lock so
    concurrent replays of the same key are consistent within a worker.
    """

    def __init__(self) -> None:
        self._store: dict[str, StoredResponse] = {}
        self._lock = asyncio.Lock()

    async def get(self, key: str) -> StoredResponse | None:
        async with self._lock:
            return self._store.get(key)

    async def put(self, key: str, response: StoredResponse) -> None:
        async with self._lock:
            # First write wins — a concurrent original in flight is not overwritten.
            self._store.setdefault(key, response)
