# ruff: noqa: S101
"""034 — the guard that stops "hold the unflattering findings" from becoming "only good news".

Two client decisions, each reasonable alone, lean the same way: describe the landscape without
naming competitor products, and hold unflattering findings in the console for an admin to release.
Nothing there is dishonest. But without a mechanical guard the published set drifts rosy over time —
not because anyone falsified anything, but because every uncomfortable finding sat unreleased.

The rule these tests pin: a published document says LESS, never something false.
"""

from __future__ import annotations

from sparkpoint_agent.selfauthor.claims import (
    STATUS_DISMISSED,
    STATUS_HELD,
    STATUS_RELEASED,
    Claim,
    Finding,
    filter_claims,
    held_topics,
    oldest_held_age_hours,
)

CHEAPEST = Claim(
    topic="fee_competitiveness",
    text="Our fee is charged only on profit, and only above the high-water mark.",
    evidence_labels=("vault_performance_fee_bps",),
)
YIELDS = Claim(
    topic="market_conditions",
    text="Managed USDC vaults on Base mainnet currently pay between 4% and 5%.",
    evidence_labels=("defillama_managed_usdc_range",),
)


def test_a_held_finding_withholds_the_claim_it_contradicts() -> None:
    findings = [Finding(topic="fee_competitiveness", summary="A comparable vault charges less.")]
    result = filter_claims([CHEAPEST, YIELDS], findings)

    assert result.kept == [YIELDS], "only the contradicted claim is dropped"
    assert len(result.withheld) == 1
    assert result.withheld[0].claim is CHEAPEST
    assert "held finding" in result.withheld[0].reason


def test_the_omission_is_RECORDED_not_invisible() -> None:
    """A silently shorter document is how "editorial control" becomes "quiet suppression". The
    reason travels with the withheld claim so the run can report it and the console can show it."""
    result = filter_claims([CHEAPEST], [Finding(topic="fee_competitiveness", summary="…")])
    assert result.withheld[0].reason
    assert "fee_competitiveness" in result.withheld[0].reason


def test_releasing_a_finding_lets_the_claim_through() -> None:
    for status in (STATUS_RELEASED, STATUS_DISMISSED):
        findings = [Finding(topic="fee_competitiveness", summary="…", status=status)]
        assert filter_claims([CHEAPEST], findings).kept == [CHEAPEST], status


def test_only_HELD_findings_block() -> None:
    findings = [
        Finding(topic="fee_competitiveness", summary="a", status=STATUS_HELD),
        Finding(topic="market_conditions", summary="b", status=STATUS_RELEASED),
    ]
    assert held_topics(findings) == {"fee_competitiveness"}


def test_an_ungrounded_claim_is_dropped_whatever_it_says() -> None:
    """An ungrounded claim is not a weak claim, it is an invented one. FR-009 requires every claim
    to be traceable to evidence fetched during the run that wrote it."""
    invented = Claim(topic="market_conditions", text="Rates are about to rise.", evidence_labels=())
    result = filter_claims([invented], [])
    assert result.kept == []
    assert "no evidence" in result.withheld[0].reason


def test_removing_a_source_retires_what_it_grounded() -> None:
    """FR-028. A claim whose ONLY evidence came from a now-disallowed source stops being asserted —
    it does not linger because it was already written."""
    result = filter_claims([YIELDS], [], permitted_evidence=set())
    assert result.kept == []
    assert "no longer allowed" in result.withheld[0].reason


def test_a_claim_with_one_surviving_source_still_stands() -> None:
    both = Claim(topic="market_conditions", text="…", evidence_labels=("gone", "still_here"))
    result = filter_claims([both], [], permitted_evidence={"still_here"})
    assert result.kept == [both]


def test_no_findings_and_no_restrictions_keeps_everything_grounded() -> None:
    assert filter_claims([CHEAPEST, YIELDS], []).kept == [CHEAPEST, YIELDS]


def test_the_age_of_the_oldest_held_finding_is_available() -> None:
    """FR-040 — the console shows count AND age, because a growing pile of held findings is exactly
    what turns editorial control into silence, and a number that goes up is visible."""
    now = 1_000_000.0
    assert oldest_held_age_hours([], now) is None
    assert oldest_held_age_hours([now - 3600, now - 7200], now) == 2.0
