# ruff: noqa: S101
"""025 · Task 2 — structured chat cards round-trip through ConversationStore (migration 0028).

The asyncpg executor is a FAKE (no live Postgres): it records every statement + arg and returns
canned rows. Covers the whole persistence contract the chat replay depends on:

  * WRITE — an assistant turn's block wire JSON is serialized into the new ``blocks`` jsonb
    column alongside the UNCHANGED lossy text summary (the summary still feeds the classifier);
  * READ — ``get_conversation`` decodes it back, whether the driver hands jsonb over as a str or
    as an already-decoded list;
  * LEGACY — a pre-0028 row (``blocks IS NULL``) reads as ``[]`` and is otherwise untouched, so
    an old conversation keeps replaying exactly as it did before;
  * ROBUSTNESS — corrupt/al ien jsonb degrades to ``[]`` instead of breaking the whole read;
  * ISOLATION — the classifier's ``recent_history`` is deliberately NOT given blocks.
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, cast
from uuid import UUID

from asyncpg.exceptions import UndefinedColumnError

from sparkpoint_agent.db.conversations import ConversationStore
from sparkpoint_agent.db.pool import Database

_CID = UUID("11111111-1111-1111-1111-111111111111")
_OWNER = "0xABCdef0000000000000000000000000000000001"
_NOW = datetime(2026, 8, 2, tzinfo=UTC)

_ACTION_BLOCK: dict[str, Any] = {
    "type": "action",
    "proposedAction": {
        "type": "aerodrome_swap",
        "asset": "0x4200000000000000000000000000000000000006",
        "decimals": 18,
        "amount": "1000000",
        "params": {"maxSlippageBps": 50},
    },
    "policy": {"status": "rejected", "reason": "Swaps run on Uniswap V3."},
}
_TEXT_BLOCK: dict[str, Any] = {"type": "text", "markdown": "Here's a swap."}


class _FakeConn:
    def __init__(self, parent: _FakeDb) -> None:
        self._parent = parent

    @asynccontextmanager
    async def transaction(self) -> Any:
        yield

    async def fetchval(self, sql: str, *args: Any) -> Any:
        return await self._parent.fetchval(sql, *args)

    async def execute(self, sql: str, *args: Any) -> str:
        self._parent.calls.append((sql, args))
        return "INSERT 0 1"


class _FakeDb:
    """Records SQL + args; canned fetchval/fetch by SQL fragment (no live DB)."""

    def __init__(self, *, rows: list[dict[str, Any]] | None = None, owns: bool = True) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self._rows = rows or []
        self._owns = owns

    @asynccontextmanager
    async def acquire(self) -> Any:
        yield _FakeConn(self)

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        if "SELECT 1 FROM conversations" in sql:
            return 1 if self._owns else None
        return None

    async def fetch(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self._rows

    async def execute(self, sql: str, *args: Any) -> str:
        self.calls.append((sql, args))
        return "UPDATE 1"

    def append_args(self) -> tuple[Any, ...]:
        """The args of the single INSERT INTO conversation_turns statement."""
        return next(a for sql, a in self.calls if "INSERT INTO conversation_turns" in sql)


def _store(db: _FakeDb) -> ConversationStore:
    return ConversationStore(cast(Database, db))


def _row(role: str, content: str, blocks: Any) -> dict[str, Any]:
    return {"role": role, "content": content, "blocks": blocks, "created_at": _NOW}


# ── write ───────────────────────────────────────────────────────────────────────


async def test_append_turn_persists_blocks_as_json_alongside_the_summary() -> None:
    db = _FakeDb()
    await _store(db).append_turn(
        _CID, "assistant", "[proposed action: aerodrome_swap]", [_TEXT_BLOCK, _ACTION_BLOCK]
    )
    args = db.append_args()
    # (conversation_id, role, content, blocks)
    assert args[0] == _CID
    assert args[1] == "assistant"
    # The LOSSY SUMMARY IS KEPT — it still feeds the classifier history and every pre-025 path.
    assert args[2] == "[proposed action: aerodrome_swap]"
    # …and the structured cards ride alongside it, in order, as jsonb text.
    assert json.loads(args[3]) == [_TEXT_BLOCK, _ACTION_BLOCK]


async def test_append_turn_encodes_non_ascii_raw_never_as_unicode_escapes() -> None:
    # 025 HOTFIX REGRESSION GUARD. The shared develop Postgres is server_encoding SQL_ASCII,
    # whose JSONB parser hard-rejects any \uXXXX escape above ASCII (UntranslatableCharacterError)
    # while raw UTF-8 bytes pass through — so `json.dumps` MUST use ensure_ascii=False here.
    # With the default escaping, every block containing an em-dash or curly quote (virtually
    # every LLM answer) failed the INSERT and the fail-open sink dropped the whole turn.
    db = _FakeDb()
    block = {"type": "text", "markdown": "Swaps run on Uniswap V3 — you review the quote…"}
    await _store(db).append_turn(_CID, "assistant", "summary", [block])
    payload = db.append_args()[3]
    assert "\\u" not in payload, "non-ASCII must go to Postgres as raw UTF-8, not \\u escapes"
    assert "—" in payload and "…" in payload
    assert json.loads(payload) == [block]


async def test_append_turn_without_blocks_writes_null() -> None:
    # A user turn (and any assistant turn with nothing structured) keeps the pre-025 shape.
    db = _FakeDb()
    await _store(db).append_turn(_CID, "user", "Swap ETH to USDC")
    assert db.append_args()[3] is None


async def test_append_turn_with_empty_blocks_writes_null() -> None:
    db = _FakeDb()
    await _store(db).append_turn(_CID, "assistant", "some text", [])
    assert db.append_args()[3] is None


# ── read ────────────────────────────────────────────────────────────────────────


async def test_get_conversation_decodes_blocks_from_a_jsonb_string() -> None:
    # asyncpg hands jsonb back as a str unless a codec is registered — the production shape.
    db = _FakeDb(rows=[_row("assistant", "[recommended: X]", json.dumps([_ACTION_BLOCK]))])
    convo = await _store(db).get_conversation(_OWNER, str(_CID))
    assert convo is not None
    assert convo["turns"][0]["blocks"] == [_ACTION_BLOCK]
    assert convo["turns"][0]["content"] == "[recommended: X]"


async def test_get_conversation_accepts_already_decoded_blocks() -> None:
    # …and tolerates a driver/codec that decodes jsonb for us.
    db = _FakeDb(rows=[_row("assistant", "s", [_TEXT_BLOCK])])
    convo = await _store(db).get_conversation(_OWNER, str(_CID))
    assert convo is not None
    assert convo["turns"][0]["blocks"] == [_TEXT_BLOCK]


async def test_get_conversation_preserves_block_order() -> None:
    db = _FakeDb(rows=[_row("assistant", "s", json.dumps([_TEXT_BLOCK, _ACTION_BLOCK]))])
    convo = await _store(db).get_conversation(_OWNER, str(_CID))
    assert convo is not None
    assert [b["type"] for b in convo["turns"][0]["blocks"]] == ["text", "action"]


# ── legacy + robustness ─────────────────────────────────────────────────────────


async def test_legacy_turn_with_null_blocks_reads_as_empty_and_keeps_its_text() -> None:
    # A pre-0028 row. It must replay EXACTLY as before: the text summary, no cards.
    db = _FakeDb(rows=[_row("assistant", "[showed your portfolio]", None)])
    convo = await _store(db).get_conversation(_OWNER, str(_CID))
    assert convo is not None
    assert convo["turns"][0]["blocks"] == []
    assert convo["turns"][0]["content"] == "[showed your portfolio]"


async def test_user_turns_always_carry_an_empty_block_list() -> None:
    db = _FakeDb(rows=[_row("user", "Swap ETH to USDC", None)])
    convo = await _store(db).get_conversation(_OWNER, str(_CID))
    assert convo is not None
    assert convo["turns"][0] == {
        "role": "user",
        "content": "Swap ETH to USDC",
        "blocks": [],
        "at": _NOW.isoformat(),
    }


async def test_corrupt_blocks_degrade_to_empty_never_break_the_read() -> None:
    rows = [
        _row("assistant", "a", "{not json"),          # unparseable
        _row("assistant", "b", json.dumps({"x": 1})),  # valid JSON, wrong shape (not a list)
        _row("assistant", "c", json.dumps([_TEXT_BLOCK, "junk", 7])),  # mixed
    ]
    convo = await _store(_FakeDb(rows=rows)).get_conversation(_OWNER, str(_CID))
    assert convo is not None
    turns = convo["turns"]
    assert turns[0]["blocks"] == []
    assert turns[1]["blocks"] == []
    assert turns[2]["blocks"] == [_TEXT_BLOCK]  # non-dict entries dropped, the real card kept
    assert [t["content"] for t in turns] == ["a", "b", "c"]  # every turn still surfaces


async def test_foreign_conversation_is_still_none() -> None:
    # Ownership is unchanged by 025: a non-owner gets None (→ 404), never someone else's cards.
    db = _FakeDb(rows=[_row("assistant", "a", json.dumps([_ACTION_BLOCK]))], owns=False)
    assert await _store(db).get_conversation(_OWNER, str(_CID)) is None


# ── classifier isolation ────────────────────────────────────────────────────────


async def test_recent_history_does_not_select_blocks() -> None:
    """The planner's multi-turn context stays the compact text summary.

    Feeding raw card JSON into the classifier prompt would change every classification and blow
    up the prompt size; persisted blocks are for REPLAY only.
    """
    db = _FakeDb(rows=[{"role": "user", "content": "hi"}])
    await _store(db).recent_history(_CID)
    (sql, _args) = next(c for c in db.calls if "conversation_turns" in c[0])
    assert "blocks" not in sql


# ── deploy-order safety: the agent running AHEAD of migration 0028 ─────────────


class _PreMigrationConn(_FakeConn):
    """Raises UndefinedColumnError for any statement naming `blocks` (a pre-0028 database)."""

    async def execute(self, sql: str, *args: Any) -> str:
        self._parent.calls.append((sql, args))  # record the ATTEMPT, then fail like Postgres
        if "blocks" in sql:
            raise UndefinedColumnError(
                'column "blocks" of relation "conversation_turns" does not exist'
            )
        return "INSERT 0 1"


class _PreMigrationDb(_FakeDb):
    @asynccontextmanager
    async def acquire(self) -> Any:
        yield _PreMigrationConn(self)

    async def fetch(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        if "blocks" in sql:
            raise UndefinedColumnError('column "blocks" does not exist')
        # The pre-0028 projection: no `blocks` key on the row at all.
        return [{k: v for k, v in r.items() if k != "blocks"} for r in self._rows]


async def test_append_turn_falls_back_when_the_blocks_column_is_missing() -> None:
    """An agent deployed BEFORE 0028 is applied must keep recording history.

    Without this fallback the raise is swallowed by the fail-open sink in api/chat.py and
    conversation history stops being written ENTIRELY, in silence — a far worse outcome than
    simply not persisting the cards yet.
    """
    db = _PreMigrationDb()
    await _store(db).append_turn(_CID, "assistant", "[recommended: X]", [_ACTION_BLOCK])
    inserts = [(sql, a) for sql, a in db.calls if "INSERT INTO conversation_turns" in sql]
    # The blocks INSERT was attempted, then retried without the column.
    assert len(inserts) == 2
    assert "blocks" in inserts[0][0]
    assert "blocks" not in inserts[1][0]
    assert inserts[1][1] == (_CID, "assistant", "[recommended: X]")
    # Recency was still bumped, so the thread does not fall out of the sidebar's sort.
    assert any("UPDATE conversations" in sql for sql, _a in db.calls)


async def test_get_conversation_falls_back_when_the_blocks_column_is_missing() -> None:
    """…and reading must not 500. `api/conversations.py` has no handler above this call."""
    db = _PreMigrationDb(rows=[_row("assistant", "[showed your portfolio]", None)])
    convo = await _store(db).get_conversation(_OWNER, str(_CID))
    assert convo is not None
    # Replays as text — identical to a legacy turn, which is exactly right.
    assert convo["turns"][0]["blocks"] == []
    assert convo["turns"][0]["content"] == "[showed your portfolio]"
