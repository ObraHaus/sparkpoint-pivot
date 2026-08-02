# ruff: noqa: S101
"""027 · Task 1 — the cross-conversation memory store (migration 0030).

The asyncpg executor is a FAKE (no live Postgres): it records every statement + arg and returns
canned rows. Covers the whole persistence contract chat and Settings depend on:

  * WRITE — lines fold onto the existing digest (newest LAST) and the row is upserted;
  * SQL_ASCII — the jsonb payload reaches the driver as RAW UTF-8, never ``\\u`` escapes (the 025
    hotfix regression guard: the shared develop Postgres is ``server_encoding SQL_ASCII``);
  * CAP — the digest is hard-capped at 40 entries, dropping the OLDEST;
  * READ — jsonb decodes whether the driver hands back a str or an already-decoded list, and
    anything corrupt degrades to "no memory" instead of breaking the read;
  * DEPLOY ORDER — an agent running AHEAD of migration 0030 degrades to "no memory" on EVERY path
    (read, clear) rather than 500ing, and says so once in the logs.
"""

from __future__ import annotations

import json
import logging
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from asyncpg.exceptions import UndefinedColumnError, UndefinedTableError

import sparkpoint_agent.db.user_memory as user_memory_module
from sparkpoint_agent.db.pool import Database
from sparkpoint_agent.db.user_memory import MemoryStore
from sparkpoint_agent.memory import MAX_MEMORY_LINES

_OWNER = "0xABCdef0000000000000000000000000000000001"
_USER_ID = "11111111-1111-1111-1111-111111111111"
_NOW = datetime(2026, 8, 2, 4, 15, tzinfo=UTC)


def _entries(*lines: str) -> str:
    return json.dumps([{"at": _NOW.isoformat(), "line": line} for line in lines])


class _FakeConn:
    def __init__(self, parent: _FakeDb) -> None:
        self._parent = parent

    @asynccontextmanager
    async def transaction(self) -> Any:
        yield

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self._parent.calls.append((sql, args))
        if "INSERT INTO users" in sql:
            return _USER_ID
        if "FOR UPDATE" in sql:
            return self._parent.stored
        return None

    async def execute(self, sql: str, *args: Any) -> str:
        self._parent.calls.append((sql, args))
        return "INSERT 0 1"

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        # 028: append_with_cursor locks lines + activity_cursor together.
        self._parent.calls.append((sql, args))
        if "FOR UPDATE" in sql:
            return {"lines": self._parent.stored, "activity_cursor": self._parent.stored_cursor}
        return None


class _FakeDb:
    """Records SQL + args; canned reads by SQL fragment (no live DB)."""

    def __init__(self, *, stored: Any = None, row: Any = None, stored_cursor: Any = None) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.stored = stored
        self.stored_cursor = stored_cursor
        self._row = row

    @asynccontextmanager
    async def acquire(self) -> Any:
        yield _FakeConn(self)

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        return self._row

    async def fetchval(self, sql: str, *args: Any) -> Any:
        # 028: the cursor read (`get_activity_cursor`) is a top-level fetchval.
        self.calls.append((sql, args))
        return self.stored_cursor

    async def execute(self, sql: str, *args: Any) -> str:
        self.calls.append((sql, args))
        return "DELETE 1"

    def upsert_args(self) -> tuple[Any, ...]:
        return next(a for sql, a in self.calls if "INSERT INTO user_memory" in sql)

    def written(self) -> list[dict[str, Any]]:
        payload: list[dict[str, Any]] = json.loads(self.upsert_args()[1])
        return payload

    def written_lines(self) -> list[str]:
        return [e["line"] for e in self.written()]


def _store(db: _FakeDb) -> MemoryStore:
    return MemoryStore(cast(Database, db), now=lambda: _NOW)


# ── write ───────────────────────────────────────────────────────────────────────


async def test_append_writes_lines_newest_last_with_a_timestamp() -> None:
    db = _FakeDb()
    await _store(db).append(_OWNER, ["asked: what is APY?", "viewed their portfolio"])
    assert db.written() == [
        {"at": _NOW.isoformat(), "line": "asked: what is APY?"},
        {"at": _NOW.isoformat(), "line": "viewed their portfolio"},
    ]
    assert db.upsert_args()[0] == _USER_ID


async def test_append_folds_onto_the_existing_digest_preserving_order() -> None:
    db = _FakeDb(stored=_entries("older", "newer"))
    await _store(db).append(_OWNER, ["newest"])
    assert db.written_lines() == ["older", "newer", "newest"]


async def test_append_upserts_the_user_so_a_first_ever_turn_is_remembered() -> None:
    db = _FakeDb()
    await _store(db).append(_OWNER, ["asked: hi"])
    assert any("INSERT INTO users" in sql for sql, _ in db.calls)


async def test_append_takes_a_row_lock_before_the_read_modify_write() -> None:
    db = _FakeDb(stored=_entries("a"))
    await _store(db).append(_OWNER, ["b"])
    assert any("FOR UPDATE" in sql for sql, _ in db.calls)


async def test_append_encodes_non_ascii_raw_never_as_unicode_escapes() -> None:
    # 025 HOTFIX REGRESSION GUARD, applied to the 027 writer. The shared develop Postgres is
    # server_encoding SQL_ASCII, whose JSONB parser hard-rejects any \uXXXX escape above ASCII
    # (UntranslatableCharacterError) while raw UTF-8 bytes pass through — so json.dumps MUST use
    # ensure_ascii=False. Memory lines quote the user's own words, so an em-dash or a curly quote
    # is routine; with default escaping this INSERT would fail on most turns and the fail-open
    # sink would drop every one, exactly as happened to card persistence in production.
    db = _FakeDb()
    await _store(db).append(_OWNER, ["asked: what\u2019s the vault\u2019s APY \u2014 roughly?"])
    payload = db.upsert_args()[1]
    assert "\\u" not in payload, "non-ASCII must go to Postgres as raw UTF-8, not \\u escapes"
    assert "—" in payload and "’" in payload
    expected = "asked: what\u2019s the vault\u2019s APY \u2014 roughly?"
    assert json.loads(payload)[0]["line"] == expected


async def test_append_hard_caps_the_digest_dropping_the_oldest() -> None:
    db = _FakeDb(stored=_entries(*[f"old-{i}" for i in range(MAX_MEMORY_LINES)]))
    await _store(db).append(_OWNER, ["brand new"])
    written = db.written_lines()
    assert len(written) == MAX_MEMORY_LINES
    assert written[-1] == "brand new"
    assert "old-0" not in written, "the oldest entry is the one that falls off"
    assert written[0] == "old-1"


async def test_append_skips_a_line_identical_to_the_immediately_previous_one() -> None:
    db = _FakeDb(stored=_entries("asked: hi"))
    await _store(db).append(_OWNER, ["asked: hi"])
    assert db.written_lines() == ["asked: hi"]


async def test_append_of_nothing_touches_the_database_at_all() -> None:
    db = _FakeDb()
    await _store(db).append(_OWNER, [])
    await _store(db).append(_OWNER, ["   ", ""])
    assert db.calls == []


async def test_append_raises_so_the_caller_owns_the_fail_open_decision() -> None:
    # The chat sink logs once per process and swallows; the store must not hide the failure from
    # it, or a systematic write failure becomes invisible (the 025 lesson).
    class _Boom(_FakeDb):
        @asynccontextmanager
        async def acquire(self) -> Any:
            raise RuntimeError("pool is down")
            yield  # pragma: no cover

    with pytest.raises(RuntimeError):
        await _store(_Boom()).append(_OWNER, ["asked: hi"])


# ── read ────────────────────────────────────────────────────────────────────────


async def test_get_decodes_a_jsonb_string_row() -> None:
    # asyncpg hands jsonb back as a str unless a codec is registered — the production shape.
    db = _FakeDb(row={"lines": _entries("asked: hi", "viewed their portfolio"), "updated_at": _NOW})
    memory = await _store(db).get(_OWNER)
    assert memory.lines == ("asked: hi", "viewed their portfolio")
    assert memory.updated_at == _NOW.isoformat()
    assert not memory.is_empty


async def test_get_accepts_already_decoded_jsonb() -> None:
    db = _FakeDb(row={"lines": [{"at": "t", "line": "asked: hi"}], "updated_at": _NOW})
    assert (await _store(db).get(_OWNER)).lines == ("asked: hi",)


async def test_get_of_a_wallet_with_no_row_is_empty_not_an_error() -> None:
    memory = await _store(_FakeDb(row=None)).get(_OWNER)
    assert memory.is_empty and memory.lines == () and memory.updated_at is None


async def test_get_scopes_the_read_to_the_callers_own_wallet() -> None:
    db = _FakeDb(row=None)
    await _store(db).get(_OWNER)
    (sql, args) = next(c for c in db.calls if "FROM user_memory" in c[0])
    assert "u.eoa_address = $1" in sql and args == (_OWNER,)


async def test_get_degrades_corrupt_jsonb_to_no_memory() -> None:
    for corrupt in ("{not json", json.dumps({"x": 1}), json.dumps(["junk", 7, {"line": "  "}])):
        db = _FakeDb(row={"lines": corrupt, "updated_at": _NOW})
        assert (await _store(db).get(_OWNER)).lines == ()


async def test_get_keeps_the_good_entries_when_only_some_are_malformed() -> None:
    raw = json.dumps([{"line": "kept"}, "junk", {"at": 5, "line": "also kept"}, {"at": "t"}])
    memory = await _store(_FakeDb(row={"lines": raw, "updated_at": _NOW})).get(_OWNER)
    assert memory.lines == ("kept", "also kept")


async def test_get_fails_open_when_the_database_is_unreachable() -> None:
    class _Boom(_FakeDb):
        async def fetchrow(self, sql: str, *args: Any) -> Any:
            raise RuntimeError("pool is down")

    assert (await _store(_Boom()).get(_OWNER)).is_empty


# ── clear ───────────────────────────────────────────────────────────────────────


async def test_clear_blanks_only_the_callers_lines_and_never_creates_a_user() -> None:
    # 028: clear is an UPDATE of ``lines`` (not a row DELETE) so the activity cursor SURVIVES —
    # FR-009: cleared platform activity must never be re-discovered by the next fold.
    db = _FakeDb()
    await _store(db).clear(_OWNER)
    (sql, args) = next(c for c in db.calls if "UPDATE user_memory" in c[0])
    assert "lines = '[]'::jsonb" in sql
    assert "activity_cursor" not in sql, "clear must not touch the fold cursor"
    assert args == (_OWNER,)
    assert not any("INSERT INTO users" in s for s, _ in db.calls)


async def test_clear_raises_so_the_endpoint_never_claims_a_success_it_didnt_achieve() -> None:
    class _Boom(_FakeDb):
        async def execute(self, sql: str, *args: Any) -> str:
            raise RuntimeError("pool is down")

    with pytest.raises(RuntimeError):
        await _store(_Boom()).clear(_OWNER)


# ── deploy order: the agent running AHEAD of migration 0030 ─────────────────────


class _PreMigrationDb(_FakeDb):
    """Raises UndefinedTableError for anything naming `user_memory` (a pre-0030 database)."""

    async def fetchrow(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        raise UndefinedTableError('relation "user_memory" does not exist')

    async def execute(self, sql: str, *args: Any) -> str:
        self.calls.append((sql, args))
        raise UndefinedTableError('relation "user_memory" does not exist')


@pytest.fixture(autouse=True)
def _reset_warning_latch() -> Any:
    # The missing-table warning is once-per-process; reset it so each test sees it fire.
    user_memory_module._warned_missing_table = False
    user_memory_module._warned_missing_column = False
    yield
    user_memory_module._warned_missing_table = False
    user_memory_module._warned_missing_column = False


async def test_get_on_a_pre_0030_database_reads_as_no_memory_never_a_500() -> None:
    """Unlike 0028, this migration IS order-insensitive — and that is asserted, not assumed.

    ``GET /memory/self`` has no exception handling above it, so without this the whole Settings
    page would 500 for every user until the migration landed.
    """
    assert (await _store(_PreMigrationDb()).get(_OWNER)).is_empty


async def test_clear_on_a_pre_0030_database_succeeds_because_nothing_is_stored() -> None:
    await _store(_PreMigrationDb()).clear(_OWNER)  # must not raise


async def test_a_missing_table_is_warned_exactly_once_per_process(
    caplog: pytest.LogCaptureFixture,
) -> None:
    # Fail-open must never be BLIND: "nobody is ever remembered" has to be distinguishable from
    # "these users have done nothing" in the logs — without flooding them.
    with caplog.at_level(logging.WARNING, logger=user_memory_module.__name__):
        for _ in range(3):
            await _store(_PreMigrationDb()).get(_OWNER)
        await _store(_PreMigrationDb()).clear(_OWNER)
    hits = [r for r in caplog.records if "user_memory_table_missing" in r.getMessage()]
    assert len(hits) == 1
    assert "0030" in hits[0].getMessage()


# ── 028 · activity-fold cursor (migration 0031) ─────────────────────────────────


class _PreColumnDb(_FakeDb):
    """Raises UndefinedColumnError for anything naming `activity_cursor` (pre-0031 database)."""

    async def fetchval(self, sql: str, *args: Any) -> Any:
        self.calls.append((sql, args))
        if "activity_cursor" in sql:
            raise UndefinedColumnError('column "activity_cursor" does not exist')
        return None


_CURSOR = {"v": 1, "flows": {"base": {"block": 100, "log": 2}}}


async def test_get_activity_cursor_round_trips_a_jsonb_string() -> None:
    db = _FakeDb(stored_cursor=json.dumps(_CURSOR))
    assert await _store(db).get_activity_cursor(_OWNER) == _CURSOR


async def test_get_activity_cursor_none_means_never_folded() -> None:
    assert await _store(_FakeDb()).get_activity_cursor(_OWNER) is None


async def test_get_activity_cursor_corrupt_degrades_to_first_fold_not_a_crash() -> None:
    assert await _store(_FakeDb(stored_cursor="{not json")).get_activity_cursor(_OWNER) is None
    listy = _FakeDb(stored_cursor=json.dumps([1, 2]))
    assert await _store(listy).get_activity_cursor(_OWNER) is None


async def test_append_with_cursor_writes_lines_and_cursor_in_one_transaction() -> None:
    db = _FakeDb()
    await _store(db).append_with_cursor(_OWNER, ["deposited 500.00 USDC into the vault"], _CURSOR)
    args = next(a for sql, a in db.calls if "INSERT INTO user_memory" in sql)
    assert json.loads(args[1])[0]["line"].startswith("deposited")
    assert json.loads(args[2]) == _CURSOR
    # Both writes happened via the SAME acquired connection (transactional unit).
    assert any("FOR UPDATE" in sql and "activity_cursor" in sql for sql, _ in db.calls)


async def test_append_with_cursor_accepts_zero_lines_and_still_advances() -> None:
    # A fold whose events all deduped away must still move the high-water mark.
    db = _FakeDb()
    await _store(db).append_with_cursor(_OWNER, [], _CURSOR)
    args = next(a for sql, a in db.calls if "INSERT INTO user_memory" in sql)
    assert json.loads(args[1]) == []
    assert json.loads(args[2]) == _CURSOR


async def test_append_with_cursor_folds_onto_existing_lines_and_caps() -> None:
    db = _FakeDb(stored=_entries(*[f"old {i}" for i in range(MAX_MEMORY_LINES)]))
    await _store(db).append_with_cursor(_OWNER, ["fresh"], _CURSOR)
    args = next(a for sql, a in db.calls if "INSERT INTO user_memory" in sql)
    lines = [e["line"] for e in json.loads(args[1])]
    assert len(lines) == MAX_MEMORY_LINES
    assert lines[-1] == "fresh" and lines[0] == "old 1"


async def test_cursor_payload_reaches_the_driver_as_raw_utf8_never_escapes() -> None:
    # SQL_ASCII regression guard (the 025/#125 lesson) applied to the NEW jsonb writer.
    db = _FakeDb()
    cursor = {"v": 1, "note": "em-dash — survives"}
    line = "made a token swap (~1,000.00 USDC — big)"
    await _store(db).append_with_cursor(_OWNER, [line], cursor)
    args = next(a for sql, a in db.calls if "INSERT INTO user_memory" in sql)
    assert "\\u" not in args[1] and "—" in args[1]
    assert "\\u" not in args[2] and "—" in args[2]


async def test_pre_0031_column_disables_the_fold_with_one_warning(
    caplog: pytest.LogCaptureFixture,
) -> None:
    from sparkpoint_agent.db.user_memory import FoldColumnMissing

    with caplog.at_level(logging.WARNING, logger=user_memory_module.__name__):
        for _ in range(3):
            with pytest.raises(FoldColumnMissing):
                await _store(_PreColumnDb()).get_activity_cursor(_OWNER)
    hits = [r for r in caplog.records if "user_memory_fold_column_missing" in r.getMessage()]
    assert len(hits) == 1
    assert "0031" in hits[0].getMessage()


async def test_pre_0030_table_also_reads_as_fold_disabled() -> None:
    from sparkpoint_agent.db.user_memory import FoldColumnMissing

    class _NoTable(_FakeDb):
        async def fetchval(self, sql: str, *args: Any) -> Any:
            raise UndefinedTableError('relation "user_memory" does not exist')

    with pytest.raises(FoldColumnMissing):
        await _store(_NoTable()).get_activity_cursor(_OWNER)
