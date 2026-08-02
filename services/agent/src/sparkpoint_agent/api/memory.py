"""§027 cross-conversation memory — ``GET /memory/self`` + ``POST /memory/clear``.

Memory the assistant keeps ABOUT a user must be inspectable and erasable BY that user. Both routes
are scoped to the caller's verified ``X-Owner`` (the BFF injects the SIWE-verified wallet), and
there is deliberately **no admin route and no admin override** anywhere in this feature — an
operator does not get to read what Sparky remembers about someone. Clear is a POST (the same-origin
BFF proxy forwards only GET/POST), matching ``/conversations/{id}/delete``.

Honest by construction: the wire shape served here is the SAME ``{"at", "line"}`` shape stored in
``user_memory.lines`` and rendered into the model's prompt, so what the user reads on the Settings
page is literally what the model is given — not a friendlier paraphrase of it.

The read FAILS OPEN to an empty digest (no row, migration 0030 unapplied, database unreachable), so
this endpoint is a 200-with-nothing rather than a 500 in every degraded state. The CLEAR does not:
a user-initiated erase must never report success it did not achieve, so a real failure surfaces as
a §1.5 error envelope.

Access/product only — never custody (N1/N2/N3). Nothing here holds key material, a signature, an
amount, or an address, and no route on this path can gate or delay a withdrawal.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from ..db import get_database
from ..db.user_memory import MemoryStore
from .errors import ApiError, ErrorCode
from .security import AccountContext
from .vault import get_account

router = APIRouter(tags=["memory"])


def get_memory_store() -> MemoryStore:
    """The per-wallet memory store (overridden with a fake in tests)."""
    return MemoryStore(get_database())


@router.get("/memory/self")
async def get_own_memory(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[MemoryStore, Depends(get_memory_store)],
) -> dict[str, Any]:
    """Everything the assistant remembers about the session wallet, oldest entry first.

    ``lines`` is the verbatim stored digest — the same entries the model is shown. An empty list
    is a completely normal answer (a new user, or a database/migration that isn't ready), never an
    error: the store fails open so this surface can always render honestly.
    """
    memory = await store.get(account.owner)
    return {
        "lines": [entry.to_wire() for entry in memory.entries],
        "updatedAt": memory.updated_at,
    }


@router.post("/memory/clear")
async def clear_own_memory(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[MemoryStore, Depends(get_memory_store)],
) -> dict[str, Any]:
    """Erase the session wallet's whole digest. Idempotent — clearing empty memory succeeds.

    Unlike the read, this is NOT fail-open: if the delete cannot be performed we must say so, or
    the user walks away believing something was erased that wasn't.
    """
    try:
        await store.clear(account.owner)
    except Exception as exc:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "Couldn't clear Sparky's memory just now — nothing was changed. Please try again.",
        ) from exc
    return {"ok": True, "lines": [], "updatedAt": None}
