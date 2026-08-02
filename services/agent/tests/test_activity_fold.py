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


# ── US2 · executions: via-Sparky labeling, reverted, deferred-pending ───────────

_E1 = "11111111-1111-1111-1111-1111111111e1"


class _FakeExecs:
    def __init__(self, rows: list[Any] | None = None, *, boom: bool = False):
        self.rows = rows or []
        self.boom = boom

    async def list_by_account_since(
        self, account: str, after_ts: Any, deferred_ids: Any, limit: int = 25
    ) -> list[Any]:
        if self.boom:
            raise RuntimeError("executions db down")
        deferred = {str(d) for d in deferred_ids}
        return [
            r
            for r in self.rows
            if r.created_at > after_ts or str(r.id) in deferred
        ]


def _exec_row(
    rid: str,
    status: str = "confirmed",
    tx: str | None = "0x" + "ab" * 32,
    at: datetime | None = None,
    kind: str = "vault_deposit",
) -> Any:
    from dataclasses import dataclass as _dc

    @_dc
    class _Row:
        id: str
        action_kind: str
        status: str
        tx_hash: str | None
        created_at: datetime

    return _Row(id=rid, action_kind=kind, status=status, tx_hash=tx, created_at=at or _AT)


def _folder2(memory: _FakeMemory, flows: _FakeFlows, execs: _FakeExecs) -> ActivityFolder:
    folder = _folder(memory, flows)
    folder.executions = execs  # type: ignore[assignment]
    return folder


async def test_flow_with_matching_exec_folds_once_via_sparky() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    tx = "0x" + "ab" * 32
    result = await fold_activity(
        _folder2(memory, _FakeFlows([_deposit(tx=tx)]), _FakeExecs([_exec_row(_E1, tx=tx)])),
        owner=_OWNER,
        account=_ACCOUNT,
    )
    assert result.folded == 1
    lines, cursor = memory.appends[0]
    assert lines == ["deposited 500.00 USDC into the vault (via Sparky's plan, Aug 1)"]
    assert cursor["execs"]["deferred"] == []


async def test_exec_only_kind_folds_standalone() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    row = _exec_row(_E1, kind="session_key_grant", tx=None)
    result = await fold_activity(
        _folder2(memory, _FakeFlows(), _FakeExecs([row])), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 1
    assert memory.appends[0][0] == ["granted a session key (via Sparky's plan, Aug 1)"]


async def test_reverted_exec_folds_the_gentle_line() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    row = _exec_row(_E1, status="reverted", kind="vault_withdraw", tx="0x" + "cd" * 32)
    result = await fold_activity(
        _folder2(memory, _FakeFlows(), _FakeExecs([row])), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 1
    assert memory.appends[0][0] == [
        "a vault withdrawal you signed didn't go through (reverted, Aug 1)"
    ]


async def test_pending_exec_defers_then_folds_exactly_once_when_terminal() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    pending = _exec_row(_E1, status="submitted")
    execs = _FakeExecs([pending])
    first = await fold_activity(
        _folder2(memory, _FakeFlows(), execs), owner=_OWNER, account=_ACCOUNT
    )
    assert first.folded == 0, "pending must not fold yet"
    _, cursor = memory.appends[0]
    assert cursor["execs"]["deferred"] == [_E1], "…but it is carried, not lost"
    # The row terminalizes; created_at is now BEHIND ts, so only the deferred carry finds it.
    execs.rows = [_exec_row(_E1, status="confirmed")]
    second = await fold_activity(
        _folder2(memory, _FakeFlows(), execs), owner=_OWNER, account=_ACCOUNT
    )
    assert second.folded == 1
    lines, cursor2 = memory.appends[1]
    assert lines == ["made a vault deposit (via Sparky's plan, Aug 1)"]
    assert cursor2["execs"]["deferred"] == []
    third = await fold_activity(
        _folder2(memory, _FakeFlows(), execs), owner=_OWNER, account=_ACCOUNT
    )
    assert third.folded == 0 and len(memory.appends) == 2, "exactly once"


async def test_skip_forever_statuses_advance_silently_and_never_fold() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    rows = [_exec_row(f"11111111-1111-1111-1111-1111111111a{i}", status=s) for i, s in enumerate(
        ["built", "policy_rejected", "declined", "dropped"]
    )]
    execs = _FakeExecs(rows)
    result = await fold_activity(
        _folder2(memory, _FakeFlows(), execs), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 0
    _, cursor = memory.appends[0]
    assert cursor["execs"]["deferred"] == []
    again = await fold_activity(
        _folder2(memory, _FakeFlows(), execs), owner=_OWNER, account=_ACCOUNT
    )
    assert again.folded == 0 and len(memory.appends) == 1, "ts advanced past skip rows"


async def test_a_failing_exec_source_skips_without_touching_its_cursor() -> None:
    sub = {"ts": "2026-08-01T00:00:00+00:00", "deferred": []}
    memory = _FakeMemory(cursor={"v": 1, "execs": dict(sub)})
    result = await fold_activity(
        _folder2(memory, _FakeFlows([_deposit()]), _FakeExecs(boom=True)),
        owner=_OWNER,
        account=_ACCOUNT,
    )
    assert result.folded == 1 and "execs" in result.skipped_sources
    _, cursor = memory.appends[0]
    assert cursor["execs"] == sub, "untouched"


# ── US3 · swaps + faucet ────────────────────────────────────────────────────────


class _FakeSwaps:
    def __init__(self, rows_by_net: dict[str, list[Any]] | None = None, *, boom: bool = False):
        self.rows_by_net = rows_by_net or {}
        self.boom = boom

    async def list_for_swapper(
        self, network_id: str, swapper: str, after: Any, limit: int = 25
    ) -> list[Any]:
        if self.boom:
            raise RuntimeError("swaps db down")
        rows = self.rows_by_net.get(network_id, [])
        if after is None:
            return rows
        return [r for r in rows if (r.block_number, r.log_index) > after]


_USDC = "0xba50cd2a20f6da35d788639e581bca8d0b5d4d5f"


class _FakeProbe:
    def __init__(self, last: datetime | None):
        self.last = last

    async def last_claim_at(self, owner: str) -> datetime | None:
        return self.last


def _swap_row(block: int = 200, fee: int = 2_000_000, token: str = _USDC) -> Any:
    from dataclasses import dataclass as _dc

    @_dc
    class _Row:
        block_number: int
        log_index: int
        block_time: datetime
        token_address: str
        token_decimals: int
        fee_value_raw: int
        tx_hash: str

    return _Row(
        block_number=block,
        log_index=1,
        block_time=_AT,
        token_address=token,
        token_decimals=6,
        fee_value_raw=fee,
        tx_hash="0x" + "ee" * 32,
    )



def _folder3(
    memory: _FakeMemory,
    swaps: _FakeSwaps | None = None,
    probe: _FakeProbe | None = None,
) -> ActivityFolder:
    folder = _folder(memory, _FakeFlows())
    folder.swaps = swaps  # type: ignore[assignment]
    folder.swap_networks = ("base", "robinhood") if swaps else ()
    folder.usdc_by_network = {"base": _USDC}
    folder.faucet_probe = probe  # type: ignore[assignment]
    return folder


async def test_a_usdc_swap_folds_with_approximate_notional() -> None:
    # fee 2 USDC × 500 = ~1,000 USDC notional
    memory = _FakeMemory(cursor={"v": 1})
    result = await fold_activity(
        _folder3(memory, _FakeSwaps({"base": [_swap_row()]})), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 1
    lines, cursor = memory.appends[0]
    assert lines == ["made a token swap (~1,000.00 USDC, Aug 1)"]
    assert cursor["swaps"]["base"] == {"block": 200, "log": 1}


async def test_an_unknown_token_swap_renders_unitless() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    row = _swap_row(token="0x" + "77" * 20)
    result = await fold_activity(
        _folder3(memory, _FakeSwaps({"base": [row]})), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 1
    assert memory.appends[0][0] == ["made a token swap (~1,000.00 tokens, Aug 1)"]


async def test_swaps_fold_per_network_with_independent_cursors() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    rows = {"base": [_swap_row(block=200)], "robinhood": [_swap_row(block=991)]}
    result = await fold_activity(
        _folder3(memory, _FakeSwaps(rows)), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 2
    _, cursor = memory.appends[0]
    assert cursor["swaps"]["base"] == {"block": 200, "log": 1}
    assert cursor["swaps"]["robinhood"] == {"block": 991, "log": 1}


async def test_a_faucet_claim_folds_once_and_only_once() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    probe = _FakeProbe(_AT)
    first = await fold_activity(_folder3(memory, probe=probe), owner=_OWNER, account=_ACCOUNT)
    assert first.folded == 1
    lines, cursor = memory.appends[0]
    assert lines == ["claimed test SRK from the faucet (Aug 1)"]
    assert cursor["faucet"] == _AT.isoformat()
    second = await fold_activity(_folder3(memory, probe=probe), owner=_OWNER, account=_ACCOUNT)
    assert second.folded == 0 and len(memory.appends) == 1


async def test_a_dead_probe_skips_the_source_cursor_untouched() -> None:
    memory = _FakeMemory(cursor={"v": 1, "faucet": "2026-07-01T00:00:00+00:00"})
    result = await fold_activity(
        _folder3(memory, probe=_FakeProbe(None)), owner=_OWNER, account=_ACCOUNT
    )
    assert result.folded == 0 and memory.appends == []


async def test_a_failing_swap_source_skips_that_network_only() -> None:
    memory = _FakeMemory(cursor={"v": 1})
    result = await fold_activity(
        _folder3(memory, _FakeSwaps(boom=True), probe=_FakeProbe(_AT)),
        owner=_OWNER,
        account=_ACCOUNT,
    )
    assert result.folded == 1, "the faucet line still folds"
    assert set(result.skipped_sources) == {"swaps:base", "swaps:robinhood"}
