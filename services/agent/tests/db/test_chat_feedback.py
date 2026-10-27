# ruff: noqa: S101
"""061 A9 — thumbs feedback storage (migration 0043).

The contract that matters: one row per (wallet, message), so tapping twice (or retrying) updates
rather than inflates; the wallet is lowercased; and a reason is capped. The executor is a fake
(no live Postgres), matching the other store tests.
"""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.db.chat_feedback import ChatFeedbackStore


class _FakeDb:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return {"id": "11111111-1111-1111-1111-111111111111", "rating": args[3], "reason": args[4]}


@pytest.mark.asyncio
async def test_record_upserts_one_row_per_user_and_message() -> None:
    db = _FakeDb()
    store = ChatFeedbackStore(db)  # type: ignore[arg-type]
    out = await store.record(
        owner_eoa="0xABCdef0000000000000000000000000000000001",
        conversation_id="cnv_1",
        message_id="msg_7",
        rating="up",
    )
    assert out["rating"] == "up"
    (sql, args) = db.calls[0]
    assert "ON CONFLICT (user_eoa, message_id)" in sql
    assert "DO UPDATE" in sql
    assert args[:5] == (
        "0xabcdef0000000000000000000000000000000001",
        "cnv_1",
        "msg_7",
        "up",
        None,
    )


@pytest.mark.asyncio
async def test_reason_is_optional_and_capped() -> None:
    db = _FakeDb()
    store = ChatFeedbackStore(db)  # type: ignore[arg-type]
    await store.record(
        owner_eoa="0xabc0000000000000000000000000000000000001",
        conversation_id="c",
        message_id="m",
        rating="down",
        reason="x" * 5000,
    )
    assert len(db.calls[0][1][4]) == 1000
