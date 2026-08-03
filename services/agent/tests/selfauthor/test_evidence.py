# ruff: noqa: S101
"""034 — a figure must know which world it came from, and must be plausible.

Our vault reads 0.44% on Base Sepolia while the identical strategy pays 3.48% on Base mainnet —
roughly eight times more. A bare percentage is therefore not just imprecise, it is wrong by a factor
of eight for whichever reader assumes the other one. These tests pin the two rules that stop that.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

from sparkpoint_agent.selfauthor.evidence import (
    MAX_APY_BPS,
    STATUS_ERROR,
    STATUS_REFUSED,
    Evidence,
    chain_name,
    format_bps,
    is_plausible_apy_bps,
    is_plausible_tvl_usd,
    separates_testnet_from_mainnet,
)

MAINNET = Evidence(
    source="defillama", label="aave_supply_apy_bps", value=Decimal("348"), chain_id=8453
)
TESTNET = Evidence(source="chain", label="vault_net_apy_bps", value=Decimal("40"), chain_id=84532)


def test_a_figure_without_a_chain_is_NOT_publishable() -> None:
    """The whole rule in one assertion. The alternative is a bare percentage that a reader assumes
    applies to them, and on a testnet product that assumption is wrong by a factor of eight."""
    orphan = Evidence(source="defillama", label="apy", value=Decimal("348"), chain_id=None)
    assert orphan.publishable is False
    assert MAINNET.publishable is True


def test_the_chain_is_named_IN_the_sentence_not_in_a_footnote() -> None:
    assert "Base mainnet" in MAINNET.describe()
    assert "Base Sepolia (testnet)" in TESTNET.describe()
    assert "3.48%" in MAINNET.describe()


def test_an_unknown_chain_is_described_honestly_rather_than_hidden() -> None:
    assert chain_name(999) == "chain 999"
    assert chain_name(None) == ""


def test_prose_without_attribution_cannot_be_quoted() -> None:
    """A quotation whose speaker is unknown is indistinguishable from something we wrote and
    checked — and this text came from a third party."""
    anonymous = Evidence(source="prose", label="doc", quote="rates are rising")
    attributed = Evidence(
        source="prose", label="doc", quote="rates are rising", attribution="docs.aave.com"
    )
    assert anonymous.publishable is False
    assert attributed.publishable is True
    assert "docs.aave.com" in attributed.describe()


def test_evidence_that_failed_to_fetch_is_never_publishable() -> None:
    for status in (STATUS_REFUSED, STATUS_ERROR):
        item = Evidence(source="p", label="x", value=Decimal(1), chain_id=8453, status=status)
        assert item.publishable is False


@pytest.mark.parametrize("value", [0, 1, 348, 5000, MAX_APY_BPS])
def test_a_plausible_rate_is_accepted(value: int) -> None:
    assert is_plausible_apy_bps(value)


@pytest.mark.parametrize("value", [-1, MAX_APY_BPS + 1, 90_000, None, "", "abc"])
def test_a_broken_feed_is_rejected_rather_than_written(value: object) -> None:
    """Wide bounds by design: 0% is real on a testnet with no borrowers. A negative rate or a
    900% stablecoin supply APY is a broken feed or a unit error, and writing it down would put a
    fabricated number in front of a user."""
    assert is_plausible_apy_bps(value) is False


@pytest.mark.parametrize(
    "value", [float("nan"), float("inf"), float("-inf"), Decimal("NaN"), "nan"]
)
def test_a_non_finite_figure_is_rejected_rather_than_raising(value: object) -> None:
    """Caught by this test before it shipped: `Decimal("nan")` PARSES, and only the bounds
    comparison raises — so a NaN from a broken feed would have thrown out of a plausibility check
    instead of failing it. This project already shipped `x-chain-id: NaN` once, in 029, because
    `chainId ?? DEFAULT` does not catch NaN either. It is a recurring shape, not a one-off."""
    assert is_plausible_apy_bps(value) is False
    assert is_plausible_tvl_usd(value) is False


def test_tvl_bounds() -> None:
    assert is_plausible_tvl_usd(0)
    assert is_plausible_tvl_usd(Decimal("579800000"))
    assert is_plausible_tvl_usd(Decimal("1e13")) is False
    assert is_plausible_tvl_usd(-1) is False


def test_a_mixed_set_of_figures_is_flagged_so_it_can_be_rendered_apart() -> None:
    """A document may never put a testnet figure beside a mainnet one as if they were competing
    options — that is the single most misleading thing this feature could produce."""
    assert separates_testnet_from_mainnet([MAINNET, TESTNET]) is False
    assert separates_testnet_from_mainnet([MAINNET]) is True
    assert separates_testnet_from_mainnet([TESTNET]) is True
    assert separates_testnet_from_mainnet([]) is True


def test_a_missing_figure_reads_as_unavailable_not_as_zero() -> None:
    """Returning 0 would fabricate a yield. `data/morpho_api.py` already takes this position for
    testnets, and migration 0026 has a CHECK refusing to store it."""
    assert format_bps(None) == "unavailable"
    assert format_bps(Decimal("0")) == "0.00%"
