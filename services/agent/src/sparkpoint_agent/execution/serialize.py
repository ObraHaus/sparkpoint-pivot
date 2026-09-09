"""Serialize the internal policy verdict into the wire shapes (feature 019 US2).

Maps the internal ``policy.PolicyVerdict`` dataclass → the wire ``WirePolicyVerdict``
(status→approved
bool, ``tuple[ReasonCode]``→``[{code, message}]``, drop the internal ``trace``, attach the sim) and
the
per-step ``trace`` → the ``GuardrailCheck`` checklist rendered in the ExecutionDrawer (1:1 with the
six
guardrails + the recipient check, N1).
"""

from __future__ import annotations

from typing import Any

from ..policy import PolicyVerdict, ReasonCode
from ..sim import SimulationResult
from .models import GuardrailCheck, WirePolicyVerdict, WireReason

# Friendly human messages for the reason codes surfaced in the drawer / rejection envelope.
_REASON_MESSAGES: dict[ReasonCode, str] = {
    ReasonCode.OK: "All checks passed.",
    ReasonCode.SCHEMA_INVALID: "The action is not well-formed.",
    ReasonCode.PROTOCOL_NOT_ALLOWLISTED: "The target is not a whitelisted protocol.",
    ReasonCode.SELECTOR_NOT_ALLOWLISTED: "The function is not whitelisted for this target.",
    ReasonCode.ASSET_NOT_ALLOWLISTED: "The asset is not allowed for this action.",
    ReasonCode.RECIPIENT_NOT_USER: "The recipient must be your own wallet.",
    ReasonCode.CAP_PER_USER_EXCEEDED: "This would exceed your per-user deposit cap.",
    ReasonCode.CAP_TOTAL_EXCEEDED: "This would exceed the total protocol cap.",
    ReasonCode.CAP_VAULT_EXCEEDED: "This would exceed the vault deposit cap.",
    ReasonCode.CAP_PER_TX_EXCEEDED: "This exceeds the per-transaction cap.",
    ReasonCode.CAP_CUMULATIVE_EXCEEDED: "This exceeds the cumulative session cap.",
    ReasonCode.MANDATE_RISK_EXCEEDED: "This exceeds your risk mandate.",
    ReasonCode.SLIPPAGE_EXCEEDED: "The simulated slippage exceeds your maximum.",
    ReasonCode.MIN_OUT_BELOW_FLOOR: "The minimum output is below the allowed floor.",
    ReasonCode.SIM_REVERT: "The pre-trade simulation reverted.",
    ReasonCode.SIM_UNAVAILABLE: "The pre-trade simulation is unavailable.",
    ReasonCode.DATA_STALE: "Input data is stale; refresh before signing.",
    ReasonCode.KILL_SWITCH_PAUSED: "Deposits paused by the kill-switch (withdrawals stay open).",
    ReasonCode.SESSION_EXPIRED: "The session key has expired.",
    ReasonCode.SESSION_REVOKED: "The session key was revoked.",
}


def reason_message(code: ReasonCode) -> str:
    """The human message for a reason code (falls back to the code string)."""
    return _REASON_MESSAGES.get(code, code.value)


# trace step name → (guardrail id, human label) rendered in the ExecutionDrawer checklist.
_STEP_META: dict[str, tuple[str, str]] = {
    "SCHEMA": ("schema_valid", "Action is well-formed"),
    "PROTOCOL": ("protocol_allowlisted", "Target is a whitelisted protocol"),
    "ASSET": ("asset_allowlisted", "Asset is allowed (USDC)"),
    "RECIPIENT": ("recipient_is_you", "Funds move only to your own wallet"),
    "CAPS": ("within_caps", "Within the deposit caps"),
    "MANDATE": ("mandate_conformant", "Within your risk mandate"),
    "SLIPPAGE_SIM": ("simulation_passed", "Pre-trade simulation passed"),
    "FRESHNESS": ("data_fresh", "Input data is fresh"),
    "KILL_SWITCH": ("not_paused", "The vault is active (not paused)"),
    "SESSION": ("session_scope", "Session-key scope"),
}


def to_guardrail_checklist(verdict: PolicyVerdict) -> list[GuardrailCheck]:
    """Render the per-step trace as the confirmation checklist (approved ⇒ all rows pass/warn)."""
    rows: list[GuardrailCheck] = []
    for c in verdict.trace:
        gid, label = _STEP_META.get(c.step, (c.step.lower(), c.step))
        if not c.passed:
            status: str = "fail"
        elif c.skipped:
            # A skipped-but-passed step (e.g. caps on an exit) is not applicable — reassure, don't
            # alarm.
            status = "pass"
        else:
            status = "pass"
        detail = c.detail if c.detail else ("not applicable" if c.skipped else "ok")
        rows.append(GuardrailCheck(id=gid, label=label, status=status, detail=detail))  # type: ignore[arg-type]
    return rows


def to_wire_verdict(
    verdict: PolicyVerdict,
    *,
    normalized_action: dict[str, Any] | None,
    simulation: SimulationResult | None,
) -> WirePolicyVerdict:
    """Map the internal verdict to the wire ``PolicyVerdict`` (§2.4)."""
    reasons = [WireReason(code=r.value, message=reason_message(r)) for r in verdict.reasons]
    return WirePolicyVerdict(
        approved=verdict.approved,
        policyVersion=verdict.policy_version,
        reasons=reasons,
        normalizedAction=normalized_action if verdict.approved else None,
        simulation=simulation,
    )


def proposed_action_wire(
    *, action_type: str, asset: str, decimals: int, amount: int, recommendation_id: str | None
) -> dict[str, Any]:
    """The ProposedAction wire dict (matches ProposedActionSchema; omit absent optionals)."""
    wire: dict[str, Any] = {
        "type": action_type,
        "asset": asset,
        "decimals": decimals,
        "amount": str(amount),
    }
    if recommendation_id is not None:
        wire["recommendationId"] = recommendation_id
    return wire
