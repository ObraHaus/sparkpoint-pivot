# ruff: noqa: S101
"""§B2 average-cost replay → realized PnL + remaining cost basis (pure, no DB, no network)."""

from __future__ import annotations

from sparkpoint_agent.db.vault_flows import BasisResult, FlowRow, replay_basis


def _dep(assets: int, shares: int, block: int, log: int = 0) -> FlowRow:
    return FlowRow(
        kind="deposit",
        assets=assets,
        shares=shares,
        block_number=block,
        log_index=log,
        tx_hash="0xd",
    )


def _wd(assets: int, shares: int, block: int, log: int = 0) -> FlowRow:
    return FlowRow(
        kind="withdraw",
        assets=assets,
        shares=shares,
        block_number=block,
        log_index=log,
        tx_hash="0xw",
    )


def test_empty_history_is_none() -> None:
    assert replay_basis([], 0) is None


def test_deposit_only_realizes_nothing_and_reconciles_to_balance() -> None:
    flows = [_dep(100_000_000, 100_000_000, 10), _dep(50_000_000, 50_000_000, 20)]
    r = replay_basis(flows, current_shares=150_000_000)
    assert isinstance(r, BasisResult)
    assert r.realized == 0
    assert r.remaining_cost_basis == 150_000_000  # Σ deposits
    assert r.reconstructed_shares == 150_000_000
    assert r.reconciles is True


def test_withdrawal_realizes_gain_over_average_cost() -> None:
    # deposit 100 USDC/100M shares (pps 1); pps→1.2; withdraw 60 USDC redeeming 50M shares.
    flows = [_dep(100_000_000, 100_000_000, 10), _wd(60_000_000, 50_000_000, 20)]
    r = replay_basis(flows, current_shares=50_000_000)
    assert r is not None
    assert r.realized == 10_000_000  # 60 received − 50 avg-cost of the 50M shares redeemed
    assert r.remaining_cost_basis == 50_000_000  # avg cost of the 50M shares still held
    assert r.reconstructed_shares == 50_000_000
    assert r.reconciles is True


def test_coherence_realized_plus_unrealized_equals_lifetime_pnl() -> None:
    # realized + (value − remaining_cost_basis) == value + Σwithdrawn − Σdeposited
    flows = [_dep(100_000_000, 100_000_000, 10), _wd(60_000_000, 50_000_000, 20)]
    r = replay_basis(flows, current_shares=50_000_000)
    assert r is not None
    value = 60_000_000  # 50M held shares @ pps 1.2
    unrealized = value - r.remaining_cost_basis
    lifetime = value + 60_000_000 - 100_000_000  # +Σwithdrawn −Σdeposited
    assert r.realized + unrealized == lifetime


def test_withdraw_before_any_deposit_does_not_reconcile() -> None:
    r = replay_basis([_wd(10_000_000, 10_000_000, 5)], current_shares=0)
    assert r is not None
    assert r.reconciles is False  # a gap: over-draws the reconstructed balance


def test_reconstructed_not_equal_to_balance_does_not_reconcile() -> None:
    # indexer behind: a deposit exists but the on-chain balance is higher (a newer deposit).
    r = replay_basis([_dep(100_000_000, 100_000_000, 10)], current_shares=150_000_000)
    assert r is not None
    assert r.reconstructed_shares == 100_000_000
    assert r.reconciles is False


def test_intra_block_order_respected_and_dust_bounded() -> None:
    # two withdrawals at odd ratios never raise; avg-cost rounding dust stays tiny + deterministic.
    flows = [
        _dep(100_000_000, 99_999_999, 10, log=0),
        _wd(33_333_333, 33_333_333, 10, log=1),
        _wd(33_333_333, 33_333_333, 10, log=2),
    ]
    r = replay_basis(flows, current_shares=99_999_999 - 66_666_666)
    assert r is not None
    assert r.reconciles is True
    assert r.remaining_cost_basis >= 0
