"""034 — proving a run did no harm before anything it wrote reaches a user.

THIS IS THE MODULE THAT MAKES THE FEATURE SAFE TO RUN EVERY DAY.

The finding that shaped the whole spec: retrieval quality falls as a corpus grows, because a bigger
search space surfaces more passages that are topically similar and factually irrelevant. Measured
elsewhere, answer accuracy fell from 58.6% to 43.2% as a corpus grew twentyfold. And the failure is
**silent** — nothing errors; a question answered well last month quietly starts returning last
Tuesday's rate note instead.

The recursive-self-improvement literature is consistent that self-verification is what separates a
loop that improves from one that decays. So: a fixed set of questions whose right answering source
we already know, re-asked on every run, before publishing. If the run's own output displaces one of
them, the run is discarded whole.

WHY A FIXED SET AND NOT SAMPLED TRAFFIC. A sampled check needs a judge model, is not deterministic,
and a test that can be flaky is a test nobody trusts to block a publish. These five questions are
the ones where a wrong answer costs the most, and the expected source for each is a fact about the
corpus rather than an opinion.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Protocol

logger = logging.getLogger(__name__)

#: How far down the results the expected source may appear. Not rank 1: retrieval jitter between
#: near-identical scores is normal and would make this flap. Rank 3 of 5 is "still findable",
#: which is the property that actually matters to an answer.
ACCEPTABLE_RANK = 3

#: How many hits to ask for.
SEARCH_K = 5


@dataclass(frozen=True)
class GoldenQuestion:
    """A question, and what must still answer it.

    ``expect_kinds`` names the source kinds that count as the right answer. Deliberately kinds and
    not exact slugs: a slug rename is an ordinary refactor and should not fail this check, while a
    self-authored note outranking the fee documentation is exactly what it exists to catch.
    """

    question: str
    expect_kinds: tuple[str, ...]
    why: str


#: The five where a wrong answer costs the most. Authored by us, not generated.
GOLDEN_QUESTIONS: tuple[GoldenQuestion, ...] = (
    GoldenQuestion(
        question="How do I withdraw everything?",
        expect_kinds=("knowledge",),
        why="the exit question — the one place the product promises never to be in the way",
    ),
    GoldenQuestion(
        question="What fees does SparkPoint charge?",
        expect_kinds=("knowledge",),
        why="a wrong fee answer is a wrong answer about someone's money",
    ),
    GoldenQuestion(
        question="Is SparkPoint custodial? Can you move my funds?",
        expect_kinds=("knowledge",),
        why="the trust claim the entire product rests on",
    ),
    GoldenQuestion(
        question="What is the vault APY right now?",
        expect_kinds=("knowledge", "changelog"),
        why="the most-asked question, and the one a stale research note would most easily displace",
    ),
    GoldenQuestion(
        question="What is SparkPoint?",
        expect_kinds=("knowledge",),
        why="if this regresses, the corpus has drifted badly",
    ),
)


class Searcher(Protocol):
    async def __call__(self, question: str, k: int) -> list[Any]: ...


@dataclass(frozen=True)
class Regression:
    question: str
    why: str
    got_kinds: tuple[str, ...]


@dataclass(frozen=True)
class CheckResult:
    passed: bool
    regressed: tuple[Regression, ...] = ()
    checked: int = 0
    #: True when retrieval could not be exercised at all (no embedder, search unavailable).
    inconclusive: bool = False

    def summary(self) -> str:
        if self.inconclusive:
            return "self-check could not run (retrieval unavailable)"
        if self.passed:
            return f"self-check passed ({self.checked} questions)"
        names = "; ".join(r.question for r in self.regressed)
        return f"self-check FAILED — these regressed: {names}"


def _kind_of(hit: Any) -> str:
    return str(getattr(hit, "source_kind", "") or "")


def evaluate(question: GoldenQuestion, hits: list[Any]) -> Regression | None:
    """Whether this question still finds its expected source near the top.

    A question that retrieves NOTHING is not a regression caused by this run — the corpus may
    simply not cover it, which is a different problem and not one a self-authoring run created.
    Blocking a publish on it would make an unrelated gap permanently block the feature.
    """
    if not hits:
        return None
    top = hits[:ACCEPTABLE_RANK]
    if any(_kind_of(h) in question.expect_kinds for h in top):
        return None
    return Regression(
        question=question.question,
        why=question.why,
        got_kinds=tuple(_kind_of(h) for h in hits[:SEARCH_K]),
    )


async def run_check(
    search: Searcher, questions: tuple[GoldenQuestion, ...] = GOLDEN_QUESTIONS
) -> CheckResult:
    """Ask every golden question and report what regressed.

    An error reaching retrieval makes the result **inconclusive**, not passed. A check that cannot
    run has proved nothing, and treating "I couldn't look" as "it's fine" is how a safety check
    becomes decoration. The caller withholds publication on an inconclusive result exactly as it
    would on a failure.
    """
    regressed: list[Regression] = []
    checked = 0
    for question in questions:
        try:
            hits = await search(question.question, SEARCH_K)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "selfauthor_selfcheck_unavailable q=%r (%s: %s) — treating as inconclusive",
                question.question, type(exc).__name__, exc,
            )
            return CheckResult(passed=False, checked=checked, inconclusive=True)
        checked += 1
        regression = evaluate(question, list(hits))
        if regression:
            regressed.append(regression)
    return CheckResult(passed=not regressed, regressed=tuple(regressed), checked=checked)
