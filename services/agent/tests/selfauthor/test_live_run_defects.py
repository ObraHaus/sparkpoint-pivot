# ruff: noqa: S101
"""034 — three defects the FIRST LIVE RUN found, each pinned so it cannot come back.

Every one of these passed the full suite and the production build. They were only visible once a
real run published real documents against real data, which is the argument for verifying live
rather than declaring done at green.
"""

from __future__ import annotations

import inspect
from decimal import Decimal

from sparkpoint_agent.api import self_authoring_runner
from sparkpoint_agent.selfauthor import sources
from sparkpoint_agent.selfauthor.documents import DOCUMENTS
from sparkpoint_agent.selfauthor.evidence import Evidence, label_name


def test_a_published_figure_never_shows_a_database_column_name() -> None:
    """The first live run published:

        "aave_supply_apy_bps_mainnet on Base mainnet: 3.48%"

    A column name, in a document written for users. Correct, and unreadable."""
    item = Evidence(
        source="defillama", label="aave_supply_apy_bps_mainnet", value=Decimal("348"), chain_id=8453
    )
    described = item.describe()
    assert "aave_supply_apy_bps_mainnet" not in described
    assert "Aave's USDC supply rate" in described
    assert "Base mainnet" in described, "the chain is still named — that rule is unchanged"


def test_an_unnamed_label_reads_badly_rather_than_breaking() -> None:
    """A new label with no entry should be ugly, not fatal — the fix is then one line."""
    assert label_name("some_new_label") == "some new label"
    assert "_" not in label_name("some_new_label")


def test_every_document_can_actually_be_written() -> None:
    """The first live run wrote FIVE of six. `self-authored-vault-fee-comparison` needs
    `vault_performance_fee_bps` and nothing produced it, so a document the client specifically
    asked for could never exist. A defined document with no source is worse than no document: it
    looks like a feature that quietly failed."""
    produced = set()
    for name in ("fetch_chain", "fetch_defillama", "fetch_own_corpus", "fetch_answer_gaps"):
        produced |= {
            line.split('label="')[1].split('"')[0]
            for line in inspect.getsource(getattr(sources, name)).split("\n")
            if 'label="' in line
        }

    orphans = [
        f"{doc.slug} needs {label}"
        for doc in DOCUMENTS
        for label in doc.needs
        if label not in produced
    ]
    assert not orphans, (
        "these documents can never be written, because nothing produces the evidence they "
        "require:\n  " + "\n  ".join(orphans)
    )


def test_a_declined_run_is_RECORDED_not_merely_returned() -> None:
    """FR-002. The decline was real — the lock held — but invisible: an admin who pressed the
    button twice saw one run and no explanation for the other. "It silently did nothing" and "it
    declined because one was already running" look identical from the console, and only one of
    those is fine."""
    source = inspect.getsource(self_authoring_runner.run_once)
    lock_check = source.index("if not got:")
    tail = source[lock_check:]
    assert "open_run" in tail, "a declined run must open a row"
    assert "close_run" in tail, "and close it with the outcome"
    assert "OUTCOME_LOCKED" in tail


def test_our_own_fee_is_not_presented_as_a_testnet_market_rate() -> None:
    """The second live run rendered the performance fee under "On the testnet this alpha runs on",
    beneath the disclaimer that those figures "come from a handful of test wallets" and "are not a
    forecast".

    Both statements are true of a market rate and false of a fee. Read together, they implied our
    10% fee is a testnet artifact that will be different on mainnet. It will not be — and a reader
    making a decision on that would have been misled by us, in exactly the dimension this feature
    exists to protect.
    """
    from sparkpoint_agent.selfauthor.documents import render_document, spec_for

    spec = spec_for("self-authored-vault-fee-comparison")
    assert spec is not None
    fee = Evidence(
        source="chain", label="vault_performance_fee_bps", value=Decimal("1000"), chain_id=84532
    )
    rate = Evidence(
        source="defillama", label="aave_supply_apy_bps_mainnet", value=Decimal("348"), chain_id=8453
    )
    text = render_document(spec, evidence=[fee, rate], claims=[])

    assert "Our own terms" in text
    assert "do not change between the testnet and the live market" in text
    # The fee must appear ABOVE the testnet caveat, not inside it.
    # No testnet MARKET rate in this document, so no testnet block at all.
    assert "On the testnet this alpha runs on" not in text
    assert text.index("performance fee") < text.index("Aave's USDC supply rate")


def test_a_fee_carries_no_chain_clause() -> None:
    """A fee is our term, not something a market on some chain decided."""
    fee = Evidence(
        source="chain", label="vault_performance_fee_bps", value=Decimal("1000"), chain_id=84532
    )
    assert "Base Sepolia" not in fee.describe()
    assert "10.00%" in fee.describe()


def test_a_market_rate_still_names_its_chain() -> None:
    """The terms/rates split must not weaken the rule it sits beside."""
    rate = Evidence(
        source="defillama", label="aave_supply_apy_bps_mainnet", value=Decimal("348"), chain_id=8453
    )
    assert "Base mainnet" in rate.describe()
