"""034 — the guard that stops "hold the unflattering findings" becoming "only publish good news".

PURE. This is the smallest module in the feature and the one that decides whether it can be trusted.

THE PROBLEM IT SOLVES. Two client decisions, each reasonable alone, lean the same way. Sparky
describes the landscape without naming competitor products (decision 5), and a finding that reflects
badly on us is written but HELD in the console for an admin to release (decision 7). Nothing there
dishonest. But without a mechanical guard the published set drifts rosy over time — not because
anyone falsified anything, but because every uncomfortable finding sat unreleased. That is the
"write only what's favourable" outcome, arrived at by accident rather than intent, and it is the one
way this feature could damage the trust it exists to build.

THE RULE. A published document may not assert a claim on a topic that a currently-held finding
contradicts. The claim is DROPPED, and the omission is recorded. The document says **less** — never
something false. That is the only version of editorial control that survives a reader checking our
claims against a public data source.

WHY A TOPIC KEY AND NOT A MODEL. Matching is on an explicit key (``fee_competitiveness``), not on a
model judging whether two sentences contradict each other. A model in that role fails quietly, and
"quietly wrong about whether we told the truth about ourselves" is the worst available failure.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Topic keys a claim or finding may carry. Fixed, because a free-text key would let a writer invent
#: `fee_competitiveness_v2` and slip straight past a held finding on `fee_competitiveness`.
TOPICS: frozenset[str] = frozenset(
    {
        "fee_competitiveness",   # how our fee compares to the alternatives
        "yield_competitiveness", # how our returns compare
        "testnet_gap",           # the distance between our testnet figures and the live market
        "protocol_risk",         # something about a protocol we depend on
        "product_capability",    # what the product can and cannot do
        "market_conditions",     # the state of the wider market
    }
)

STATUS_HELD = "held"
STATUS_RELEASED = "released"
STATUS_DISMISSED = "dismissed"


@dataclass(frozen=True)
class Claim:
    """One assertion inside a document, with the evidence behind it."""

    topic: str
    text: str
    evidence_labels: tuple[str, ...] = ()

    @property
    def grounded(self) -> bool:
        """Whether anything supports this claim.

        An ungrounded claim is not a weak claim, it is an invented one. FR-009 requires every claim
        to be traceable to evidence fetched during the run that wrote it, so an empty evidence list
        is disqualifying rather than merely regrettable.
        """
        return bool(self.evidence_labels)


@dataclass(frozen=True)
class Finding:
    """Something a run concluded that an admin must decide about."""

    topic: str
    summary: str
    status: str = STATUS_HELD
    evidence_labels: tuple[str, ...] = ()


@dataclass(frozen=True)
class Withholding:
    """One claim that was dropped, and why — so the omission is recorded rather than invisible."""

    claim: Claim
    reason: str


@dataclass(frozen=True)
class Filtered:
    kept: list[Claim] = field(default_factory=list)
    withheld: list[Withholding] = field(default_factory=list)


def held_topics(findings: list[Finding] | tuple[Finding, ...]) -> set[str]:
    """The topics currently blocked. Only ``held`` blocks — released and dismissed do not."""
    return {f.topic for f in findings if f.status == STATUS_HELD}


def filter_claims(
    claims: list[Claim] | tuple[Claim, ...],
    findings: list[Finding] | tuple[Finding, ...],
    *,
    permitted_evidence: set[str] | None = None,
) -> Filtered:
    """Which claims may be published, and which are withheld and why.

    Three ways a claim is dropped, and all three are recorded:

    * **Ungrounded** — nothing fetched supports it (FR-009).
    * **Evidence withdrawn** — its only support came from a source an admin has since removed from
      the allowlist. FR-028: removing a source must RETIRE what it grounded, not leave the claim
      standing because it was already written.
    * **Contradicted by a held finding** — the guard this module exists for.
    """
    blocked = held_topics(findings)
    kept: list[Claim] = []
    withheld: list[Withholding] = []

    for claim in claims:
        if not claim.grounded:
            withheld.append(Withholding(claim, "no evidence supports this claim"))
            continue
        if permitted_evidence is not None:
            surviving = [label for label in claim.evidence_labels if label in permitted_evidence]
            if not surviving:
                withheld.append(
                    Withholding(
                        claim, "its only evidence came from a source that is no longer allowed"
                    )
                )
                continue
        if claim.topic in blocked:
            withheld.append(
                Withholding(claim, f"a held finding on “{claim.topic}” contradicts this claim")
            )
            continue
        kept.append(claim)

    return Filtered(kept=kept, withheld=withheld)


def oldest_held_age_hours(created_ats: list[float] | tuple[float, ...], now: float) -> float | None:
    """Age in hours of the oldest held finding, or ``None`` if none are held.

    Surfaced in the console (FR-040) alongside the count, because a growing pile of held findings is
    exactly the thing that turns editorial control into silence. A number that goes up is visible in
    a way that "some findings are held" is not.
    """
    if not created_ats:
        return None
    return (now - min(created_ats)) / 3600.0
