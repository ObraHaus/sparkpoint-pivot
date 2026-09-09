"""§B1 chat conversation history — list / read / delete, scoped to the session wallet.

Every route is scoped to the caller's verified ``X-Owner`` (the BFF injects the SIWE-verified
wallet): a caller only ever sees or deletes their OWN conversations — there is deliberately no admin
override (an admin does not get other users' chats). Delete is a POST (the same-origin BFF proxy
forwards only GET/POST). Access/product only — never custody (N2).
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from ..db import get_database
from ..db.conversations import ConversationStore
from .errors import ApiError, ErrorCode
from .security import AccountContext
from .vault import get_account

router = APIRouter(tags=["conversations"])


def get_conversation_store() -> ConversationStore:
    """The per-wallet conversation store (overridden with a fake in tests)."""
    return ConversationStore(get_database())


@router.get("/conversations")
async def list_conversations(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[ConversationStore, Depends(get_conversation_store)],
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    q: Annotated[str, Query(max_length=80)] = "",
) -> dict[str, Any]:
    """The session wallet's conversations, most-recent activity first (history nav).

    040 — now pageable and searchable, because the sidebar groups by time and a grouped list that
    silently stops at a page limit reads as a claim that nothing older exists. `total` is what lets
    the client say "Show 60 older conversations" rather than the vague "Show more": the honest
    number is the point of the control.

    `q` matches the TITLE only, inside the same per-wallet ownership scope as the list itself.
    """
    query = q.strip() or None
    return {
        "conversations": await store.list_conversations(
            account.owner, limit=limit, offset=offset, query=query
        ),
        "total": await store.count_conversations(account.owner, query=query),
    }


@router.get("/conversations/{conversation_id}")
async def get_conversation(
    conversation_id: str,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[ConversationStore, Depends(get_conversation_store)],
) -> dict[str, Any]:
    """One conversation + its ordered turns — 404 unless it belongs to the session wallet."""
    convo = await store.get_conversation(account.owner, conversation_id)
    if convo is None:
        raise ApiError(ErrorCode.NOT_FOUND, "No such conversation.")
    return convo


@router.post("/conversations/{conversation_id}/delete")
async def delete_conversation(
    conversation_id: str,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[ConversationStore, Depends(get_conversation_store)],
) -> dict[str, Any]:
    """Delete a conversation (POST, not DELETE — the BFF forwards only GET/POST). 404 unless the
    session wallet owns it (so a caller can never delete someone else's thread)."""
    deleted = await store.delete_conversation(account.owner, conversation_id)
    if not deleted:
        raise ApiError(ErrorCode.NOT_FOUND, "No such conversation.")
    return {"ok": True, "deleted": conversation_id}
