"""Canonical performance-fee disclosure copy, keyed on how the fee actually accrues.

The service-side mirror of ``apps/web/src/lib/policy/feeCopy.ts``. The ``high_water_mark`` strings
here are byte-identical to the web constants and to ``agent-service-api.md`` §3.7 — 015/FR-006
requires the deposit confirm gate to render the agent's ``disclosure`` VERBATIM, so a drift between
the two files is a user-visible defect, not a cosmetic one. ``tests/policy/test_fee_copy.py`` pins
both the strings and the parity.

WHY A BASIS AND NOT A CONSTANT (024/T024, constitution v3.0.0)
-------------------------------------------------------------
Ratifying Morpho Vault V2 **Fee Wrappers** carried an explicit DISCLOSURE obligation. The two fee
mechanics differ, and the difference is adverse to the user:

* ``high_water_mark`` — SparkPoint's own ERC-4626s (the Aave launch vault, and the deployed
  ``SparkPointMorphoVault``) keep a real ``_highWaterMark`` in storage. ``accrueFee()`` returns 0
  whenever price-per-share is at or below that mark, so a depositor who dips and recovers pays
  nothing until back above their previous peak.
* ``per_period_gain`` — a Morpho Vault V2 keeps **no high-water-mark state at all**
  (``interest = newTotalAssets.zeroFloorSub(_totalAssets)``, i.e. ``max(0, new - last)``). The fee
  is charged on each positive increment since the last accrual, with no memory of a prior peak,
  so a gain FOLLOWING an earlier loss IS charged even while the depositor is still under water.

What survives on both bases, and may therefore still be promised unconditionally: never charged on
principal, never charged in a flat or falling period, and taken as share dilution rather than by
withholding assets.

NOTE ON TODAY'S WIRE OUTPUT. The only vault this service resolves is the Aave launch vault, which is
``high_water_mark`` — so every string this module returns today is byte-identical to the constants
it replaced. The ``per_period_gain`` branch exists so the honest wording is in place BEFORE a Fee
Wrapper can accept a deposit, which is exactly what the ratified obligation requires.
"""

from __future__ import annotations

from typing import Final, Literal

#: How a vault's performance fee accrues. Mirrors the web ``VaultFeeBasis`` union.
FeeBasis = Literal["high_water_mark", "per_period_gain"]

#: The registry vault kinds (migration 0026 ``vault_kind``) this maps from.
VaultKind = Literal["first_party", "legacy_wrapper", "fee_wrapper", "external_4626"]

#: Kinds whose contract holds a real ``_highWaterMark``. Everything else is conservative.
_HWM_KINDS: Final[frozenset[str]] = frozenset({"first_party", "legacy_wrapper"})

# §3.7 disclosure strings — rendered VERBATIM (do not paraphrase). The deposit form carries the
# fuller custody statement; the withdraw form is the short profit-only line.
_HWM_DEPOSIT_DISCLOSURE: Final = (
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on "
    "your principal. We only earn when you earn — never on your principal, never by "
    "taking custody."
)
_HWM_WITHDRAW_DISCLOSURE: Final = (
    "SparkPoint performance fee: 10% of yield, profit-only, high-water mark — 0% on "
    "your principal."
)

# Ratified Fee Wrapper wording (v3.0.0 amendment, "The SECOND genuine weakening"). The under-water
# clause is the entire point of the string — never trim it for length.
_PER_PERIOD_DEPOSIT_DISCLOSURE: Final = (
    "SparkPoint performance fee: 10% of yield, charged only when the vault gains value "
    "over a period — never on your principal, and never while it is flat or falling. "
    "Note a gain following an earlier loss is charged, even if you are still below your "
    "previous high. We only earn when you earn — never by taking custody."
)
_PER_PERIOD_WITHDRAW_DISCLOSURE: Final = (
    "SparkPoint performance fee: 10% of yield, charged only on a period's gain — 0% on "
    "your principal. A gain following an earlier loss is charged."
)

#: ``performanceFee.base`` wire values. The HWM one is the pre-024 constant, unchanged.
_HWM_FEE_BASE: Final = "realized_yield_above_hwm"
_PER_PERIOD_FEE_BASE: Final = "period_interest_no_hwm"


def fee_basis_for_kind(kind: str) -> FeeBasis:
    """The fee basis implied by a registry vault ``kind``.

    Unknown kinds fall to ``per_period_gain`` deliberately: that is the weaker promise, so an
    unrecognised vault can never inherit a high-water-mark guarantee it may not have.
    """
    return "high_water_mark" if kind in _HWM_KINDS else "per_period_gain"


def deposit_disclosure(basis: FeeBasis = "high_water_mark") -> str:
    """The §3.7 deposit ``performanceFee.disclosure`` for ``basis``, VERBATIM."""
    return (
        _HWM_DEPOSIT_DISCLOSURE
        if basis == "high_water_mark"
        else _PER_PERIOD_DEPOSIT_DISCLOSURE
    )


def withdraw_disclosure(basis: FeeBasis = "high_water_mark") -> str:
    """The §3.7 withdraw ``performanceFee.disclosure`` for ``basis``, VERBATIM."""
    return (
        _HWM_WITHDRAW_DISCLOSURE
        if basis == "high_water_mark"
        else _PER_PERIOD_WITHDRAW_DISCLOSURE
    )


def fee_base(basis: FeeBasis = "high_water_mark") -> str:
    """The §3.7 ``performanceFee.base`` enum value for ``basis``.

    A consumer keying UI off this string must treat ``period_interest_no_hwm`` as "no high-water
    mark", not as an unknown variant to ignore.
    """
    return _HWM_FEE_BASE if basis == "high_water_mark" else _PER_PERIOD_FEE_BASE
