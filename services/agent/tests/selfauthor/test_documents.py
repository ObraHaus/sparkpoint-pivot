# ruff: noqa: S101
"""034 — six living documents, and the rendering rules that keep them honest.

Six is a CEILING, not a target, and it is the whole reason this feature does not degrade the
assistant: retrieval quality falls as a corpus grows, and the failure is silent. A generated slug
would create a seventh document, then a hundredth, and nobody would notice until a question that
used to work stopped working.
"""

from __future__ import annotations

from decimal import Decimal

from sparkpoint_agent.selfauthor.claims import Claim
from sparkpoint_agent.selfauthor.documents import (
    DOCUMENT_SLUGS,
    DOCUMENTS,
    MAX_DOCUMENTS,
    STATUS_RETIRED,
    has_what_it_needs,
    is_publishable_now,
    render_document,
    spec_for,
)
from sparkpoint_agent.selfauthor.evidence import Evidence

MAINNET = Evidence(
    source="defillama", label="aave_supply_apy_bps_mainnet", value=Decimal("348"), chain_id=8453
)
TESTNET = Evidence(
    source="chain", label="vault_net_apy_bps_testnet", value=Decimal("40"), chain_id=84532
)
QUOTE = Evidence(
    source="prose",
    label="aave_docs",
    quote="The supply rate is a function of utilisation.",
    attribution="docs.aave.com",
    url="https://docs.aave.com/v3",
)
YIELDS = spec_for("self-authored-base-usdc-yields")
assert YIELDS is not None


# ── the ceiling ──────────────────────────────────────────────────────────────


def test_there_are_exactly_six_documents_and_the_list_is_closed() -> None:
    assert MAX_DOCUMENTS == 6
    assert len(DOCUMENTS) == len(DOCUMENT_SLUGS) == 6, "no duplicate slugs"


def test_every_slug_is_stable_and_namespaced() -> None:
    """The slug is what makes rewriting in place work: ingest_note derives chunk ids from
    (source, index), so a rewrite replaces exactly this document's chunks and nothing else."""
    for spec in DOCUMENTS:
        assert spec.slug.startswith("self-authored-"), spec.slug
        assert spec.slug == spec.slug.lower()
        assert " " not in spec.slug


def test_an_unknown_slug_resolves_to_nothing_rather_than_a_new_document() -> None:
    assert spec_for("self-authored-whatever-the-model-invented") is None


# ── nothing fetched, nothing written ─────────────────────────────────────────


def test_a_document_without_its_evidence_is_not_rewritten() -> None:
    """A half-empty rewrite would replace a good document with a worse one, which is the opposite
    of the point. Left exactly as it was."""
    assert has_what_it_needs(YIELDS, [MAINNET]) is False
    assert has_what_it_needs(YIELDS, [MAINNET, TESTNET]) is True
    assert has_what_it_needs(YIELDS, []) is False


def test_unpublishable_evidence_does_not_count_towards_what_a_document_needs() -> None:
    chainless = Evidence(source="chain", label="vault_net_apy_bps_testnet", value=Decimal("40"))
    assert has_what_it_needs(YIELDS, [MAINNET, chainless]) is False


# ── rendering ────────────────────────────────────────────────────────────────


def test_testnet_and_mainnet_figures_render_in_SEPARATE_labelled_passages() -> None:
    """Presenting 0.44% beside 3.48% as a choice is the most misleading thing this feature could
    produce — the alpha figure is not a worse option, it is a different world."""
    text = render_document(YIELDS, evidence=[MAINNET, TESTNET], claims=[])
    assert "In the live market" in text
    assert "On the testnet this alpha runs on" in text
    assert text.index("In the live market") < text.index("On the testnet")
    assert "not a forecast" in text


def test_every_rendered_figure_names_its_chain() -> None:
    text = render_document(YIELDS, evidence=[MAINNET, TESTNET], claims=[])
    assert "Base mainnet" in text
    assert "Base Sepolia (testnet)" in text


def test_the_document_says_what_it_is_in_its_own_words() -> None:
    """The citation label says it too, but a reader who sees the text without the citation should
    still be able to tell it from documentation a person wrote and checked."""
    text = render_document(YIELDS, evidence=[MAINNET, TESTNET], claims=[])
    assert "written by Sparky" in text
    assert "not yet reviewed" in text


def test_fetched_prose_is_quoted_and_attributed_never_absorbed() -> None:
    text = render_document(YIELDS, evidence=[MAINNET, QUOTE], claims=[])
    assert "> The supply rate is a function of utilisation." in text
    assert "docs.aave.com" in text


def test_withheld_claims_simply_do_not_appear() -> None:
    """The document says LESS, never something false."""
    kept = Claim(
        topic="market_conditions", text="Rates moved slightly this week.", evidence_labels=("x",)
    )
    text = render_document(YIELDS, evidence=[MAINNET], claims=[kept])
    assert "Rates moved slightly this week." in text
    assert "What this means" in text


def test_a_document_with_no_claims_still_renders_its_figures() -> None:
    text = render_document(YIELDS, evidence=[MAINNET], claims=[])
    assert "3.48%" in text
    assert "What this means" not in text


# ── the draft window ─────────────────────────────────────────────────────────

HOUR = 3600.0
NOW = 1_000_000.0


def test_manual_mode_never_publishes_on_its_own() -> None:
    assert is_publishable_now(
        status="draft", publish_mode="manual", first_written_at_epoch=NOW - 10_000 * HOUR,
        draft_window_hours=0, now_epoch=NOW,
    ) is False


def test_automatic_mode_waits_for_the_window_then_publishes() -> None:
    common = {
        "status": "draft", "publish_mode": "automatic",
        "draft_window_hours": 336, "now_epoch": NOW,
    }
    assert is_publishable_now(first_written_at_epoch=NOW - 100 * HOUR, **common) is False
    assert is_publishable_now(first_written_at_epoch=NOW - 336 * HOUR, **common) is True


def test_a_zero_window_publishes_on_the_run_that_writes_it() -> None:
    assert is_publishable_now(
        status="draft", publish_mode="automatic", first_written_at_epoch=NOW,
        draft_window_hours=0, now_epoch=NOW,
    ) is True


def test_the_window_runs_from_FIRST_write_not_from_the_last_rewrite() -> None:
    """If the clock restarted on every rewrite, a document rewritten daily would never leave draft —
    unreachable by construction, and it would take weeks to notice."""
    assert is_publishable_now(
        status="draft", publish_mode="automatic",
        first_written_at_epoch=NOW - 400 * HOUR,   # first written long ago; rewritten today
        draft_window_hours=336, now_epoch=NOW,
    ) is True


def test_a_retired_document_never_publishes() -> None:
    assert is_publishable_now(
        status=STATUS_RETIRED, publish_mode="automatic", first_written_at_epoch=0,
        draft_window_hours=0, now_epoch=NOW,
    ) is False
