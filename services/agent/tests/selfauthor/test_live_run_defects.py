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
from sparkpoint_agent.selfauthor.documents import DOCUMENTS
from sparkpoint_agent.selfauthor.evidence import Evidence, label_name
from sparkpoint_agent.selfauthor import sources


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
        f"require:\n  " + "\n  ".join(orphans)
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
