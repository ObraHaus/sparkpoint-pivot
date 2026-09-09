# ruff: noqa: S101
"""034 — the check that decides whether a run may publish at all.

The finding that shaped the whole feature: retrieval quality falls as a corpus grows, and it fails
SILENTLY. Nothing errors; a question answered well last month quietly starts returning last
Tuesday's rate note. Self-verification is what separates a loop that improves from one that decays,
and this is that verification.
"""

from __future__ import annotations

from dataclasses import dataclass

import pytest

from sparkpoint_agent.selfauthor.selfcheck import (
    ACCEPTABLE_RANK,
    GOLDEN_QUESTIONS,
    GoldenQuestion,
    evaluate,
    run_check,
)


@dataclass
class Hit:
    source_kind: str


FEES = GoldenQuestion(question="What fees?", expect_kinds=("knowledge",), why="money")


# ── the golden set itself ────────────────────────────────────────────────────


def test_the_withdraw_question_is_in_the_set() -> None:
    """The exit path is the one place the product promises never to be in the way. If a research
    note ever outranks it, that must stop a publish."""
    assert any("withdraw" in q.question.lower() for q in GOLDEN_QUESTIONS)


def test_the_set_covers_fees_custody_and_the_rate() -> None:
    joined = " ".join(q.question.lower() for q in GOLDEN_QUESTIONS)
    assert "fee" in joined
    assert "custodial" in joined
    assert "apy" in joined


def test_no_golden_question_expects_a_self_authored_source() -> None:
    """These questions exist to catch self-authored material displacing documentation. If one of
    them accepted `self_authored` as a right answer, it could never catch that."""
    for question in GOLDEN_QUESTIONS:
        assert "self_authored" not in question.expect_kinds, question.question


# ── evaluation ───────────────────────────────────────────────────────────────


def test_the_expected_source_at_the_top_passes() -> None:
    assert evaluate(FEES, [Hit("knowledge"), Hit("self_authored")]) is None


def test_the_expected_source_just_within_reach_still_passes() -> None:
    """Not rank 1: retrieval jitter between near-identical scores is normal and would make this
    flap. Rank 3 of 5 is "still findable", which is what actually matters to an answer."""
    hits = [Hit("self_authored")] * (ACCEPTABLE_RANK - 1) + [Hit("knowledge")]
    assert evaluate(FEES, hits) is None


def test_the_expected_source_pushed_out_of_reach_is_a_regression() -> None:
    """This is the failure the whole feature is designed around, caught deterministically."""
    hits = [Hit("self_authored")] * 5
    regression = evaluate(FEES, hits)
    assert regression is not None
    assert regression.question == "What fees?"
    assert regression.got_kinds[0] == "self_authored"


def test_a_question_that_retrieves_NOTHING_is_not_blamed_on_this_run() -> None:
    """The corpus may simply not cover it — a different problem, and not one a self-authoring run
    created. Blocking on it would let an unrelated gap permanently block the feature."""
    assert evaluate(FEES, []) is None


# ── the run ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_a_clean_corpus_passes_every_question() -> None:
    async def search(_q: str, _k: int) -> list[Hit]:
        return [Hit("knowledge")]

    result = await run_check(search)
    assert result.passed
    assert result.checked == len(GOLDEN_QUESTIONS)
    assert "passed" in result.summary()


@pytest.mark.asyncio
async def test_one_regression_fails_the_whole_check_and_names_it() -> None:
    async def search(question: str, _k: int) -> list[Hit]:
        return [Hit("self_authored")] * 5 if "fees" in question.lower() else [Hit("knowledge")]

    result = await run_check(search)
    assert result.passed is False
    assert len(result.regressed) == 1
    assert "fees" in result.regressed[0].question.lower()
    assert "FAILED" in result.summary()


@pytest.mark.asyncio
async def test_retrieval_being_unavailable_is_INCONCLUSIVE_not_passed() -> None:
    """A check that could not run has proved nothing. Treating "I couldn't look" as "it's fine" is
    exactly how a safety check becomes decoration."""

    async def search(_q: str, _k: int) -> list[Hit]:
        raise RuntimeError("embedder down")

    result = await run_check(search)
    assert result.inconclusive is True
    assert result.passed is False, "inconclusive must NOT publish"
    assert "could not run" in result.summary()
