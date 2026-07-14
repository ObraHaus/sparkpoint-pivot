# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Unit tests for the ChatBlock wire mappers (coordinator/chat_blocks.py).

Asserts the §2.7 wire contract: the policy STAMP is derived only from the deterministic
verdict (approved → checks, rejected → reason); the ProposedAction maps a policy Action to
its token-address/base-unit-string form with params only for swaps; and optional fields
are OMITTED (never null) so the frontend's strict optionals accept them.
"""

from __future__ import annotations

from sparkpoint_agent.coordinator.chat_blocks import (
    ActionBlock,
    ChatPolicyStamp,
    Citation,
    PositionLite,
    RecommendationBlock,
    ToolStepBlock,
    guardrail_check,
    policy_stamp,
    proposed_action_wire,
    recommendation_protocol,
    token_address,
)
from sparkpoint_agent.policy import (
    Action,
    ActionType,
    Asset,
    CapHeadroom,
    CheckResult,
    MandateContext,
    PolicyContext,
    Protocol,
    ReasonCode,
    RiskProfile,
    SimulationInput,
    evaluate,
    get_addresses,
)

CHAIN = 8453
VAULT = "0x1111111111111111111111111111111111111111"
USER = "0x2222222222222222222222222222222222222222"
DEP_SEL = "0x6e553f65"
SWAP_SEL = "0xcac88ea9"
BIG = 10**15


def _deposit(amount: int) -> Action:
    return Action(
        action_type=ActionType.VAULT_DEPOSIT, target=VAULT, selector=DEP_SEL, asset=Asset.USDC,
        amount=amount, decimals=6, recipient=USER,
    )


def _ctx(per_user: int) -> PolicyContext:
    return PolicyContext(
        chain_id=CHAIN, user_account=USER, resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=per_user, total=BIG, vault=BIG),
        mandate=MandateContext(RiskProfile.CONSERVATIVE),
        simulation=SimulationInput(provider="viem_local", will_revert=False),
    )


# ── proposed_action_wire ─────────────────────────────────────────────────────


def test_proposed_action_wire_custody_has_no_params() -> None:
    wire = proposed_action_wire(_deposit(1_000_000_000), CHAIN)
    assert wire == {
        "type": "vault_deposit",
        "asset": get_addresses(CHAIN).usdc,
        "decimals": 6,
        "amount": "1000000000",
    }
    assert "params" not in wire
    assert "recommendationId" not in wire


def test_proposed_action_wire_includes_recommendation_id() -> None:
    wire = proposed_action_wire(_deposit(1), CHAIN, recommendation_id="rec_9")
    assert wire["recommendationId"] == "rec_9"


def test_proposed_action_wire_swap_has_slippage_params() -> None:
    swap = Action(
        action_type=ActionType.AERODROME_SWAP, target="0x0000000000000000000000000000000000000abc",
        selector=SWAP_SEL, asset=Asset.USDC, amount=100, decimals=6, recipient=USER,
        max_slippage_bps=50,
    )
    wire = proposed_action_wire(swap, CHAIN)
    assert wire["params"] == {"maxSlippageBps": 50}


def test_token_address_maps_symbol_to_address() -> None:
    book = get_addresses(CHAIN)
    assert token_address(CHAIN, Asset.USDC) == book.usdc
    assert token_address(CHAIN, Asset.ETH) == book.weth


# ── policy_stamp (approved / rejected) ───────────────────────────────────────


def test_policy_stamp_approved_carries_checks_not_reason() -> None:
    verdict = evaluate(_deposit(1_000_000_000), _ctx(per_user=BIG))
    assert verdict.approved
    stamp = policy_stamp(verdict)
    wire = stamp.to_wire()
    assert wire["status"] == "approved"
    assert wire["checks"]  # non-empty checklist
    assert "reason" not in wire


def test_policy_stamp_rejected_carries_reason_not_checks() -> None:
    verdict = evaluate(_deposit(10_000_000_000), _ctx(per_user=5_000_000_000))
    assert not verdict.approved
    assert verdict.reasons[0] is ReasonCode.CAP_PER_USER_EXCEEDED
    wire = policy_stamp(verdict).to_wire()
    assert wire["status"] == "rejected"
    assert "checks" not in wire
    assert "cap" in wire["reason"].lower()


# ── guardrail_check ──────────────────────────────────────────────────────────


def test_guardrail_check_status_mapping() -> None:
    assert guardrail_check(CheckResult(step="PROTOCOL", passed=True)).status == "pass"
    assert guardrail_check(
        CheckResult(step="CAPS", passed=False, reason=ReasonCode.CAP_PER_USER_EXCEEDED)
    ).status == "fail"
    # A skipped (not-applicable) step never blocks — mapped to pass (e.g. caps on an exit).
    assert guardrail_check(CheckResult(step="CAPS", passed=True, skipped=True)).status == "pass"


# ── optional-field omission ──────────────────────────────────────────────────


def test_citation_omits_url_when_absent() -> None:
    cite = Citation(provider="DeFiLlama", endpoint="/y", field="apy", value="4.21",
                    as_of="2026-07-14T00:00:00Z", stale=False)
    wire = cite.to_wire()
    assert "url" not in wire
    assert wire["asOf"] == "2026-07-14T00:00:00Z"
    assert Citation(provider="x", endpoint="/y", field="f", value="v",
                    as_of="t", stale=True, url="https://x").to_wire()["url"] == "https://x"


def test_position_lite_minimal_omits_optionals() -> None:
    wire = PositionLite(venue="vault", asset="0xUSDC", value_usd="100.00").to_wire()
    assert wire == {"venue": "vault", "asset": "0xUSDC", "valueUsd": "100.00"}


def test_chat_policy_stamp_omits_none_fields() -> None:
    assert ChatPolicyStamp(status="approved").to_wire() == {"status": "approved"}


# ── block shapes ─────────────────────────────────────────────────────────────


def test_recommendation_block_wire_shape() -> None:
    block = RecommendationBlock(
        rec_id="rec_1", title="Deposit", rank=1, rationale="why",
        protocol=recommendation_protocol(ActionType.VAULT_DEPOSIT),
        proposed_action=proposed_action_wire(_deposit(1), CHAIN, recommendation_id="rec_1"),
        policy=ChatPolicyStamp(status="approved", checks=()),
        citations=(),
    )
    wire = block.to_wire()
    assert wire["type"] == "recommendation"
    assert wire["recId"] == "rec_1"
    assert wire["protocol"] == Protocol.AAVE_V3.value  # vault surfaced by its yield source
    assert wire["proposedAction"]["type"] == "vault_deposit"
    assert wire["policy"]["status"] == "approved"


def test_action_block_rejected_offers_no_sign_path() -> None:
    verdict = evaluate(_deposit(10_000_000_000), _ctx(per_user=5_000_000_000))
    wire = ActionBlock(
        proposed_action=proposed_action_wire(_deposit(10_000_000_000), CHAIN),
        policy=policy_stamp(verdict),
    ).to_wire()
    # A rejected action block carries a proposedAction + a rejected stamp, and NOTHING
    # that lets the UI sign (no approved status, no bundle).
    assert wire["type"] == "action"
    assert wire["policy"]["status"] == "rejected"
    assert "reason" in wire["policy"]


def test_tool_step_block_wire_shape() -> None:
    assert ToolStepBlock("Reading your portfolio", "running").to_wire() == {
        "type": "tool_step", "label": "Reading your portfolio", "status": "running"
    }
