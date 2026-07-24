# ruff: noqa: S101  (pytest asserts)
"""Edge-trigger unit tests for the phase-2 notification poller (api/notification_poller.py).

The poller is what makes caps / Aave-rate / new-recommendation notifications possible: they watch a
value that CHANGES over time, so — unlike the phase-1 derive-on-read rows — a poller must observe the
value each tick and emit a REAL event only on a genuine crossing, deduped so it never repeats. These
prove exactly that contract with in-memory fakes (no chain / RPC / DB / LLM):

  - a crossing emits once, and re-emits only after the value leaves and re-enters the band (no spam);
  - the first observation is a silent baseline (we never notify pre-existing state as if it were new);
  - every detector is fail-open (a degraded read emits nothing, never raises).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import pytest

from sparkpoint_agent.api import notification_poller as poller
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.db.notification_events import PollerState

# ── in-memory fakes ─────────────────────────────────────────────────────────────────


class StatefulStore:
    """A real edge-detection store in memory: dedupes emits by key and persists poller state, so a
    multi-tick sequence exercises the same get_state → compare → emit → set_state path production runs."""

    def __init__(self) -> None:
        self.emits: list[dict[str, Any]] = []
        self._state: dict[str, PollerState] = {}

    async def emit(self, *, dedupe_key: str, **fields: Any) -> bool:
        if any(e["dedupe_key"] == dedupe_key for e in self.emits):
            return False  # ON CONFLICT (dedupe_key) DO NOTHING
        self.emits.append({"dedupe_key": dedupe_key, **fields})
        return True

    async def get_state(self, key: str) -> PollerState | None:
        return self._state.get(key)

    async def set_state(self, key: str, *, num: int | None = None, txt: str | None = None) -> None:
        self._state[key] = PollerState(num=num, txt=txt)


_CAP = 1_000_000  # the vault's on-chain depositCap in this fixture → total_assets is directly the fill


class FakeVaultReader:
    def __init__(self, total: int, cap: int = _CAP) -> None:
        self._total = total
        self._cap = cap

    async def total_assets(self) -> int:
        return self._total

    async def deposit_cap(self) -> int:
        return self._cap


class RaisingVaultReader:
    async def deposit_cap(self) -> int:
        raise RuntimeError("rpc down")

    async def total_assets(self) -> int:
        raise RuntimeError("rpc down")


class FakeAave:
    def __init__(self, bps: int) -> None:
        self._bps = bps

    async def supply_apy_bps(self, asset: str) -> int:  # noqa: ARG002 — signature parity
        return self._bps


class RaisingAave:
    async def supply_apy_bps(self, asset: str) -> int:  # noqa: ARG002 — signature parity
        raise RuntimeError("rate read down")


# ── caps: emit on the up-crossing, once per episode ─────────────────────────────────


async def test_caps_emits_once_on_up_crossing_and_re_arms_after_leaving_band() -> None:
    store = StatefulStore()
    # Below 90% → nothing, baseline recorded.
    await poller.poll_caps(FakeVaultReader(500_000), store)  # 50%
    assert store.emits == []
    # Cross up to 92% → one event.
    await poller.poll_caps(FakeVaultReader(920_000), store)
    assert len(store.emits) == 1
    ev = store.emits[0]
    assert ev["category"] == "capsNearLimit"
    assert ev["type"] == "vault_near_capacity"
    assert ev["dedupe_key"] == "cap:vault:near:1"
    # Still near on the next tick → NO re-emit (edge-triggered, not level-triggered).
    await poller.poll_caps(FakeVaultReader(950_000), store)
    assert len(store.emits) == 1
    # Drops back below the band, then crosses again → a fresh event (new seq ⇒ new dedupe key).
    await poller.poll_caps(FakeVaultReader(400_000), store)
    await poller.poll_caps(FakeVaultReader(930_000), store)
    assert len(store.emits) == 2
    assert store.emits[1]["dedupe_key"] == "cap:vault:near:2"


async def test_caps_uncapped_vault_never_alerts() -> None:
    # depositCap 0 ⇒ uncapped ⇒ fill is 0 by the guard ⇒ never "near", even with big total_assets.
    store = StatefulStore()
    await poller.poll_caps(FakeVaultReader(9_999_999, cap=0), store)
    assert store.emits == []


async def test_caps_hysteresis_holds_through_boundary_churn() -> None:
    # The medium-severity fix: ordinary deposit/withdraw churn oscillating around the 90% line must
    # NOT re-fire the protocol-wide alert. The episode only re-arms after fill falls below 85%.
    store = StatefulStore()
    await poller.poll_caps(FakeVaultReader(500_000), store)  # baseline (50%)
    await poller.poll_caps(FakeVaultReader(910_000), store)  # 91% → emit near:1
    assert len(store.emits) == 1
    await poller.poll_caps(FakeVaultReader(880_000), store)  # 88% (in the 85–90 band) → hold, no emit
    await poller.poll_caps(FakeVaultReader(915_000), store)  # 91.5% → still armed → no emit
    await poller.poll_caps(FakeVaultReader(905_000), store)  # 90.5% → still armed → no emit
    assert len(store.emits) == 1  # boundary churn produced ZERO extra alerts
    await poller.poll_caps(FakeVaultReader(840_000), store)  # 84% (< 85%) → re-arm silently
    await poller.poll_caps(FakeVaultReader(920_000), store)  # 92% → emit near:2
    assert len(store.emits) == 2
    assert store.emits[1]["dedupe_key"] == "cap:vault:near:2"


async def test_caps_first_observation_already_full_is_silent() -> None:
    # A fresh deploy against an already-full vault must NOT alert on first sight (silent baseline),
    # consistent with poll_rate / poll_new_recs — but it must still ARM so a later crossing fires.
    store = StatefulStore()
    await poller.poll_caps(FakeVaultReader(920_000), store)  # first sight at 92% → baseline, no emit
    assert store.emits == []
    await poller.poll_caps(FakeVaultReader(800_000), store)  # 80% → re-arm (proves it baselined armed)
    await poller.poll_caps(FakeVaultReader(910_000), store)  # 91% → emit near:1
    assert len(store.emits) == 1
    assert store.emits[0]["dedupe_key"] == "cap:vault:near:1"


async def test_caps_fail_open_on_degraded_read() -> None:
    store = StatefulStore()
    await poller.poll_caps(RaisingVaultReader(), store)  # must not raise
    assert store.emits == []


# ── Aave rate: emit on a >= threshold move from the last notified level ──────────────


async def test_rate_baseline_then_emit_only_on_a_large_enough_move() -> None:
    store = StatefulStore()
    asset = "0xreserve"
    # First observation is a silent baseline (no pre-existing-state notification).
    await poller.poll_rate(FakeAave(430), asset, store)
    assert store.emits == []
    # A sub-threshold drift (10 bps < 25) → nothing, and the baseline is NOT reset...
    await poller.poll_rate(FakeAave(440), asset, store)
    assert store.emits == []
    # ...so a cumulative move that reaches the threshold from the baseline fires.
    await poller.poll_rate(FakeAave(460), asset, store)  # 30 bps from 430
    assert len(store.emits) == 1
    assert store.emits[0]["type"] == "rate_moved"
    assert store.emits[0]["dedupe_key"] == "rate:aave:1"
    # New level is 460; a further 10-bps wiggle stays quiet.
    await poller.poll_rate(FakeAave(470), asset, store)
    assert len(store.emits) == 1
    # A 30-bps drop from 460 fires again (monotonic seq ⇒ a fresh, unique dedupe key).
    await poller.poll_rate(FakeAave(430), asset, store)
    assert len(store.emits) == 2
    assert store.emits[1]["dedupe_key"] == "rate:aave:2"


async def test_rate_re_crossing_to_a_prior_value_still_notifies() -> None:
    # Regression: the emit key must carry a monotonic seq, else returning to a previously-notified bps
    # value would be swallowed forever by the UNIQUE(dedupe_key). Each genuine move must re-notify.
    store = StatefulStore()
    asset = "0xreserve"
    await poller.poll_rate(FakeAave(430), asset, store)  # baseline
    await poller.poll_rate(FakeAave(460), asset, store)  # +30 → emit seq 1
    await poller.poll_rate(FakeAave(430), asset, store)  # -30 → emit seq 2
    await poller.poll_rate(FakeAave(460), asset, store)  # +30 back to 460 → MUST emit (seq 3), not drop
    assert len(store.emits) == 3
    assert [e["dedupe_key"] for e in store.emits] == ["rate:aave:1", "rate:aave:2", "rate:aave:3"]


async def test_rate_fail_open_on_degraded_read() -> None:
    store = StatefulStore()
    await poller.poll_rate(RaisingAave(), "0xreserve", store)  # must not raise
    assert store.emits == []


# ── new recommendation: keyed on the stable SET of cleared strategy kinds ────────────


@dataclass
class _FakeItem:
    strategyKind: str
    title: str
    proposedAction: dict[str, Any]


def _item(kind: str, amount: str = "100") -> _FakeItem:
    return _FakeItem(kind, f"{kind} advice", {"type": "vault_deposit", "amount": amount})


def _patch_newrec_deps(monkeypatch: pytest.MonkeyPatch, item_lists: list[list[_FakeItem]]) -> None:
    """Stub the heavy collaborators poll_new_recs lazily imports, feeding one rec-LIST per call (the
    recommender returns the full cleared set — order is deliberately not meaningful to the detector)."""

    class _FakeMandateStore:
        def __init__(self, db: Any) -> None:
            self._db = db

        async def list_active_owners(  # noqa: ARG002
            self, *, network_id: str, limit: int, offset: int = 0
        ) -> list[str]:
            return [] if offset else ["0xOWNER0000000000000000000000000000000001"]

    class _FakeVaultReaderCls:
        @classmethod
        def from_config(cls, config: Any) -> _FakeVaultReaderCls:  # noqa: ARG003
            return cls()

    class _FakeLLM:
        @classmethod
        def from_env(cls) -> _FakeLLM:
            return cls()

    calls = {"n": 0}

    async def _fake_compute(account: Any, reader: Any, config: Any, llm: Any, provider: Any, *, limit: int):  # noqa: ARG001, ANN202
        i = min(calls["n"], len(item_lists) - 1)
        calls["n"] += 1
        return object(), list(item_lists[i])

    monkeypatch.setattr("sparkpoint_agent.db.mandates.PgMandateStore", _FakeMandateStore)
    monkeypatch.setattr("sparkpoint_agent.chain.VaultReader", _FakeVaultReaderCls)
    monkeypatch.setattr("sparkpoint_agent.llm.AsyncClaudeClient", _FakeLLM)
    monkeypatch.setattr("sparkpoint_agent.api.recommendations._compute", _fake_compute)


_CONFIG = AgentConfig(chain_id=8453, rpc_url=None, vault_address=None, database_url=None)
_OWNER = "0xOWNER0000000000000000000000000000000001"


async def test_new_recs_emits_only_when_a_new_kind_appears(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_newrec_deps(
        monkeypatch,
        [
            [_item("vault_yield")],  # baseline: {vault_yield}
            [_item("aerodrome_swap"), _item("vault_yield")],  # +aerodrome_swap → emit (order irrelevant)
            [_item("vault_yield"), _item("aerodrome_swap")],  # same set, reordered → NO emit
        ],
    )
    store = StatefulStore()
    await poller.poll_new_recs(None, _CONFIG, store)
    assert store.emits == []  # baseline
    await poller.poll_new_recs(None, _CONFIG, store)
    assert len(store.emits) == 1
    ev = store.emits[0]
    assert ev["type"] == "new_recommendation"
    assert ev["wallet"] == _OWNER
    assert ev["dedupe_key"] == f"newrec:{_OWNER.lower()}:1"
    await poller.poll_new_recs(None, _CONFIG, store)  # reordered same set
    assert len(store.emits) == 1  # NOT re-fired by ranking jitter — the whole point of the fix


async def test_new_recs_ranking_and_amount_jitter_never_fires(monkeypatch: pytest.MonkeyPatch) -> None:
    # The live-caught bug: the LLM re-orders the same recs and tweaks the suggested amount every tick.
    # Neither is a real change, so the detector must stay silent after the baseline.
    _patch_newrec_deps(
        monkeypatch,
        [
            [_item("vault_yield", "100"), _item("aerodrome_swap", "50")],
            [_item("aerodrome_swap", "55"), _item("vault_yield", "120")],  # reordered + amounts moved
            [_item("vault_yield", "130"), _item("aerodrome_swap", "60")],
        ],
    )
    store = StatefulStore()
    for _ in range(3):
        await poller.poll_new_recs(None, _CONFIG, store)
    assert store.emits == []  # no false positive across three jittery ticks


async def test_new_recs_removal_is_silent_then_reappearance_re_notifies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_newrec_deps(
        monkeypatch,
        [
            [_item("vault_yield"), _item("aerodrome_swap")],  # baseline {swap, vault}
            [_item("vault_yield")],  # aerodrome_swap left → silent baseline update, NO emit
            [_item("vault_yield"), _item("aerodrome_swap")],  # swap returns → re-notify (seq 1)
        ],
    )
    store = StatefulStore()
    await poller.poll_new_recs(None, _CONFIG, store)
    await poller.poll_new_recs(None, _CONFIG, store)
    assert store.emits == []  # a removal never notifies "fewer opportunities"
    await poller.poll_new_recs(None, _CONFIG, store)
    assert len(store.emits) == 1
    assert store.emits[0]["dedupe_key"] == f"newrec:{_OWNER.lower()}:1"


async def test_new_recs_empty_cleared_set_never_baselines_or_emits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_newrec_deps(monkeypatch, [[]])  # nothing cleared policy
    store = StatefulStore()
    await poller.poll_new_recs(None, _CONFIG, store)
    assert store.emits == []
    assert "newrec:" + _OWNER.lower() not in store._state  # no baseline written for an empty set


async def test_new_recs_gated_off_by_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("NOTIF_POLLER_NEWRECS", "false")
    _patch_newrec_deps(monkeypatch, [[_item("vault_yield")], [_item("aerodrome_swap")]])
    store = StatefulStore()
    await poller.poll_new_recs(None, _CONFIG, store)
    await poller.poll_new_recs(None, _CONFIG, store)
    assert store.emits == []  # gate off ⇒ the LLM loop never runs


async def test_new_recs_per_wallet_fail_open(monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_newrec_deps(monkeypatch, [[_item("vault_yield")]])

    async def _boom(*args: Any, **kwargs: Any):  # noqa: ANN202
        raise RuntimeError("model down for this wallet")

    monkeypatch.setattr("sparkpoint_agent.api.recommendations._compute", _boom)
    store = StatefulStore()
    await poller.poll_new_recs(None, _CONFIG, store)  # must not raise
    assert store.emits == []


async def test_new_recs_rotates_through_all_wallets_no_starvation(monkeypatch: pytest.MonkeyPatch) -> None:
    # With more active-mandate wallets than the per-tick cap, the cursor must page through ALL of them
    # across ticks (a fixed LIMIT + stable ORDER BY alone would starve the wallets past the cap).
    monkeypatch.setattr(poller, "_NEWREC_WALLET_CAP", 2)
    owners = ["0xAAA", "0xBBB", "0xCCC"]  # 3 wallets, cap 2 → needs 2 ticks to cover all

    class _RotatingMandateStore:
        def __init__(self, db: Any) -> None:
            self._db = db

        async def list_active_owners(  # noqa: ARG002
            self, *, network_id: str, limit: int, offset: int = 0
        ) -> list[str]:
            return owners[offset : offset + limit]

    class _FakeVaultReaderCls:
        @classmethod
        def from_config(cls, config: Any) -> _FakeVaultReaderCls:  # noqa: ARG003
            return cls()

    class _FakeLLM:
        @classmethod
        def from_env(cls) -> _FakeLLM:
            return cls()

    scored: list[str] = []

    async def _fake_compute(account: Any, *a: Any, **k: Any):  # noqa: ANN202, ARG001
        scored.append(account.account)
        return object(), [_item("vault_yield")]

    monkeypatch.setattr("sparkpoint_agent.db.mandates.PgMandateStore", _RotatingMandateStore)
    monkeypatch.setattr("sparkpoint_agent.chain.VaultReader", _FakeVaultReaderCls)
    monkeypatch.setattr("sparkpoint_agent.llm.AsyncClaudeClient", _FakeLLM)
    monkeypatch.setattr("sparkpoint_agent.api.recommendations._compute", _fake_compute)

    store = StatefulStore()
    await poller.poll_new_recs(None, _CONFIG, store)  # tick 1: offset 0 → AAA, BBB
    await poller.poll_new_recs(None, _CONFIG, store)  # tick 2: offset 2 → CCC (short page ⇒ wrap)
    await poller.poll_new_recs(None, _CONFIG, store)  # tick 3: offset 0 → AAA, BBB again
    assert scored[:3] == ["0xAAA", "0xBBB", "0xCCC"]  # all covered within 2 ticks — no starvation
    assert scored[3:5] == ["0xAAA", "0xBBB"]  # then it wraps
