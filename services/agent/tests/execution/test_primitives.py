# ruff: noqa: S101
"""Unit tests for the execution wiring primitives (feature 019 US2): decode, builder, serialize."""

from __future__ import annotations

import pytest

from sparkpoint_agent.execution.builder import build_steps
from sparkpoint_agent.execution.decode import DecodeError, decode_action
from sparkpoint_agent.execution.models import BuildActionRequest
from sparkpoint_agent.execution.serialize import (
    proposed_action_wire,
    to_guardrail_checklist,
    to_wire_verdict,
)
from sparkpoint_agent.policy import (
    POLICY_VERSION,
    Action,
    ActionType,
    Asset,
    CheckResult,
    PolicyVerdict,
    ReasonCode,
)

USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
VAULT = "0x00000000000000000000000000000000000000aa"
USER = "0x1111111111111111111111111111111111111111"


def _req(atype: str = "vault_deposit", asset: str = USDC, amount: str = "100000000") -> BuildActionRequest:
    return BuildActionRequest(type=atype, asset=asset, decimals=6, amount=amount)


# ── decode ───────────────────────────────────────────────────────────────────────────────────────


def test_decode_deposit_pins_recipient_and_resolves_selector() -> None:
    action = decode_action(_req(), account=USER, chain_id=8453, vault=VAULT, usdc=USDC)
    assert action.action_type is ActionType.VAULT_DEPOSIT
    assert action.target == VAULT
    assert action.selector == "0x6e553f65"
    assert action.asset is Asset.USDC
    assert action.amount == 100_000_000
    assert action.recipient == USER  # N1 — recipient pinned to the connected user


def test_decode_refuses_swap() -> None:
    with pytest.raises(DecodeError) as exc:
        decode_action(_req("aerodrome_swap"), account=USER, chain_id=8453, vault=VAULT, usdc=USDC)
    assert exc.value.code is ReasonCode.SCHEMA_INVALID


def test_decode_refuses_non_usdc_asset() -> None:
    with pytest.raises(DecodeError) as exc:
        decode_action(
            _req(asset="0x0000000000000000000000000000000000000bad"),
            account=USER,
            chain_id=8453,
            vault=VAULT,
            usdc=USDC,
        )
    assert exc.value.code is ReasonCode.ASSET_NOT_ALLOWLISTED


# ── builder ──────────────────────────────────────────────────────────────────────────────────────


def _action(atype: ActionType, amount: int = 100_000_000) -> Action:
    return Action(
        action_type=atype,
        target=VAULT,
        selector="0x6e553f65",
        asset=Asset.USDC,
        amount=amount,
        decimals=6,
        recipient=USER,
    )


def test_build_deposit_step_encodes_recipient() -> None:
    steps = build_steps(_action(ActionType.VAULT_DEPOSIT), chain_id=8453)
    assert len(steps) == 1
    s = steps[0]
    assert s.opType == "eoa_call" and s.to == VAULT and s.value == "0"
    assert s.data.startswith("0x6e553f65")
    assert USER[2:].lower() in s.data.lower()  # receiver forced to the user (N1)


def test_build_redeem_and_withdraw_selectors() -> None:
    assert build_steps(_action(ActionType.VAULT_REDEEM), chain_id=8453)[0].data.startswith(
        "0xba087652"
    )
    assert build_steps(_action(ActionType.VAULT_WITHDRAW), chain_id=8453)[0].data.startswith(
        "0xb460af94"
    )


# ── serialize ────────────────────────────────────────────────────────────────────────────────────


def _approved_verdict() -> PolicyVerdict:
    trace = (
        CheckResult(step="PROTOCOL", passed=True),
        CheckResult(step="RECIPIENT", passed=True),
        CheckResult(step="CAPS", passed=True, skipped=True, detail="exit"),
    )
    return PolicyVerdict(
        status="approved",
        reasons=(ReasonCode.OK,),
        policy_version=POLICY_VERSION,
        trace=trace,
        normalized_action=_action(ActionType.VAULT_DEPOSIT),
    )


def test_to_wire_verdict_approved() -> None:
    na = proposed_action_wire(
        action_type="vault_deposit", asset=USDC, decimals=6, amount=100, recommendation_id=None
    )
    wire = to_wire_verdict(_approved_verdict(), normalized_action=na, simulation=None)
    assert wire.approved is True
    assert wire.policyVersion == POLICY_VERSION
    assert wire.normalizedAction == na
    assert wire.reasons[0].code == "OK"


def test_to_guardrail_checklist_maps_steps() -> None:
    rows = {r.id: r for r in to_guardrail_checklist(_approved_verdict())}
    assert rows["protocol_allowlisted"].status == "pass"
    assert rows["recipient_is_you"].status == "pass"
    # a skipped-but-passed step (caps on an exit) reassures, never alarms
    assert rows["within_caps"].status == "pass"


def test_proposed_action_wire_omits_absent_recommendation() -> None:
    wire = proposed_action_wire(
        action_type="vault_deposit", asset=USDC, decimals=6, amount=100, recommendation_id=None
    )
    assert "recommendationId" not in wire
    wire2 = proposed_action_wire(
        action_type="vault_deposit", asset=USDC, decimals=6, amount=100, recommendation_id="rec_x"
    )
    assert wire2["recommendationId"] == "rec_x"
