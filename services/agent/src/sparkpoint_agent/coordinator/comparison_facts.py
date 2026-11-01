"""074 — reviewed structural facts + the deterministic comparison skeleton.

Comparative answers used to be free prose: the model wrote the whole reply, so the same question
produced a different shape on every run (and sometimes a code fallback instead of a comparison).
Spec 074 makes the *structure* a pure function of ``(message, subjects, corpus)``:

* :data:`SUBJECT_FACTS` is a small, reviewed table of STRUCTURAL facts for the protocols
  ``coordinator/comparative.py`` knows. It deliberately contains **no figures and no rankings** —
  a live rate must come from a fresh read with an as-of date, never from a static note.
* :func:`render_comparison` lays the facts out in a fixed order with fixed headings. The only
  model-authored piece is the closing ``Bottom line`` trade-off (1–2 sentences, no winner, no
  advice); :func:`deterministic_bottom_line` is the same-shaped fallback when the model cannot
  supply one.
* Curated vaults add a ``Live figures`` section from the EXISTING curated-board snapshot
  (:func:`format_vault_figures`), with the stored as-of. The model is never asked for a figure.

Wording follows ``knowledge_seed/protocol-basics.md`` and ``knowledge_seed/aave-v3-supply.md`` so
the code-authored facts do not contradict the corpus Sparky can cite. Nothing here fetches,
ranks, or writes; the output is a ``text`` block, which cannot carry an action.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from .comparative import KNOWN_SUBJECTS
from .curated import CuratedPick
from .staleness import as_of_suffix


@dataclass(frozen=True)
class SubjectFacts:
    """One subject's reviewed structural summary — no figures, no ranking."""

    category: str
    what_it_is: str
    how_yield_is_made: str
    main_risks: str
    fees_and_structure: str
    custody: str


#: Every subject in ``comparative._KNOWN`` must have an entry (pinned by a unit test). The order
#: is irrelevant for rendering (the message's subject order wins), but keeping the alias-table
#: order makes review easy.
SUBJECT_FACTS: Mapping[str, SubjectFacts] = {
    "Aave": SubjectFacts(
        category="lending market",
        what_it_is=(
            "Aave is a decentralised lending protocol: a shared liquidity pool where suppliers "
            "deposit an asset and receive an interest-bearing receipt token."
        ),
        how_yield_is_made=(
            "Borrowers pay interest into the shared pool; the supplier's balance grows as that "
            "interest accrues, and the supply rate is variable and driven by utilisation."
        ),
        main_risks=(
            "Risk is concentrated in one shared market plus the protocol contracts; rates can "
            "fall as well as rise, and positions are not insured."
        ),
        fees_and_structure=(
            "A direct supply pays the protocol's own market rate; SparkPoint's Aave Yield Vault "
            "wraps the same market in an ERC-4626 vault with a performance fee on gains."
        ),
        custody=(
            "Non-custodial: the supplier holds the receipt token and can withdraw while the pool "
            "has free liquidity."
        ),
    ),
    "Morpho": SubjectFacts(
        category="lending framework and vault curator layer",
        what_it_is=(
            "Morpho is a lending framework built around isolated markets and curated vaults "
            "rather than one shared pool."
        ),
        how_yield_is_made=(
            "A curated vault allocates across markets chosen by its curator, so depositors earn "
            "the rates of those specific markets."
        ),
        main_risks=(
            "Underlying market risk plus the curator's allocation choices and the liquidity "
            "profile of the selected markets; curation adds a layer of risk as well as expertise, "
            "and positions are not insured."
        ),
        fees_and_structure=(
            "A Morpho-based curated vault may carry a SparkPoint performance-fee wrapper; curator "
            "and vault fees depend on the individual vault's terms."
        ),
        custody=(
            "Non-custodial: depositors hold a vault share and depend on that vault's liquidity "
            "for withdrawals."
        ),
    ),
    "Compound": SubjectFacts(
        category="lending market",
        what_it_is=(
            "Compound is a decentralised lending protocol in the same broad shape as Aave: "
            "suppliers deposit into shared pools and receive a yield-bearing balance."
        ),
        how_yield_is_made=(
            "Borrowers pay interest into the shared pools; suppliers earn a variable rate driven "
            "by utilisation."
        ),
        main_risks=(
            "Smart-contract risk, governance risk (parameter changes follow its token governance) "
            "and the market risk of the listed assets; positions are not insured."
        ),
        fees_and_structure=(
            "A direct supply uses the protocol's own market mechanics; SparkPoint does not wrap "
            "Compound in a vault."
        ),
        custody=(
            "Non-custodial: the supplier holds the protocol balance and can withdraw subject to "
            "available liquidity."
        ),
    ),
    "Lido": SubjectFacts(
        category="liquid staking",
        what_it_is=(
            "Lido is a liquid-staking protocol for Ethereum: a user deposits ETH and receives a "
            "liquid staking token that represents the staked position."
        ),
        how_yield_is_made=(
            "Staking rewards accrue to the liquid staking token, which can be transferred or used "
            "elsewhere instead of being locked."
        ),
        main_risks=(
            "Smart-contract risk, validator-operation risk, withdrawal-queue and liquidity risk, "
            "and the possibility that the token trades below the value of the underlying ETH; "
            "positions are not insured."
        ),
        fees_and_structure=(
            "The protocol takes a staking fee as part of its mechanics; SparkPoint does not add a "
            "fee for holding the token."
        ),
        custody=(
            "Non-custodial: the user holds the liquid staking token; staking and withdrawal follow "
            "the protocol's queue."
        ),
    ),
    "Rocket Pool": SubjectFacts(
        category="liquid staking",
        what_it_is=(
            "Rocket Pool is a decentralised liquid-staking protocol for Ethereum: users deposit "
            "ETH and receive a liquid staking token backed by staked ETH run by independent node "
            "operators."
        ),
        how_yield_is_made=(
            "Staking rewards accrue to the liquid staking token; the staking is operated by a "
            "network of independent node operators."
        ),
        main_risks=(
            "Smart-contract risk, node-operator performance and penalty risk, withdrawal-queue and "
            "liquidity risk, and the possibility that the token trades below the value of the "
            "underlying ETH; positions are not insured."
        ),
        fees_and_structure=(
            "The protocol and its node operators take fees as part of the staking mechanics; "
            "SparkPoint does not add a fee for holding the token."
        ),
        custody=(
            "Non-custodial: the user holds the liquid staking token; staking and withdrawal follow "
            "the protocol's queue."
        ),
    ),
    "SparkPoint Vault": SubjectFacts(
        category="ERC-4626 yield vault",
        what_it_is=(
            "The SparkPoint Vault is an ERC-4626 USDC vault: a non-custodial wrapper that routes "
            "the deposit into an Aave v3 lending leg."
        ),
        how_yield_is_made=(
            "The vault earns the underlying Aave USDC lending rate and passes it through to vault "
            "shares; the rate is variable with utilisation."
        ),
        main_risks=(
            "The underlying Aave market and contract risk, plus the vault wrapper's own contracts "
            "and fee logic; the rate is variable and positions are not insured."
        ),
        fees_and_structure=(
            "A performance fee applies only to gains above a high-water mark — never to a deposit, "
            "a withdrawal, or a flat or losing position."
        ),
        custody=(
            "Non-custodial: the user holds the vault shares and signs every deposit and withdrawal "
            "from their own wallet."
        ),
    ),
    "Aerodrome": SubjectFacts(
        category="DEX / automated market maker",
        what_it_is=(
            "Aerodrome is a decentralised exchange on Base built around liquidity pools and an "
            "automated market maker."
        ),
        how_yield_is_made=(
            "Liquidity providers earn a share of the pool's trading fees plus any pool incentives, "
            "which depend on the specific pool."
        ),
        main_risks=(
            "Impermanent loss, changing pool incentives and liquidity, smart-contract risk and "
            "governance risk; positions are not insured."
        ),
        fees_and_structure=(
            "Swap and pool fees depend on the pool; SparkPoint does not add a fee for using the "
            "DEX itself."
        ),
        custody=(
            "Non-custodial: liquidity is supplied to a pool and represented by LP tokens held in "
            "the user's wallet."
        ),
    ),
    "Uniswap": SubjectFacts(
        category="DEX / automated market maker",
        what_it_is=(
            "Uniswap is a decentralised exchange on multiple chains built around liquidity pools "
            "and an automated market maker."
        ),
        how_yield_is_made=(
            "Liquidity providers earn a share of the trading fees charged by the pool they supply."
        ),
        main_risks=(
            "Impermanent loss, liquidity and fee-tier changes, smart-contract risk and governance "
            "risk; positions are not insured."
        ),
        fees_and_structure=(
            "Each pool has its own fee tier set by its structure; SparkPoint does not add a fee "
            "for using the DEX itself."
        ),
        custody=(
            "Non-custodial: liquidity is supplied to a pool and represented by LP tokens held in "
            "the user's wallet."
        ),
    ),
    "Curve": SubjectFacts(
        category="DEX / stableswap automated market maker",
        what_it_is=(
            "Curve is a decentralised exchange specialising in low-slippage pools, especially for "
            "stablecoins and similarly priced assets."
        ),
        how_yield_is_made=(
            "Liquidity providers earn a share of trading fees plus any pool incentives, which "
            "depend on the specific pool."
        ),
        main_risks=(
            "Stablecoin or asset depeg risk, impermanent loss, smart-contract risk and governance "
            "risk; positions are not insured."
        ),
        fees_and_structure=(
            "Pool fees and incentives depend on the specific pool; SparkPoint does not add a fee "
            "for using the DEX itself."
        ),
        custody=(
            "Non-custodial: liquidity is supplied to a pool and represented by LP tokens held in "
            "the user's wallet."
        ),
    ),
    "Balancer": SubjectFacts(
        category="DEX / weighted-pool automated market maker",
        what_it_is=(
            "Balancer is a decentralised exchange built around configurable, weighted liquidity "
            "pools."
        ),
        how_yield_is_made=(
            "Liquidity providers earn a share of trading fees plus any pool incentives, which "
            "depend on the pool's composition and weights."
        ),
        main_risks=(
            "Impermanent loss, pool-composition and weight changes, smart-contract risk and "
            "governance risk; positions are not insured."
        ),
        fees_and_structure=(
            "Pool fees and weights depend on the specific pool; SparkPoint does not add a fee for "
            "using the DEX itself."
        ),
        custody=(
            "Non-custodial: liquidity is supplied to a pool and represented by LP tokens held in "
            "the user's wallet."
        ),
    ),
    "EigenLayer": SubjectFacts(
        category="restaking layer",
        what_it_is=(
            "EigenLayer is a restaking protocol on Ethereum: staked ETH can be re-used to secure "
            "additional services through operators and strategies."
        ),
        how_yield_is_made=(
            "Restaking rewards come from the services secured plus the underlying staking "
            "rewards, depending on the operator and strategy chosen."
        ),
        main_risks=(
            "Slashing risk, operator performance, strategy and smart-contract risk, and the "
            "liquidity of the restaked position; positions are not insured."
        ),
        fees_and_structure=(
            "Operator and service fees depend on the chosen arrangement; SparkPoint does not add a "
            "fee for the restaking layer itself."
        ),
        custody=(
            "Non-custodial: the restaked position is held by the user through the protocol's "
            "contracts."
        ),
    ),
    "Pendle": SubjectFacts(
        category="yield-trading protocol",
        what_it_is=(
            "Pendle is a yield-trading protocol that separates a yield-bearing asset into a "
            "principal token and a yield token that can be traded separately."
        ),
        how_yield_is_made=(
            "The yield token captures the underlying yield while the principal token is bought at "
            "a discount to its value at maturity."
        ),
        main_risks=(
            "Maturity and liquidity risk, smart-contract risk, and the risk of the underlying "
            "yield source; positions are not insured."
        ),
        fees_and_structure=(
            "Market fees depend on the specific market; SparkPoint does not add a fee for the "
            "protocol itself."
        ),
        custody=(
            "Non-custodial: the principal and yield positions are held by the user through the "
            "protocol's contracts."
        ),
    ),
    "Sky": SubjectFacts(
        category="lending and stablecoin protocol",
        what_it_is=(
            "Sky is a decentralised lending and stablecoin protocol; users can hold its stablecoin "
            "and earn a savings rate."
        ),
        how_yield_is_made=(
            "The savings rate is funded by stability fees paid by borrowers against collateral."
        ),
        main_risks=(
            "Governance risk, collateral and market risk, and smart-contract risk; positions are "
            "not insured."
        ),
        fees_and_structure=(
            "Stability and savings mechanics are set by the protocol's governance; SparkPoint does "
            "not add a fee."
        ),
        custody=(
            "Non-custodial: the user holds the stablecoin and any savings position in their own "
            "wallet."
        ),
    ),
    "MakerDAO": SubjectFacts(
        category="lending and stablecoin protocol (legacy name for Sky)",
        what_it_is=(
            "MakerDAO is the original name of the lending and stablecoin protocol now known as "
            "Sky; it issues a stablecoin against collateral."
        ),
        how_yield_is_made=(
            "Savings rates are funded by stability fees paid by borrowers against collateral."
        ),
        main_risks=(
            "Governance risk, collateral and market risk, and smart-contract risk; positions are "
            "not insured."
        ),
        fees_and_structure=(
            "Stability and savings mechanics are set by governance; SparkPoint does not add a fee."
        ),
        custody=(
            "Non-custodial: the user holds the stablecoin and any savings position in their own "
            "wallet."
        ),
    ),
}


#: A curated vault is described from its stored board row, not from a static protocol entry. The
#: structural wording is shared; every figure comes from ``format_vault_figures`` instead.
CURATED_VAULT_FACTS = SubjectFacts(
    category="curated ERC-4626 vault",
    what_it_is=(
        "A screened vault on SparkPoint's curated board: an ERC-4626 vault run by the curator "
        "named in the live record below."
    ),
    how_yield_is_made=(
        "The vault's own allocation strategy produces the yield; the net APY below is the "
        "board's stored figure, not a live quote."
    ),
    main_risks=(
        "The curator's allocation and liquidity choices, the underlying market risk and "
        "smart-contract risk; positions are not insured."
    ),
    fees_and_structure=(
        "Vault, curator and any SparkPoint wrapper fees follow the stored record below."
    ),
    custody=(
        "Non-custodial: the user holds the vault shares in their own wallet and signs deposits "
        "and withdrawals."
    ),
)


def facts_for(subject: str) -> SubjectFacts | None:
    """The reviewed structural facts for ``subject``, or ``None`` when it is not a known one."""
    return SUBJECT_FACTS.get(subject)


def _render_facts(subject: str, vault_subjects: Sequence[str]) -> SubjectFacts | None:
    """Facts for a protocol, or the shared curated-vault structure, or ``None``."""
    return SUBJECT_FACTS.get(subject) or (
        CURATED_VAULT_FACTS if subject in vault_subjects else None
    )


def known_fact_subjects(subjects: Sequence[str]) -> tuple[str, ...]:
    """The subset of ``subjects`` that has reviewed facts, preserving the input order."""
    return tuple(subject for subject in subjects if subject in SUBJECT_FACTS)


def _join_names(names: Sequence[str]) -> str:
    if not names:
        return "the options you asked about"
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} and {names[-1]}"


def _bold(name: str) -> str:
    return f"**{name}**"


def _fmt_apy(bps: int | None) -> str:
    if bps is None:
        return "not available right now"
    return f"{bps / 100:.2f}%"


def _fmt_usd(value: float | None) -> str:
    if value is None:
        return "not available right now"
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.1f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:.0f}k"
    return f"${value:.0f}"


def format_vault_figures(pick: CuratedPick) -> str:
    """One deterministic ``Live figures`` line from the stored curated-board row."""
    curator = pick.curator or "not listed"
    if pick.curator and pick.curator_verified:
        curator = f"{curator} (verified)"
    fee = (
        "SparkPoint performance-fee wrapper on gains above a high-water mark"
        if pick.wrapped
        else "no SparkPoint fee; deposited directly into the vault contract"
    )
    as_of = as_of_suffix(pick.as_of, style="space")
    return (
        f"net APY {_fmt_apy(pick.net_apy_bps)}, TVL {_fmt_usd(pick.tvl_usd)}, "
        f"curator {curator}; {fee}{as_of}"
    )


def deterministic_bottom_line(
    subjects: Sequence[str], *, vault_subjects: Sequence[str] = ()
) -> str:
    """The same-shaped Bottom line when the model cannot supply one. No winner, no advice."""
    names = _join_names([subject for subject in subjects if _render_facts(subject, vault_subjects)])
    return (
        f"The trade-off is structural rather than a ranking: {names} differ in how the yield is "
        "produced and who controls the contracts and parameters, so the right fit depends on "
        "which risks you can tolerate. This is information, not advice."
    )


def render_comparison(
    subjects: Sequence[str],
    *,
    covered: Sequence[str] = (),
    figures: Mapping[str, str] | None = None,
    bottom_line: str | None = None,
    include_bottom_line: bool = True,
    vault_subjects: Sequence[str] = (),
) -> str | None:
    """Render the byte-stable comparison skeleton, or ``None`` when no subject is described.

    ``subjects`` is the canonical, message-ordered subject list. ``covered`` is the subset the
    corpus actually grounded (used only for the honest coverage note; it never changes the
    structural sections). ``figures`` maps curated-vault display names to their stored
    ``Live figures`` line. ``vault_subjects`` are the curated-vault labels, described from the
    shared curated-vault structure plus their stored figures. The Bottom line is the only
    caller-supplied, model-authored text.
    """
    described = [subject for subject in subjects if _render_facts(subject, vault_subjects)]
    if not described:
        return None
    unverified = [subject for subject in subjects if _render_facts(subject, vault_subjects) is None]
    covered_set = set(covered)
    vault_set = set(vault_subjects)
    # A curated vault is described from the board, not the corpus, so it never gets the
    # "no retrieved source material" note (its figures carry their own stored as-of).
    ungrounded = [
        subject for subject in described if subject not in covered_set and subject not in vault_set
    ]

    paragraphs: list[str] = []
    if len(subjects) == 1:
        paragraphs.append(f"Here's a structural summary of {_bold(subjects[0])}.")
    else:
        paragraphs.append(
            "Here's a side-by-side comparison of "
            f"{', '.join(_bold(s) for s in subjects[:-1])} and {_bold(subjects[-1])}."
        )
    if unverified:
        paragraphs.append(
            f"SparkPoint has no verified material for {_join_names(unverified)}, so that option "
            "is not described below."
        )
    if ungrounded:
        paragraphs.append(
            f"SparkPoint has no retrieved source material for {_join_names(ungrounded)}; the "
            "summary below uses reviewed structural facts, not a citation."
        )

    sections = (
        ("What it is", "what_it_is"),
        ("How the yield is made", "how_yield_is_made"),
        ("Main risks", "main_risks"),
        ("Fees & structure", "fees_and_structure"),
    )
    for heading, field in sections:
        if field == "fees_and_structure":
            # Custody belongs with fees/structure: who holds what, and how it can move.
            lines = []
            for subject in described:
                facts = _render_facts(subject, vault_subjects)
                assert facts is not None  # noqa: S101 — ``described`` came from this check
                lines.append(
                    f"{_bold(subject)} — {facts.fees_and_structure} Custody: {facts.custody}"
                )
        else:
            lines = [
                f"{_bold(subject)} — {getattr(_render_facts(subject, vault_subjects), field)}"
                for subject in described
            ]
        paragraphs.append(f"**{heading}**\n" + "\n".join(lines))

    if figures:
        live = [
            f"{_bold(subject)} — {figures[subject]}" for subject in subjects if subject in figures
        ]
        if live:
            paragraphs.append("**Live figures**\n" + "\n".join(live))

    if include_bottom_line:
        closing = bottom_line.strip() if bottom_line and bottom_line.strip() else ""
        fallback = deterministic_bottom_line(subjects, vault_subjects=vault_subjects)
        paragraphs.append("**Bottom line**\n" + (closing or fallback))
    return "\n\n".join(paragraphs)


def curated_figures(
    subjects: Sequence[str],
    picks: Sequence[CuratedPick],
) -> dict[str, str]:
    """Map each named curated vault (by label) to its stored, deterministic figures line."""
    by_label: dict[str, CuratedPick] = {}
    for pick in picks:
        by_label.setdefault(pick.label.lower(), pick)
    return {
        subject: format_vault_figures(by_label[subject.lower()])
        for subject in subjects
        if subject.lower() in by_label
    }


def curated_label_subjects(
    message: str,
    picks: Sequence[CuratedPick],
) -> tuple[tuple[int, str], ...]:
    """Curated vault labels named in ``message``, as ``(position, label)`` in message order."""
    found: list[tuple[int, str]] = []
    for pick in picks:
        label = pick.label.strip()
        if not label:
            continue
        pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(label)}(?![A-Za-z0-9])", re.IGNORECASE)
        match = pattern.search(message)
        if match is not None:
            found.append((match.start(), label))
    found.sort(key=lambda item: item[0])
    return tuple(found)


__all__ = [
    "SUBJECT_FACTS",
    "SubjectFacts",
    "KNOWN_SUBJECTS",
    "curated_figures",
    "curated_label_subjects",
    "deterministic_bottom_line",
    "facts_for",
    "format_vault_figures",
    "known_fact_subjects",
    "render_comparison",
]
