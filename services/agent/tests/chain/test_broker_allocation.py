# ruff: noqa: S101
"""Tests for the allocation builder (feature 044).

This code decides who gets how much of a pot of real money, so the tests are about the properties
that make a split defensible rather than about the happy path: the total never exceeds the pot, the
ratios are exactly the advertised 1.0 : 2.0 : 3.3, one wallet is one leaf, and an empty period is a
normal state.

The encoding is NOT asserted against a second copy of my own assumption — it is written to a
fixture that `test/broker/AllocationParity.t.sol` replays against the real contract, so a
`keccak(abi.encode)` vs `encodePacked` mistake fails loudly instead of producing proofs that
never verify.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sparkpoint_agent.chain.broker_allocation import (
    UnpricedActivations,
    build_allocation,
    build_tree,
    leaf_for,
    proof_for,
)
from sparkpoint_agent.chain.broker_ledger import ActivatedBroker

ANALYST, ASSOCIATE, PARTNER = 10_000, 20_000, 33_000

A = "0xaaaaaaaa00000000000000000000000000000001"
B = "0xbbbbbbbb00000000000000000000000000000002"
C = "0xcccccccc00000000000000000000000000000003"
USDC = "0xdddddddd00000000000000000000000000000004"


def _b(token_id: int, holder: str, weight: int) -> ActivatedBroker:
    return ActivatedBroker(token_id=token_id, holder=holder, weight_bps=weight)


# ── the properties that make a split defensible ────────────────────────────────────────────────


def test_the_three_tiers_split_in_the_advertised_ratio() -> None:
    """1.0 : 2.0 : 3.3 — the number holders were shown when they chose a tier."""
    plan = build_allocation(
        period_id=1,
        token=USDC,
        pot=6_300_000,
        brokers=[_b(1, A, ANALYST), _b(2, B, ASSOCIATE), _b(3, C, PARTNER)],
    )
    amounts = {a.account: a.amount for a in plan.allocations}
    assert amounts[B] == amounts[A] * 2
    assert amounts[C] * 10 == amounts[A] * 33


def test_the_total_never_exceeds_the_pot() -> None:
    """The distributor rejects an allocation larger than it holds, so rounding must go down."""
    for pot in (1, 7, 999, 1_000_000, 10**18 + 7):
        plan = build_allocation(
            period_id=1,
            token=USDC,
            pot=pot,
            brokers=[_b(1, A, ANALYST), _b(2, B, ASSOCIATE), _b(3, C, PARTNER)],
        )
        assert plan.total_allocated <= pot
        assert plan.total_allocated + plan.dust == pot


def test_one_wallet_holding_three_brokers_gets_ONE_leaf_for_the_sum() -> None:
    """`claim` is once per account per period.

    Three leaves for one wallet would let them claim only the first and strand the rest — with no
    way to fix it, because a published period is immutable.
    """
    plan = build_allocation(
        period_id=1,
        token=USDC,
        pot=6_300_000,
        brokers=[_b(1, A, ANALYST), _b(2, A, ASSOCIATE), _b(3, A, PARTNER)],
    )
    assert len(plan.allocations) == 1
    row = plan.allocations[0]
    assert row.account == A
    assert row.weight_bps == ANALYST + ASSOCIATE + PARTNER
    assert row.token_ids == (1, 2, 3)
    assert row.amount == 6_300_000  # sole holder takes the whole pot


def test_an_unactivated_broker_is_simply_absent_from_the_input() -> None:
    """Weight 0 contributes nothing and earns nothing."""
    plan = build_allocation(
        period_id=1, token=USDC, pot=1_000, brokers=[_b(1, A, ANALYST), _b(2, B, 0)]
    )
    assert [a.account for a in plan.allocations] == [A]
    assert plan.allocations[0].amount == 1_000


def test_a_period_with_revenue_but_no_activated_brokers_allocates_nothing() -> None:
    """Not an error. The pot rolls forward, because nothing can sweep it anywhere else."""
    plan = build_allocation(period_id=1, token=USDC, pot=5_000, brokers=[])
    assert plan.allocations == ()
    assert plan.total_allocated == 0
    assert plan.dust == 5_000


def test_a_period_with_no_revenue_is_a_normal_empty_period() -> None:
    """Today's real state. It must compute, not raise."""
    plan = build_allocation(period_id=1, token=USDC, pot=0, brokers=[_b(1, A, ANALYST)])
    assert plan.total_allocated == 0
    assert plan.allocations == ()


def test_a_wallet_whose_share_rounds_to_zero_gets_no_leaf() -> None:
    """A claim that moves 0 tokens costs gas and does nothing; better to not publish it."""
    plan = build_allocation(
        period_id=1, token=USDC, pot=1, brokers=[_b(1, A, ANALYST), _b(2, B, ANALYST)]
    )
    assert all(a.amount > 0 for a in plan.allocations)


def test_dust_is_reported_rather_than_quietly_dropped() -> None:
    plan = build_allocation(
        period_id=1,
        token=USDC,
        pot=100,
        brokers=[_b(1, A, ANALYST), _b(2, B, ANALYST), _b(3, C, ANALYST)],
    )
    assert plan.total_allocated == 99
    assert plan.dust == 1


# ── the tree itself ────────────────────────────────────────────────────────────────────────────


def test_every_generated_proof_verifies_against_its_own_root() -> None:
    leaves = [leaf_for(1, f"0x{i:040x}", i * 100) for i in range(1, 12)]
    root, levels = build_tree(leaves)
    for leaf in leaves:
        node = leaf
        for sibling in proof_for(levels, leaf):
            node = (
                __import__("eth_utils").keccak(node + sibling)
                if node < sibling
                else __import__("eth_utils").keccak(sibling + node)
            )
        assert node == root


def test_the_publishable_record_carries_every_input_needed_to_recompute(tmp_path: Path) -> None:
    """FR-010: the split is a claim about other people's money and must be checkable."""
    plan = build_allocation(
        period_id=3, token=USDC, pot=10_000, brokers=[_b(1, A, ANALYST), _b(2, B, PARTNER)]
    )
    doc = plan.to_publishable()
    assert doc["merkleRoot"].startswith("0x") and len(doc["merkleRoot"]) == 66
    assert doc["periodId"] == 3 and doc["token"] == USDC
    assert doc["pot"] == "10000"
    assert "abi.encode" in doc["leaf"]
    for row in doc["allocations"]:
        assert row["proof"] is not None and row["tokenIds"]
    # Recomputable: the rule plus the inputs reproduce every amount.
    total = int(doc["totalWeightBps"])
    for row in doc["allocations"]:
        assert int(row["amount"]) == 10_000 * int(row["weightBps"]) // total


# ── the cross-language fixture ─────────────────────────────────────────────────────────────────


def test_writes_the_parity_fixture_the_solidity_test_replays() -> None:
    """Emit a real plan for `AllocationParity.t.sol` to claim against on a real EVM.

    This is the guard against the Merkle-distributor footgun: if Python's leaf encoding and the
    contract's `leafFor` ever diverge, every proof in this fixture fails to verify and that test
    goes red — instead of the divergence being discovered by a holder whose claim reverts.
    """
    plan = build_allocation(
        period_id=1,
        token=USDC,
        pot=6_300_000,
        brokers=[
            _b(1, A, ANALYST),
            _b(2, B, ASSOCIATE),
            _b(3, C, PARTNER),
            _b(4, A, PARTNER),  # A holds two, at different tiers ⇒ one summed leaf
        ],
    )
    out = Path(__file__).resolve().parents[4] / "contracts" / "test" / "fixtures"
    out.mkdir(parents=True, exist_ok=True)
    (out / "allocation-parity.json").write_text(
        json.dumps(plan.to_publishable(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    assert plan.total_allocated <= plan.pot
    assert len(plan.allocations) == 3


# ── the orphaned-activation refusal ────────────────────────────────────────────────────────────


def test_building_a_split_REFUSES_while_activated_brokers_have_no_weight() -> None:
    """The live Robinhood testnet case: #1 and #4 are activated and unpriceable.

    Publishing is irreversible, so an unpriceable activation must stop the build rather than
    quietly resolve to "this holder gets nothing".
    """
    with pytest.raises(UnpricedActivations) as err:
        build_allocation(
            period_id=1, token=USDC, pot=1_000, brokers=[_b(2, A, ANALYST)], weightless=(1, 4)
        )
    assert err.value.token_ids == (1, 4)
    assert "permanently" in str(err.value)


def test_excluding_them_is_possible_but_must_be_explicit() -> None:
    plan = build_allocation(
        period_id=1,
        token=USDC,
        pot=1_000,
        brokers=[_b(2, A, ANALYST)],
        weightless=(1, 4),
        allow_unpriced=True,
    )
    assert plan.total_allocated == 1_000


def test_no_weightless_brokers_needs_no_ceremony() -> None:
    plan = build_allocation(period_id=1, token=USDC, pot=1_000, brokers=[_b(2, A, ANALYST)])
    assert plan.total_allocated == 1_000


# ── grandfathering (operator decision, 14 Aug 2026) ────────────────────────────────────────────


def test_a_grandfathered_broker_does_not_block_the_build() -> None:
    """It carries a policy weight, so it is priced — unlike a genuinely unresolved one."""
    plan = build_allocation(
        period_id=1,
        token=USDC,
        pot=1_000,
        brokers=[_b(1, A, ANALYST), _b(2, B, ANALYST)],
        weightless=(1,),
        grandfathered=(1,),
    )
    assert plan.total_allocated == 1_000


def test_an_UNRESOLVED_broker_still_blocks_even_alongside_grandfathered_ones() -> None:
    """Grandfathering one token must not quietly wave through a different unpriced one."""
    with pytest.raises(UnpricedActivations) as err:
        build_allocation(
            period_id=1,
            token=USDC,
            pot=1_000,
            brokers=[_b(1, A, ANALYST)],
            weightless=(1, 7),
            grandfathered=(1,),
        )
    assert err.value.token_ids == (7,)


def test_the_published_doc_NAMES_which_weights_were_policy_not_purchase() -> None:
    """A weight nobody paid for has to be auditable by anyone recomputing the split."""
    plan = build_allocation(
        period_id=1,
        token=USDC,
        pot=1_000,
        brokers=[_b(1, A, ANALYST), _b(2, B, PARTNER)],
        weightless=(1,),
        grandfathered=(1,),
    )
    rows = {r["account"]: r for r in plan.to_publishable()["allocations"]}
    assert rows[A]["grandfatheredTokenIds"] == [1]
    assert rows[B]["grandfatheredTokenIds"] == []


def test_grandfathering_gives_the_LOWEST_weight_not_a_generous_one() -> None:
    """1.0x, the tier they never chose. A pre-tier holder must not outrank a paying Partner."""
    from sparkpoint_agent.chain.broker_ledger import GRANDFATHER_WEIGHT_BPS

    assert GRANDFATHER_WEIGHT_BPS == ANALYST
    assert GRANDFATHER_WEIGHT_BPS < PARTNER
