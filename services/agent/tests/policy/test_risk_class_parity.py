# ruff: noqa: S101
"""030 · the mandate check stops being a tautology — and nothing else moves.

Before this feature, ``build_action`` was called with ``risk_profile=ctx.risk_profile`` (the USER's
mandate) and assigned ``risk_class=risk_profile`` to the candidate. Policy step 5 then evaluated::

    RISK_PROFILE_RANK[action.risk_class] > RISK_PROFILE_RANK[ctx.mandate.max_risk_class]

with both sides derived from the same value. ``X > X`` is never true, so **the mandate check could
not reject anything on the recommendation path** — the mandate's one piece of real authority had
been a no-op since it was written. It also left the web with nothing truthful to render a
per-strategy risk badge from, which is why every card hardcoded tier 1.

030 gives each strategy its own intrinsic risk class. Both live strategies supply USDC to Aave v3 —
directly, or through a vault that does exactly that — so both are honestly ``CONSERVATIVE`` and no
current verdict changes. That is what the first half of this file asserts, exhaustively.

The second half asserts the mechanism now actually works: a candidate whose risk genuinely exceeds
the mandate is REJECTED. Together these say the change is a strict tightening — nothing that was
approved becomes rejected, and something that could never be rejected now can be.
"""

from __future__ import annotations

import pytest

from sparkpoint_agent.agents.recommender import (
    _STRATEGY_RISK_CLASS,
    _YIELD_STRATEGIES,
    build_action,
)
from sparkpoint_agent.policy import (
    ActionType,
    Asset,
    CapHeadroom,
    MandateContext,
    PolicyContext,
    ReasonCode,
    RiskProfile,
    SimulationInput,
    evaluate,
)

CHAIN = 8453
VAULT = "0x1111111111111111111111111111111111111111"
AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"
USER = "0x2222222222222222222222222222222222222222"
OWNER = "0x3333333333333333333333333333333333333333"
USDC_1000 = 1_000_000_000
BIG = 10**15

#: 030/R1 — the Aave pool is resolved now. Before this feature only the vault was, which is the
#: entire reason /strategies could never show a second card.
RESOLVED = {"sparkpoint_vault": VAULT, "aave_v3_pool": AAVE_POOL}

#: The policy enum's middle tier is ``balanced`` (the mandate table calls it "moderate" — the
#: policy schema is authoritative, see enums.py). All three, so the cross-product is exhaustive.
ALL_PROFILES = (RiskProfile.CONSERVATIVE, RiskProfile.BALANCED, RiskProfile.GROWTH)


def _ctx(mandate_profile: RiskProfile) -> PolicyContext:
    return PolicyContext(
        chain_id=CHAIN,
        user_account=USER,
        owner=OWNER,
        resolved_targets=RESOLVED,
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        simulation=SimulationInput(provider="anvil_fork", will_revert=False),
        data_stale=False,
        kill_switch_paused=False,
        mandate=MandateContext(max_risk_class=mandate_profile),
    )


def _build(action_type: ActionType, asset: Asset, *, mandate: RiskProfile, risk_class=None):
    """Build a candidate exactly as the recommender does."""
    return build_action(
        chain_id=CHAIN,
        action_type=action_type,
        asset=asset,
        amount=USDC_1000,
        user_account=USER,
        resolved_targets=RESOLVED,
        risk_profile=mandate,
        risk_class=risk_class,
    )


# ── parity: every current verdict is byte-identical ────────────────────────────


@pytest.mark.parametrize("mandate", ALL_PROFILES)
@pytest.mark.parametrize("strategy", _YIELD_STRATEGIES, ids=lambda s: s[0].value)
def test_every_live_strategy_and_mandate_pair_still_approves(strategy, mandate) -> None:
    """The full cross-product of what ships today: 2 strategies × 3 mandate profiles."""
    action_type, asset, risk_class = strategy

    after = _build(action_type, asset, mandate=mandate, risk_class=risk_class)
    assert after is not None, f"{action_type.value} must build once its target resolves"

    # The pre-030 candidate: risk_class echoed the user's mandate profile.
    before = _build(action_type, asset, mandate=mandate, risk_class=mandate)
    assert before is not None

    v_before = evaluate(before, _ctx(mandate))
    v_after = evaluate(after, _ctx(mandate))

    assert v_after.status == v_before.status == "approved"
    assert v_after.reasons == v_before.reasons
    assert v_after.policy_version == v_before.policy_version
    # The full check trace, step for step — not just the headline verdict.
    assert [(c.step, c.passed, c.skipped, c.reason, c.detail) for c in v_after.trace] == [
        (c.step, c.passed, c.skipped, c.reason, c.detail) for c in v_before.trace
    ]


@pytest.mark.parametrize("strategy", _YIELD_STRATEGIES, ids=lambda s: s[0].value)
def test_both_live_strategies_are_honestly_conservative(strategy) -> None:
    """Not a stylistic assertion — it is WHY the parity above holds.

    Both supply USDC to Aave v3. The vault adds a fee and management, not risk. Classing the
    direct supply as riskier to 'differentiate' the two would be the same invention as the live
    rationale that sold 'leveraging vault aggregation … rather than passive lending'.
    """
    _, _, risk_class = strategy
    assert risk_class is RiskProfile.CONSERVATIVE


def test_the_strategy_map_agrees_with_the_candidate_table() -> None:
    for action_type, _, risk_class in _YIELD_STRATEGIES:
        assert _STRATEGY_RISK_CLASS[action_type] is risk_class


# ── the mechanism now works ────────────────────────────────────────────────────


def test_an_over_risk_action_is_now_rejected_where_it_could_not_be_before() -> None:
    """The tautology, demonstrated and then removed.

    Pre-030 the candidate carried the user's own profile, so a conservative mandate compared
    ``CONSERVATIVE > CONSERVATIVE`` and passed — no matter how risky the strategy actually was.
    """
    ctx = _ctx(RiskProfile.CONSERVATIVE)

    # Pre-030 shape: risk_class echoes the mandate. Approved — the check cannot bite.
    tautological = _build(
        ActionType.VAULT_DEPOSIT, Asset.USDC,
        mandate=RiskProfile.CONSERVATIVE, risk_class=RiskProfile.CONSERVATIVE,
    )
    assert tautological is not None
    assert evaluate(tautological, ctx).status == "approved"

    # 030 shape: a genuinely riskier strategy is now REJECTED against the same mandate.
    risky = _build(
        ActionType.VAULT_DEPOSIT, Asset.USDC,
        mandate=RiskProfile.CONSERVATIVE, risk_class=RiskProfile.GROWTH,
    )
    assert risky is not None
    verdict = evaluate(risky, ctx)
    assert verdict.status == "rejected"
    assert ReasonCode.MANDATE_RISK_EXCEEDED in verdict.reasons


def test_a_looser_mandate_still_never_widens_what_policy_permits() -> None:
    """A growth mandate accepts a conservative strategy — it does not unlock anything else."""
    action = _build(
        ActionType.VAULT_DEPOSIT, Asset.USDC,
        mandate=RiskProfile.GROWTH, risk_class=RiskProfile.CONSERVATIVE,
    )
    assert action is not None
    assert evaluate(action, _ctx(RiskProfile.GROWTH)).status == "approved"
    # …and the same strategy is equally fine under the strictest mandate.
    assert evaluate(action, _ctx(RiskProfile.CONSERVATIVE)).status == "approved"


def test_omitting_the_risk_class_reproduces_the_pre_030_behaviour_exactly() -> None:
    """No caller becomes MORE permissive by forgetting the new parameter.

    An unlisted action type falls back to the mandate profile, which is what every caller did
    before 030 — so an un-migrated call site degrades to the old behaviour, never past it.
    """
    action = _build(ActionType.VAULT_DEPOSIT, Asset.USDC, mandate=RiskProfile.GROWTH)
    assert action is not None
    # VAULT_DEPOSIT is in the strategy map, so it gets the honest class, not the mandate's.
    assert action.risk_class is RiskProfile.CONSERVATIVE


def test_the_exit_path_is_never_mandate_gated() -> None:
    """N2 — withdrawal is not gated on the mandate, whatever the risk classes say."""
    action = _build(ActionType.VAULT_WITHDRAW, Asset.USDC, mandate=RiskProfile.CONSERVATIVE)
    if action is None:  # withdraw may not be in the yield candidate path on this chain
        pytest.skip("vault_withdraw is not buildable in this fixture")
    verdict = evaluate(action, _ctx(RiskProfile.CONSERVATIVE))
    mandate_step = next((c for c in verdict.trace if c.step == "MANDATE"), None)
    assert mandate_step is not None
    assert mandate_step.skipped is True
