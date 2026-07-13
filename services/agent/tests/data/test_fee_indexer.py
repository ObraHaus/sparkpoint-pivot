# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""T110 fee indexer — decoders, idempotent replay, VR-FE2/FE4 checks, aggregate, isolation.

Everything runs against MOCKED events + an in-memory FeeEventStore (no live vault / DB):
  - the decoders round-trip against the REAL eth-abi codec (reconstructable-from-chain);
  - replaying the same batch twice yields exactly one row per event (idempotent);
  - VR-FE2 reconciliation flags drift + the >2000 bps hard-cap breach (fail-open: the
    over-cap row is DROPPED, never crashes);
  - VR-FE4 monotonic-HWM breach is flagged + dropped; hwm_before comes from the paired
    HighWaterMarkUpdated;
  - the aggregate reports cumulative + per-period revenue and current rate/HWM;
  - the module is import-isolated from policy/ and never on the withdraw path (VR-FE3).
"""

from __future__ import annotations

import ast
import pathlib
from datetime import UTC, datetime, timedelta

from eth_abi import encode as abi_encode

from sparkpoint_agent.data.fee_indexer import (
    MAX_PERFORMANCE_FEE_BPS,
    FeeEventRow,
    FeeIndexer,
    FeeRateUpdated,
    HighWaterMarkUpdated,
    LogMeta,
    PerformanceFeeAccrued,
    RiskKind,
    decode_fee_rate_updated,
    decode_high_water_mark_updated,
    decode_performance_fee_accrued,
)

_NET = "base"
_VAULT = "0x00000000000000000000000000000000000000aa"
_RECIPIENT = "0x1111111111111111111111111111111111111111"
_SCALE = 10**18
_T0 = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)


# ─────────────────────────────────────────────────────────────────────────────
# In-memory FeeEventStore (faithful to the SQL semantics: ON CONFLICT DO NOTHING,
# window filter, ordered fetch). The concrete PgFeeEventStore is syntax-checked
# out-of-band against an ephemeral Postgres — never the live DB.
# ─────────────────────────────────────────────────────────────────────────────


class FakeStore:
    def __init__(self) -> None:
        self.rows: dict[tuple[str, bytes, int], FeeEventRow] = {}
        self.risks: list = []
        self.cursors: dict[tuple[str, str], int] = {}

    async def insert_fee_event(self, row: FeeEventRow) -> bool:
        key = (row.network_id, row.tx_hash, row.log_index)
        if key in self.rows:
            return False  # ON CONFLICT DO NOTHING
        self.rows[key] = row
        return True

    async def record_risk_event(self, risk) -> None:
        self.risks.append(risk)

    async def get_cursor(self, network_id: str, stream: str) -> int:
        return self.cursors.get((network_id, stream), 0)

    async def set_cursor(self, network_id: str, stream: str, block: int) -> None:
        self.cursors[(network_id, stream)] = block

    async def fetch_fee_events(
        self, network_id, vault_address, *, since=None, until=None
    ) -> list[FeeEventRow]:
        rows = [
            r
            for r in self.rows.values()
            if r.network_id == network_id
            and r.vault_address == vault_address
            and (since is None or r.block_time >= since)
            and (until is None or r.block_time < until)
        ]
        return sorted(rows, key=lambda r: (r.block_number, r.log_index))


class FakeStateReader:
    def __init__(self, rate: int, hwm: int) -> None:
        self._rate = rate
        self._hwm = hwm

    async def performance_fee_bps(self) -> int:
        return self._rate

    async def high_water_mark(self) -> int:
        return self._hwm


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures: build an on-chain-faithful accrual (feeShares s.t. it reconciles).
# ─────────────────────────────────────────────────────────────────────────────


def _meta(block: int, log_index: int, tx: bytes, *, when: datetime | None = None) -> LogMeta:
    return LogMeta(
        network_id=_NET,
        block_number=block,
        block_time=when or _T0,
        tx_hash=tx,
        log_index=log_index,
    )


def _reconciling_fee_shares(yield_assets: int, rate_bps: int, hwm_after: int) -> int:
    """feeShares whose claim at ``hwm_after`` ≈ rate×yield (mirrors accrueFee round-down)."""
    fee_assets = (yield_assets * rate_bps) // 10_000
    return (fee_assets * _SCALE) // hwm_after


def _accrual_pair(
    *,
    block: int,
    tx: bytes,
    log_index: int,
    rate_bps: int,
    yield_assets: int,
    hwm_before: int,
    hwm_after: int,
    when: datetime | None = None,
    trigger: str | None = None,
    fee_shares: int | None = None,
) -> tuple[PerformanceFeeAccrued, HighWaterMarkUpdated]:
    shares = fee_shares if fee_shares is not None else _reconciling_fee_shares(
        yield_assets, rate_bps, hwm_after
    )
    accrued = PerformanceFeeAccrued(
        meta=_meta(block, log_index, tx, when=when),
        fee_recipient=_RECIPIENT,
        fee_shares=shares,
        yield_assets=yield_assets,
        new_high_water_mark=hwm_after,
        trigger_kind=trigger,
    )
    paired = HighWaterMarkUpdated(
        meta=_meta(block, log_index + 1, tx, when=when),
        old_high_water_mark=hwm_before,
        new_high_water_mark=hwm_after,
    )
    return accrued, paired


# ─────────────────────────────────────────────────────────────────────────────
# Decoders (reconstruct-from-chain, pure eth-abi, keccak-free)
# ─────────────────────────────────────────────────────────────────────────────


def test_decode_performance_fee_accrued_round_trip() -> None:
    topic1 = "0x" + abi_encode(["address"], [_RECIPIENT]).hex()
    data = "0x" + abi_encode(["uint256", "uint256", "uint256"], [123, 456, 789]).hex()
    ev = decode_performance_fee_accrued(
        topics=["0xdeadbeef", topic1],
        data=data,
        meta=_meta(10, 2, b"\x01" * 32),
        trigger_kind="deposit",
    )
    assert ev.fee_recipient == _RECIPIENT  # lowercased 0x
    assert (ev.fee_shares, ev.yield_assets, ev.new_high_water_mark) == (123, 456, 789)
    assert ev.trigger_kind == "deposit"


def test_decode_high_water_mark_and_fee_rate() -> None:
    hwm_data = "0x" + abi_encode(["uint256", "uint256"], [_SCALE, 2 * _SCALE]).hex()
    hwm = decode_high_water_mark_updated(data=hwm_data, meta=_meta(1, 0, b"\x02" * 32))
    assert (hwm.old_high_water_mark, hwm.new_high_water_mark) == (_SCALE, 2 * _SCALE)

    rate_data = "0x" + abi_encode(["uint16", "uint16"], [1000, 1500]).hex()
    rate = decode_fee_rate_updated(data=rate_data, meta=_meta(1, 0, b"\x03" * 32))
    assert (rate.old_rate_bps, rate.new_rate_bps) == (1000, 1500)


def test_decode_rejects_accrual_without_indexed_topic() -> None:
    data = "0x" + abi_encode(["uint256", "uint256", "uint256"], [1, 1, 1]).hex()
    meta = _meta(1, 0, b"\x04" * 32)
    try:
        decode_performance_fee_accrued(topics=["0xonlytopic0"], data=data, meta=meta)
    except ValueError:
        return
    raise AssertionError("expected ValueError for a missing indexed feeRecipient topic")


# ─────────────────────────────────────────────────────────────────────────────
# Replay: happy path + hwm_before pairing
# ─────────────────────────────────────────────────────────────────────────────


async def test_indexes_accrual_and_pairs_hwm_before() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    accrued, paired = _accrual_pair(
        block=100, tx=b"\xaa" * 32, log_index=4, rate_bps=1000,
        yield_assets=5_000_000, hwm_before=_SCALE, hwm_after=(_SCALE * 105) // 100,
        trigger="deposit",
    )
    result = await indexer.index(_NET, _VAULT, [accrued, paired], as_of_block=120)

    assert result.inserted == 1
    assert result.dropped == 0
    assert not result.risk_events
    (row,) = store.rows.values()
    assert row.hwm_before_ray == _SCALE  # taken from the paired HighWaterMarkUpdated.oldHWM
    assert row.hwm_after_ray == (_SCALE * 105) // 100
    assert row.fee_rate_bps_at_event == 1000
    assert row.trigger_kind == "deposit"
    assert row.vault_address == _VAULT.lower()
    assert store.cursors[(_NET, "vault_fee")] == 120  # cursor advanced to the head


async def test_standalone_hwm_update_produces_no_row() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    settle = HighWaterMarkUpdated(
        meta=_meta(50, 0, b"\xbb" * 32), old_high_water_mark=_SCALE, new_high_water_mark=2 * _SCALE
    )
    result = await indexer.index(_NET, _VAULT, [settle], as_of_block=60)
    assert result.inserted == 0
    assert not store.rows


# ─────────────────────────────────────────────────────────────────────────────
# Idempotent replay (VR-FE4): same batch twice ⇒ one row
# ─────────────────────────────────────────────────────────────────────────────


async def test_idempotent_replay_same_event_twice_one_row() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    batch = list(
        _accrual_pair(
            block=10, tx=b"\xcc" * 32, log_index=1, rate_bps=1000,
            yield_assets=3_000_000, hwm_before=_SCALE, hwm_after=(_SCALE * 102) // 100,
        )
    )
    first = await indexer.index(_NET, _VAULT, batch, as_of_block=20)
    second = await indexer.index(_NET, _VAULT, batch, as_of_block=20)

    assert first.inserted == 1
    assert second.inserted == 0
    assert second.skipped == 1  # ON CONFLICT DO NOTHING
    assert len(store.rows) == 1


# ─────────────────────────────────────────────────────────────────────────────
# VR-FE2 reconciliation
# ─────────────────────────────────────────────────────────────────────────────


async def test_reconciling_accrual_raises_no_drift() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    accrued, paired = _accrual_pair(
        block=1, tx=b"\xd0" * 32, log_index=0, rate_bps=1500,
        yield_assets=12_345_678, hwm_before=_SCALE, hwm_after=(_SCALE * 111) // 100,
    )
    # Seed the rate in effect (1500 bps) that the shares were minted against.
    result = await indexer.index(
        _NET, _VAULT, [accrued, paired], as_of_block=5, initial_rate_bps=1500
    )
    assert result.inserted == 1
    assert not any(r.kind is RiskKind.FEE_RECONCILE_DRIFT for r in result.risk_events)


async def test_drifted_fee_shares_flag_risk_but_still_index() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    # 100x too many fee shares for the stated yield/rate ⇒ well beyond the rounding tolerance.
    good = _reconciling_fee_shares(4_000_000, 1000, (_SCALE * 103) // 100)
    accrued, paired = _accrual_pair(
        block=2, tx=b"\xd1" * 32, log_index=0, rate_bps=1000,
        yield_assets=4_000_000, hwm_before=_SCALE, hwm_after=(_SCALE * 103) // 100,
        fee_shares=good * 100,
    )
    result = await indexer.index(_NET, _VAULT, [accrued, paired], as_of_block=5)

    assert result.inserted == 1  # display/derived: the row is STILL indexed
    drift = [r for r in result.risk_events if r.kind is RiskKind.FEE_RECONCILE_DRIFT]
    assert len(drift) == 1
    assert drift[0] in store.risks  # persisted to the audit side-channel


# ─────────────────────────────────────────────────────────────────────────────
# Hard-cap enforcement (VR-FE2 / VR-V1a): rate > 2000 bps
# ─────────────────────────────────────────────────────────────────────────────


async def test_fee_rate_over_cap_is_critical_and_row_dropped() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    tx = b"\xe0" * 32
    # A FeeRateUpdated to 2500 bps (impossible on-chain — the vault reverts) then an accrual.
    rate_bump = FeeRateUpdated(meta=_meta(3, 0, tx), old_rate_bps=1000, new_rate_bps=2500)
    accrued, paired = _accrual_pair(
        block=3, tx=tx, log_index=1, rate_bps=2500,
        yield_assets=1_000_000, hwm_before=_SCALE, hwm_after=2 * _SCALE,
    )
    result = await indexer.index(_NET, _VAULT, [rate_bump, accrued, paired], as_of_block=5)

    assert result.dropped == 1  # fail-open: the over-cap row is never written
    assert result.inserted == 0
    assert not store.rows
    over_cap = [r for r in result.risk_events if r.kind is RiskKind.FEE_RATE_OVER_CAP]
    assert over_cap and all(r.critical for r in over_cap)
    assert MAX_PERFORMANCE_FEE_BPS == 2000


async def test_rate_at_cap_boundary_is_allowed() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    tx = b"\xe1" * 32
    rate_bump = FeeRateUpdated(meta=_meta(4, 0, tx), old_rate_bps=1000, new_rate_bps=2000)
    accrued, paired = _accrual_pair(
        block=4, tx=tx, log_index=1, rate_bps=2000,
        yield_assets=2_000_000, hwm_before=_SCALE, hwm_after=(_SCALE * 108) // 100,
    )
    result = await indexer.index(_NET, _VAULT, [rate_bump, accrued, paired], as_of_block=5)
    assert result.inserted == 1
    assert result.dropped == 0
    (row,) = store.rows.values()
    assert row.fee_rate_bps_at_event == 2000


# ─────────────────────────────────────────────────────────────────────────────
# VR-FE4 monotonic HWM + unpaired accrual
# ─────────────────────────────────────────────────────────────────────────────


async def test_hwm_retreat_is_dropped_and_flagged() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    tx = b"\xf0" * 32
    accrued = PerformanceFeeAccrued(
        meta=_meta(6, 0, tx), fee_recipient=_RECIPIENT, fee_shares=1, yield_assets=1,
        new_high_water_mark=_SCALE,  # after < before ⇒ retreat
    )
    paired = HighWaterMarkUpdated(
        meta=_meta(6, 1, tx), old_high_water_mark=2 * _SCALE, new_high_water_mark=_SCALE
    )
    result = await indexer.index(_NET, _VAULT, [accrued, paired], as_of_block=10)
    assert result.dropped == 1
    assert not store.rows
    assert any(r.kind is RiskKind.HWM_RETREAT for r in result.risk_events)


async def test_unpaired_accrual_falls_back_and_flags() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    tx = b"\xf1" * 32
    accrued, _paired = _accrual_pair(
        block=7, tx=tx, log_index=0, rate_bps=1000,
        yield_assets=2_000_000, hwm_before=_SCALE, hwm_after=(_SCALE * 104) // 100,
    )
    # Feed the accrual WITHOUT its paired HighWaterMarkUpdated; seed the running HWM.
    result = await indexer.index(
        _NET, _VAULT, [accrued], as_of_block=10, initial_hwm_ray=_SCALE
    )
    assert result.inserted == 1
    (row,) = store.rows.values()
    assert row.hwm_before_ray == _SCALE  # fell back to the running HWM
    assert any(r.kind is RiskKind.UNPAIRED_ACCRUAL for r in result.risk_events)


# ─────────────────────────────────────────────────────────────────────────────
# Aggregate (admin revenue dashboard)
# ─────────────────────────────────────────────────────────────────────────────


async def _seed_three_days(indexer: FeeIndexer) -> None:
    logs: list = []
    for i in range(3):
        when = _T0 + timedelta(days=i)
        a, p = _accrual_pair(
            block=100 + i, tx=bytes([0x20 + i]) * 32, log_index=0, rate_bps=1000,
            yield_assets=1_000_000 * (i + 1), hwm_before=_SCALE + i, hwm_after=_SCALE + i + 10,
            when=when,
        )
        logs.extend([a, p])
    await indexer.index(_NET, _VAULT, logs, as_of_block=200)


async def test_revenue_summary_cumulative_and_per_period() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store, current_state=FakeStateReader(rate=1000, hwm=_SCALE + 42))
    await _seed_three_days(indexer)

    summary = await indexer.revenue_summary(_NET, _VAULT, period="day")

    assert summary.event_count == 3
    assert summary.cumulative_yield_realized_raw == 1_000_000 + 2_000_000 + 3_000_000
    expected_shares = sum(r.fee_shares_minted_raw for r in store.rows.values())
    assert summary.cumulative_fee_shares_minted_raw == expected_shares
    assert len(summary.periods) == 3  # one bucket per day
    assert [p.event_count for p in summary.periods] == [1, 1, 1]
    assert summary.periods[0].period_start == _T0.replace(hour=0, minute=0)
    # current rate/HWM come from the live reader when injected.
    assert summary.current_fee_rate_bps == 1000
    assert summary.current_high_water_mark_ray == _SCALE + 42
    assert summary.first_event_time == _T0
    assert summary.last_event_time == _T0 + timedelta(days=2)


async def test_revenue_summary_month_bucket_and_derived_current_state() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)  # no live reader ⇒ derive current rate/HWM from latest row
    await _seed_three_days(indexer)

    summary = await indexer.revenue_summary(_NET, _VAULT, period="month")
    assert len(summary.periods) == 1  # all three days fall in one month
    assert summary.periods[0].event_count == 3
    # derived from the most recent ledger row.
    latest = max(store.rows.values(), key=lambda r: (r.block_number, r.log_index))
    assert summary.current_fee_rate_bps == latest.fee_rate_bps_at_event
    assert summary.current_high_water_mark_ray == latest.hwm_after_ray


async def test_revenue_summary_window_filter() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    await _seed_three_days(indexer)
    # Window excludes day 0.
    summary = await indexer.revenue_summary(
        _NET, _VAULT, since=_T0 + timedelta(hours=12), period="day"
    )
    assert summary.event_count == 2
    assert summary.cumulative_yield_realized_raw == 2_000_000 + 3_000_000


async def test_empty_summary_is_clean() -> None:
    store = FakeStore()
    indexer = FeeIndexer(store)
    summary = await indexer.revenue_summary(_NET, _VAULT)
    assert summary.event_count == 0
    assert summary.cumulative_fee_shares_minted_raw == 0
    assert summary.periods == ()
    assert summary.current_fee_rate_bps is None
    assert summary.first_event_time is None


# ─────────────────────────────────────────────────────────────────────────────
# NON-CUSTODY: import isolation from policy/ + never on the withdraw path (VR-FE3)
# ─────────────────────────────────────────────────────────────────────────────

_SRC_ROOT = pathlib.Path(__file__).resolve().parents[2] / "src" / "sparkpoint_agent"


def _module_imports(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
            # normalise a relative "from ..policy import X" (level>0) to its tail too.
    return names


def test_fee_indexer_does_not_import_policy_llm_or_knowledge() -> None:
    """The display/derived indexer must stay off the deterministic decision path (VR-FE3)."""
    imports = _module_imports(_SRC_ROOT / "data" / "fee_indexer.py")
    forbidden = ("policy", "llm", "knowledge", "anthropic", "memory")
    for name in imports:
        assert not any(
            token == name or name.endswith(f".{token}") or f".{token}." in f".{name}."
            for token in forbidden
        ), f"fee_indexer imports forbidden module: {name}"


def test_policy_package_does_not_import_the_data_indexer() -> None:
    """policy/ must never import data/ (the withdraw path can't depend on the fee index)."""
    policy_dir = _SRC_ROOT / "policy"
    for py in policy_dir.rglob("*.py"):
        imports = _module_imports(py)
        for name in imports:
            assert "data" != name.split(".")[-1] or "fee_indexer" not in name, (
                f"{py.name} imports the data/fee_indexer path"
            )
        # Hard rule: no policy module may reference the fee_indexer at all.
        assert "fee_indexer" not in py.read_text(), f"{py.name} references fee_indexer"


def test_indexer_public_surface_has_no_withdraw_or_signing_capability() -> None:
    """Sanity: the indexer exposes only read/replay/aggregate — no fund-moving verbs."""
    import sparkpoint_agent.data.fee_indexer as mod

    banned = {"withdraw", "redeem", "sign", "deposit_funds", "transfer", "approve"}
    public = {n for n in dir(mod) if not n.startswith("_")}
    assert public.isdisjoint(banned)
