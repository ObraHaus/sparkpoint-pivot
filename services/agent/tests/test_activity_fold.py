# ruff: noqa: S101
"""028 · the fold orchestrator (activity_fold.py) — fake stores, no live DB.

Covers the US1 contract: a manual vault flow folds exactly once with the right line and cursor
advance; nothing new ⇒ no write; failures skip the source or surface as FoldResult.error —
never a raise.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any, cast

from sparkpoint_agent.activity_fold import ActivityFolder, FoldResult, fold_activity
from sparkpoint_agent.db.user_memory import FoldColumnMissing, MemoryStore
from sparkpoint_agent.db.vault_flows import FlowRow, VaultFlowReader

_OWNER = "0xOwner0000000000000000000000000000000001"
_ACCOUNT = _OWNER  # identical today (BFF sets both from the session address)
_VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
_AT = datetime(2026, 8, 1, 10, 30, tzinfo=UTC)


class _FakeMemory:
    """MemoryStore stand-in recording appends; canned cursor."""

    def __init__(self, cursor: dict[str, Any] | None = None, *, column_missing: bool = False):
        self.cursor = cursor
        self.column_missing = column_missing
        self.appends: list[tuple[list[str], dict[str, Any]]] = []

    async def get_activity_cursor(self, owner: str) -> dict[str, Any] | None:
        if self.column_missing:
            raise FoldColumnMissing
        return self.cursor

    async def append_with_cursor(
        self, owner: str, lines: Any, cursor: dict[str, Any]
    ) -> None:
        self.appends.append((list(lines), cursor))
        self.cursor = cursor


class _FakeFlows:
    def __init__(self, rows: list[FlowRow] | None = None, *, boom: bool = False):
        self.rows = rows or []
        self.boom = boom
        self.calls: list[tuple[str, str, str, tuple[int, int] | None]] = []

    async def list_flows_since(
        self,
        network_id: str,
        vault: str,
        owner: str,
        after: tuple[int, int] | None,
        limit: int = 25,
    ) -> list[FlowRow]:
        self.calls.append((network_id, vault, owner, after))
        if self.boom:
            raise RuntimeError("indexer db down")
        if after is None:
            return self.rows
        return [r for r in self.rows if (r.block_number, r.log_index) > after]


def _deposit(block: int = 100, assets: int = 500_000_000, tx: str = "0x" + "ab" * 32) -> FlowRow:
    return FlowRow(
        kind="deposit",
        assets=assets,
        shares=assets,
        block_number=block,
        log_index=0,
        tx_hash=tx,
        created_at=_AT,
    )


def _folder(memory: _FakeMemory, flows: _FakeFlows) -> ActivityFolder:
    return ActivityFolder(
        memory=cast(MemoryStore, memory),
        flows=cast(VaultFlowReader, flows),
        flow_targets=(("base", _VAULT),),
    )


async def test_a_manual_deposit_folds_with_line_and_cursor() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    result = await fold_activity(
        _folder(memory, _FakeFlows([_deposit()])), owner=_OWNER, account=_ACCOUNT
    )
    assert result.error is None and result.folded == 1
    lines, cursor = memory.appends[0]
    assert lines == ["deposited 500.00 USDC into the vault (yourself, Aug 1)"]
    assert cursor["flows"]["base"] == {"block": 100, "log": 0}


async def test_first_fold_is_marked_and_jumps_cursor_to_head() -> None:
    memory = _FakeMemory(cursor=None)
    rows = [_deposit(block=100 + i, tx=f"0x{i:064x}") for i in range(8)]
    result = await fold_activity(
        _folder(memory, _FakeFlows(rows)), owner=_OWNER, account=_ACCOUNT
    )
    assert result.first_fold and result.folded == 5  # K=5 sample
    _, cursor = memory.appends[0]
    assert cursor["flows"]["base"] == {"block": 107, "log": 0}


async def test_nothing_new_means_no_write_at_all() -> None:
    memory = _FakeMemory(cursor={"v": 1, "flows": {"base": {"block": 100, "log": 0}}})
    result = await fold_activity(
        _folder(memory, _FakeFlows([_deposit(block=100)])), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 0 and memory.appends == []


async def test_refolding_after_the_cursor_advanced_adds_nothing() -> None:
    # Exactly-once (SC-004): fold, then fold again with the SAME store state.
    memory = _FakeMemory(cursor={"v": 1})
    flows = _FakeFlows([_deposit()])
    first = await fold_activity(_folder(memory, flows), owner=_OWNER, account=_ACCOUNT)
    assert first.folded == 1
    second = await fold_activity(_folder(memory, flows), owner=_OWNER, account=_ACCOUNT)
    assert second.folded == 0 and len(memory.appends) == 1


async def test_a_failing_source_is_skipped_never_raised() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    result = await fold_activity(
        _folder(memory, _FakeFlows(boom=True)), owner=_OWNER, account=_ACCOUNT
    )
    assert result.error is None
    assert result.skipped_sources == ("flows:base",)
    assert memory.appends == []


async def test_missing_0031_column_disables_the_fold() -> None:
    memory = _FakeMemory(column_missing=True)
    result = await fold_activity(
        _folder(memory, _FakeFlows([_deposit()])), owner=_OWNER, account=_ACCOUNT
    )
    assert result.disabled and result.folded == 0


async def test_an_unexpected_explosion_returns_error_never_raises() -> None:
    class _EvilMemory(_FakeMemory):
        async def get_activity_cursor(self, owner: str) -> dict[str, Any] | None:
            raise ValueError("totally unexpected")

    result = await fold_activity(
        _folder(_EvilMemory(), _FakeFlows()), owner=_OWNER, account=_ACCOUNT
    )
    assert isinstance(result.error, ValueError)


async def test_result_is_json_serializable_free_of_surprises() -> None:
    # The FoldResult travels only in-process, but keep its shape boring on purpose.
    result = FoldResult(folded=2, skipped_sources=("flows:base",))
    assert json.dumps(
        {"folded": result.folded, "skipped": list(result.skipped_sources)}
    )
