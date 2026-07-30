"""024/T024 — the performance-fee disclosure must follow how the fee actually accrues.

Constitution v3.0.0 ratified Morpho Vault V2 Fee Wrappers together with an explicit DISCLOSURE
obligation: a Vault V2 keeps no high-water-mark state, so a gain following an earlier loss IS
charged. These tests pin (a) that today's launch-vault wire output is byte-identical to the
pre-024 constants, and (b) that the Fee Wrapper wording never claims a high-water mark.
"""

from __future__ import annotations

from sparkpoint_agent.policy.fee_copy import (
    deposit_disclosure,
    fee_base,
    fee_basis_for_kind,
    withdraw_disclosure,
)

# The pre-024 constants, retyped here on purpose: this file is the tripwire for a silent edit to
# the shared copy, so it must not import the value it is asserting.
_HWM_DEPOSIT = (
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on "
    "your principal. We only earn when you earn — never on your principal, never by "
    "taking custody."
)
_HWM_WITHDRAW = (
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on "
    "your principal."
)


def test_launch_vault_wire_output_is_byte_identical_to_pre_024() -> None:
    """The Aave launch vault is the only vault this service resolves — §3.7 must not move."""
    assert deposit_disclosure("high_water_mark") == _HWM_DEPOSIT
    assert withdraw_disclosure("high_water_mark") == _HWM_WITHDRAW
    assert fee_base("high_water_mark") == "realized_yield_above_hwm"


def test_defaults_are_the_high_water_mark_variant() -> None:
    """An un-parameterised call must keep today's behaviour, never the weaker promise."""
    assert deposit_disclosure() == _HWM_DEPOSIT
    assert withdraw_disclosure() == _HWM_WITHDRAW
    assert fee_base() == "realized_yield_above_hwm"


def test_sparkpoint_own_vaults_keep_a_real_high_water_mark() -> None:
    assert fee_basis_for_kind("first_party") == "high_water_mark"
    assert fee_basis_for_kind("legacy_wrapper") == "high_water_mark"


def test_a_morpho_vault_v2_fee_wrapper_has_no_high_water_mark() -> None:
    assert fee_basis_for_kind("fee_wrapper") == "per_period_gain"
    assert fee_basis_for_kind("external_4626") == "per_period_gain"


def test_an_unknown_kind_falls_to_the_weaker_promise() -> None:
    """Fail-safe on DISCLOSURE: never let an unrecognised vault inherit a HWM guarantee."""
    assert fee_basis_for_kind("something_new") == "per_period_gain"


def test_fee_wrapper_copy_never_claims_a_high_water_mark() -> None:
    deposit = deposit_disclosure("per_period_gain")
    withdraw = withdraw_disclosure("per_period_gain")
    assert "high-water" not in deposit.lower()
    assert "high-water" not in withdraw.lower()
    # The adverse clause is the whole point of the ratified wording.
    assert "gain following an earlier loss is charged" in deposit
    assert "below your previous high" in deposit
    assert "gain following an earlier loss is charged" in withdraw
    # What still holds on BOTH bases must survive.
    assert "never on your principal" in deposit
    assert "never while it is flat or falling" in deposit


def test_fee_base_distinguishes_the_two_accrual_modes() -> None:
    """A consumer keying UI off `base` must be able to tell them apart."""
    assert fee_base("per_period_gain") == "period_interest_no_hwm"
    assert fee_base("per_period_gain") != fee_base("high_water_mark")
    assert "hwm" not in fee_base("per_period_gain").replace("no_hwm", "")
