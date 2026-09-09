# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Contract tests (T058 seed) for the deterministic policy engine.

Assert the custody-critical invariants of policy-schema.md §8:
  - out-of-policy actions are REJECTED with the right ReasonCode AND yield NO
    signable artifact (``normalized_action is None``): non-allowlisted target,
    over-cap deposit, over-slippage swap, arbitrary/SparkPoint recipient, predicted
    revert; and
  - withdraws / redeems (``direction == exit``) SKIP caps AND the kill-switch pause
    (N2 — withdraw-is-sacred), even at zero headroom / while paused / on stale data.

These MUST pass.
"""

from __future__ import annotations

from sparkpoint_agent.policy import (
    POLICY_VERSION,
    Action,
    ActionType,
    Asset,
    CapHeadroom,
    InMemoryAuditSink,
    MandateContext,
    PolicyContext,
    ReasonCode,
    RiskProfile,
    SimulationInput,
    evaluate,
    record_verdict,
)

# ── Fixtures: pinned Base-mainnet (8453) targets + a deploy-time vault override ──
CHAIN = 8453
VAULT = "0x1111111111111111111111111111111111111111"  # deploy-time override
AAVE_POOL = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5"  # pinned in the address book
AERO_ROUTER = "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43"
AERO_FACTORY = "0x420DD381b31aEf6683db6B902084cB0FFECe40Da"
USER = "0x2222222222222222222222222222222222222222"
OWNER = "0x3333333333333333333333333333333333333333"
ARBITRARY = "0x4444444444444444444444444444444444444444"  # a SparkPoint/external addr

DEP_SEL = "0x6e553f65"
WITHDRAW_SEL = "0xb460af94"
REDEEM_SEL = "0xba087652"
AAVE_WITHDRAW_SEL = "0x69328dec"
SWAP_SEL = "0xcac88ea9"

USDC_1000 = 1_000_000_000  # 1,000 USDC (6 dp)
USDC_5000 = 5_000_000_000  # per-user cap
BIG = 10**15
_RESOLVED = {"sparkpoint_vault": VAULT}


def _deposit(amount: int = USDC_1000, **over: object) -> Action:
    kwargs: dict[str, object] = dict(
        action_type=ActionType.VAULT_DEPOSIT,
        target=VAULT,
        selector=DEP_SEL,
        asset=Asset.USDC,
        amount=amount,
        decimals=6,
        recipient=USER,
    )
    kwargs.update(over)
    return Action(**kwargs)  # type: ignore[arg-type]


def _deposit_ctx(**over: object) -> PolicyContext:
    kwargs: dict[str, object] = dict(
        chain_id=CHAIN,
        user_account=USER,
        owner=OWNER,
        resolved_targets=_RESOLVED,
        caps=CapHeadroom(per_user=USDC_5000, total=BIG, vault=BIG),
        simulation=SimulationInput(provider="anvil_fork", will_revert=False),
        data_stale=False,
        kill_switch_paused=False,
    )
    kwargs.update(over)
    return PolicyContext(**kwargs)  # type: ignore[arg-type]


def _swap(**over: object) -> Action:
    kwargs: dict[str, object] = dict(
        action_type=ActionType.AERODROME_SWAP,
        target=AERO_ROUTER,
        selector=SWAP_SEL,
        asset=Asset.USDC,
        amount=USDC_1000,
        decimals=6,
        recipient=USER,
        route_factory=AERO_FACTORY,
    )
    kwargs.update(over)
    return Action(**kwargs)  # type: ignore[arg-type]


def _swap_ctx(sim: SimulationInput, **over: object) -> PolicyContext:
    kwargs: dict[str, object] = dict(
        chain_id=CHAIN,
        user_account=USER,
        owner=OWNER,
        simulation=sim,
    )
    kwargs.update(over)
    return PolicyContext(**kwargs)  # type: ignore[arg-type]


def _exit_ctx(**over: object) -> PolicyContext:
    """A HOSTILE context for an exit: zero cap headroom, paused, stale, no sim."""
    kwargs: dict[str, object] = dict(
        chain_id=CHAIN,
        user_account=USER,
        owner=OWNER,
        resolved_targets=_RESOLVED,
        caps=CapHeadroom(per_user=0, total=0, vault=0),
        simulation=None,
        data_stale=True,
        kill_switch_paused=True,
    )
    kwargs.update(over)
    return PolicyContext(**kwargs)  # type: ignore[arg-type]


def _step(verdict: object, name: str):  # type: ignore[no-untyped-def]
    return next(c for c in verdict.trace if c.step == name)  # type: ignore[attr-defined]


# ── Happy paths ─────────────────────────────────────────────────────────────


def test_vault_deposit_approved_and_signable() -> None:
    v = evaluate(_deposit(), _deposit_ctx())
    assert v.approved
    assert v.reasons == (ReasonCode.OK,)
    assert v.normalized_action is not None
    assert v.is_signable
    assert v.policy_version == POLICY_VERSION


def test_policy_version_stamped_on_every_verdict() -> None:
    approved = evaluate(_deposit(), _deposit_ctx())
    rejected = evaluate(_deposit(target=ARBITRARY), _deposit_ctx())
    assert approved.policy_version == POLICY_VERSION
    assert rejected.policy_version == POLICY_VERSION


# ── Rejections: each MUST reject with the right code AND emit no signable artifact ─


def test_non_allowlisted_target_rejected() -> None:
    v = evaluate(_deposit(target=ARBITRARY), _deposit_ctx())
    assert not v.approved
    assert v.reasons == (ReasonCode.PROTOCOL_NOT_ALLOWLISTED,)
    assert v.normalized_action is None
    assert not v.is_signable


def test_non_allowlisted_selector_rejected() -> None:
    # Known target (the Aave pool) but a selector that is not on the allowlist.
    action = _deposit(
        action_type=ActionType.AAVE_SUPPLY, target=AAVE_POOL, selector="0xdeadbeef"
    )
    v = evaluate(action, _deposit_ctx())
    assert not v.approved
    assert v.reasons == (ReasonCode.SELECTOR_NOT_ALLOWLISTED,)
    assert v.normalized_action is None


def test_asset_not_allowlisted_rejected() -> None:
    # The vault deposit entry allows USDC only; ETH must be rejected (§2.2).
    v = evaluate(_deposit(asset=Asset.ETH), _deposit_ctx())
    assert not v.approved
    assert v.reasons == (ReasonCode.ASSET_NOT_ALLOWLISTED,)
    assert v.normalized_action is None


def test_arbitrary_recipient_rejected() -> None:
    v = evaluate(_deposit(recipient=ARBITRARY), _deposit_ctx())
    assert not v.approved
    assert v.reasons == (ReasonCode.RECIPIENT_NOT_USER,)
    assert v.normalized_action is None


def test_over_cap_deposit_rejected() -> None:
    v = evaluate(_deposit(amount=6_000_000_000), _deposit_ctx())  # 6,000 > 5,000 cap
    assert not v.approved
    assert v.reasons == (ReasonCode.CAP_PER_USER_EXCEEDED,)
    assert v.normalized_action is None


def test_mandate_risk_exceeded_rejected() -> None:
    action = _deposit(risk_class=RiskProfile.GROWTH)
    ctx = _deposit_ctx(mandate=MandateContext(max_risk_class=RiskProfile.CONSERVATIVE))
    v = evaluate(action, ctx)
    assert not v.approved
    assert v.reasons == (ReasonCode.MANDATE_RISK_EXCEEDED,)


def test_predicted_revert_rejected() -> None:
    ctx = _deposit_ctx(simulation=SimulationInput(provider="anvil_fork", will_revert=True))
    v = evaluate(_deposit(), ctx)
    assert not v.approved
    assert v.reasons == (ReasonCode.SIM_REVERT,)
    assert v.normalized_action is None


def test_over_slippage_swap_rejected() -> None:
    sim = SimulationInput(
        provider="anvil_fork", will_revert=False, slippage_bps=120, min_out=990_000_000
    )  # 120 bps realized > 50 bps user max
    v = evaluate(_swap(), _swap_ctx(sim))
    assert not v.approved
    assert v.reasons == (ReasonCode.SLIPPAGE_EXCEEDED,)
    assert v.normalized_action is None


def test_swap_min_out_below_floor_rejected() -> None:
    sim = SimulationInput(
        provider="anvil_fork", will_revert=False, slippage_bps=10, min_out=0
    )  # unprotected min-out
    v = evaluate(_swap(), _swap_ctx(sim))
    assert not v.approved
    assert v.reasons == (ReasonCode.MIN_OUT_BELOW_FLOOR,)


def test_swap_sim_unavailable_fail_closed() -> None:
    v = evaluate(_swap(), _swap_ctx(sim=None))  # type: ignore[arg-type]
    assert not v.approved
    assert v.reasons == (ReasonCode.SIM_UNAVAILABLE,)


def test_swap_wrong_route_factory_rejected() -> None:
    v = evaluate(_swap(route_factory=ARBITRARY), _swap_ctx(
        SimulationInput(provider="anvil_fork", will_revert=False, slippage_bps=10, min_out=BIG)
    ))
    assert not v.approved
    assert v.reasons == (ReasonCode.PROTOCOL_NOT_ALLOWLISTED,)


def test_inflow_blocked_when_paused() -> None:
    v = evaluate(_deposit(), _deposit_ctx(kill_switch_paused=True))
    assert not v.approved
    assert v.reasons == (ReasonCode.KILL_SWITCH_PAUSED,)


def test_inflow_blocked_when_data_stale() -> None:
    v = evaluate(_deposit(), _deposit_ctx(data_stale=True))
    assert not v.approved
    assert v.reasons == (ReasonCode.DATA_STALE,)


# ── N2: withdraws / redeems (exit) SKIP caps + pause, even under a hostile ctx ──


def test_vault_withdraw_skips_caps_and_pause() -> None:
    action = _deposit(
        action_type=ActionType.VAULT_WITHDRAW, selector=WITHDRAW_SEL, amount=BIG
    )
    v = evaluate(action, _exit_ctx())  # zero headroom, paused, stale, no sim
    assert v.approved
    assert v.is_signable
    assert _step(v, "CAPS").skipped
    assert _step(v, "KILL_SWITCH").skipped
    assert _step(v, "FRESHNESS").skipped


def test_vault_redeem_skips_caps_and_pause() -> None:
    action = _deposit(
        action_type=ActionType.VAULT_REDEEM, selector=REDEEM_SEL, amount=BIG
    )
    v = evaluate(action, _exit_ctx())
    assert v.approved
    assert _step(v, "CAPS").skipped
    assert _step(v, "KILL_SWITCH").skipped


def test_aave_withdraw_skips_caps_and_pause() -> None:
    action = _deposit(
        action_type=ActionType.AAVE_WITHDRAW,
        target=AAVE_POOL,
        selector=AAVE_WITHDRAW_SEL,
        amount=BIG,
    )
    v = evaluate(action, _exit_ctx())
    assert v.approved
    assert _step(v, "CAPS").skipped
    assert _step(v, "KILL_SWITCH").skipped


def test_session_key_revoke_is_sacred_exit() -> None:
    action = Action(
        action_type=ActionType.SESSION_KEY_REVOKE,
        target=VAULT,  # ignored on the account-level branch
        selector=DEP_SEL,
        asset=Asset.USDC,
        amount=0,
        decimals=6,
        recipient=USER,
    )
    v = evaluate(action, _exit_ctx())
    assert v.approved  # revoke may never be blocked (N2, §6.7)


# ── SCHEMA fail-closed ──────────────────────────────────────────────────────


def test_unsupported_chain_rejected_schema() -> None:
    v = evaluate(_deposit(), _deposit_ctx(chain_id=1))  # Ethereum L1 — unsupported
    assert not v.approved
    assert v.reasons == (ReasonCode.SCHEMA_INVALID,)


def test_malformed_target_rejected_schema() -> None:
    v = evaluate(_deposit(target="0xnothex"), _deposit_ctx())
    assert not v.approved
    assert v.reasons == (ReasonCode.SCHEMA_INVALID,)


# ── Audit side-channel: a row for EVERY verdict (VR-A2), approved AND rejected ──


def test_audit_row_written_for_approved_and_rejected() -> None:
    sink = InMemoryAuditSink()
    approved = evaluate(_deposit(), _deposit_ctx())
    rejected = evaluate(_deposit(target=ARBITRARY), _deposit_ctx())
    record_verdict(approved, sink, action=_deposit())
    record_verdict(rejected, sink, action=_deposit(target=ARBITRARY))

    assert len(sink.records) == 2
    for rec in sink.records:
        assert rec.actor_kind == "policy_layer"
        assert rec.event_type == "policy_verdict"
        assert rec.policy_version == POLICY_VERSION
        assert "reasons" in rec.payload
        assert "checks" in rec.payload
    assert sink.records[0].payload["approved"] is True
    assert sink.records[1].payload["approved"] is False
    assert ReasonCode.PROTOCOL_NOT_ALLOWLISTED.value in sink.records[1].payload["reasons"]


def test_evaluate_is_pure_no_mutation_between_calls() -> None:
    # The same (action, ctx) yields identical verdicts — determinism / no hidden state.
    action, ctx = _deposit(), _deposit_ctx()
    first = evaluate(action, ctx)
    second = evaluate(action, ctx)
    assert first.status == second.status
    assert first.reasons == second.reasons
