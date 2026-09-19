# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism)
"""048 — "what's the best vault / where should I deposit?" answered from the curated record.

FR-004 in test form: the answer is the STORED pick with STORED figures; when there is no pick it
says so honestly; when the store read fails it degrades to an error block (never a remembered
vault); and a genuine command ("deposit 100 USDC") is not stolen from the build path.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.coordinator.curated import (
    BEST_VAULT_RE,
    CuratedContext,
    CuratedPick,
    curated_answer,
)
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    PortfolioView,
)
from sparkpoint_agent.llm import LlmResult, StructuredResult
from sparkpoint_agent.policy import CapHeadroom

USER = "0x2222222222222222222222222222222222222222"
PICK = CuratedPick(
    address="0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
    label="Gauntlet USDC Prime",
    net_apy_bps=441,
    tvl_usd=420_747_952.0,
    curator="Gauntlet",
    curator_verified=True,
    reason="Highest screen score (69/100): 4.41% net APY, $420.7M TVL, Gauntlet (verified).",
    as_of="2026-09-18T00:05:00+00:00",
    wrapped=False,
)


class _CountingStructuredLlm:
    """A classifier whose call count proves the deterministic route fired FIRST."""

    def __init__(self) -> None:
        self.calls = 0

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        self.calls += 1
        return StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER))


class _CompleteLlm:
    async def complete(self, **_: Any) -> LlmResult:
        return LlmResult(text="prose", stop_reason="end_turn")


class _Portfolio:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView(net_worth_usd="250.00")


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return MandateView(version=1)


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=4663,
        user_account=USER,
        owner=USER,
        resolved_targets={},
        caps=CapHeadroom(per_user=10**15, total=10**15, vault=10**15),
    )


def _dag(
    curated: Any, planner: _CountingStructuredLlm | None = None
) -> tuple[CoordinatorDag, _CountingStructuredLlm]:
    classifier = planner or _CountingStructuredLlm()
    dag = CoordinatorDag(
        planner=Planner(llm=classifier),
        recommender=Recommender(llm=classifier),
        literacy=Literacy(llm=_CompleteLlm()),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(),
        curated=curated,
    )
    return dag, classifier


async def _run(dag: CoordinatorDag, message: str) -> list[dict[str, Any]]:
    return [b.to_wire() async for b in dag.run_chat(message, _chain())]


def _text(wires: list[dict[str, Any]]) -> str:
    return "\n".join(w["markdown"] for w in wires if w["type"] == "text")


def _types(wires: list[dict[str, Any]]) -> set[str]:
    return {w["type"] for w in wires}


# ── the pure formatter ───────────────────────────────────────────────────────────────────────────


def test_the_answer_names_the_stored_pick_and_its_stored_figures() -> None:
    text = curated_answer(CuratedContext(vault_count=3, pick=PICK))
    assert "Gauntlet USDC Prime" in text
    assert "4.41%" in text
    assert "$420.7M" in text
    assert "Gauntlet (verified)" in text
    assert "as of 2026-09-18" in text
    assert "/vault" in text


def test_unknown_figures_are_admitted_rather_than_filled_in() -> None:
    bare = CuratedPick(
        address=PICK.address,
        label=PICK.label,
        net_apy_bps=None,
        tvl_usd=None,
        curator=None,
        curator_verified=False,
        reason=PICK.reason,
        as_of=None,
        wrapped=False,
    )
    text = curated_answer(CuratedContext(vault_count=1, pick=bare))
    assert "not available right now" in text
    assert "0.00%" not in text, "an unknown APY must never render as 0%"
    assert "Curator:" not in text, "no curator line for an unattributed vault"


def test_fee_wording_matches_the_hybrid_model() -> None:
    direct = curated_answer(CuratedContext(vault_count=1, pick=PICK))
    assert "charges no fee" in direct
    wrapped = curated_answer(CuratedContext(vault_count=1, pick=replace(PICK, wrapped=True)))
    assert "performance-fee wrapper" in wrapped
    assert "high-water mark" in wrapped
    assert "never to a deposit" in wrapped


def test_the_empty_states_are_honest_and_deep_link_to_the_board() -> None:
    none_yet = curated_answer(CuratedContext(vault_count=0))
    assert "no curated vaults" in none_yet.lower()
    assert "won't invent one" in none_yet
    assert "/vault" in none_yet

    unpublished = curated_answer(CuratedContext(vault_count=4))
    assert "4 curated vaults" in unpublished
    assert "no best pick has been published" in unpublished.replace("\n", " ")


def test_the_regex_owns_the_question_shapes_and_not_a_command() -> None:
    for question in (
        "What's the best vault right now?",
        "which vault should I use?",
        "where should I deposit?",
        "where can I put my money?",
        "best place to earn on USDC?",
        "top vaults on this chain",
    ):
        assert BEST_VAULT_RE.search(question), question
    for command in (
        "deposit 100 USDC into the vault",
        "withdraw everything",
        "what's the vault fee?",
        "what's in my wallet?",
    ):
        assert not BEST_VAULT_RE.search(command), command


# ── through run_chat ─────────────────────────────────────────────────────────────────────────────


async def test_run_chat_answers_best_vault_from_the_record_without_consulting_the_model() -> None:
    async def curated(_chain_id: int) -> CuratedContext:
        return CuratedContext(vault_count=1, pick=PICK)

    dag, classifier = _dag(curated)
    wires = await _run(dag, "What's the best vault right now?")
    assert wires and wires[0]["type"] == "tool_step"
    assert "Gauntlet USDC Prime" in _text(wires)
    assert classifier.calls == 0, "a curated question must not need the classifier"


async def test_a_failed_curated_read_is_an_error_block_never_a_remembered_vault() -> None:
    async def curated(_chain_id: int) -> CuratedContext | None:
        return None

    dag, _ = _dag(curated)
    wires = await _run(dag, "where should I deposit?")
    assert _types(wires) == {"tool_step", "error"}
    assert "couldn't read the curated vault list" in wires[-1]["message"]


async def test_a_genuine_deposit_command_still_builds_instead_of_being_stolen() -> None:
    calls: list[int] = []

    async def curated(chain_id: int) -> CuratedContext:
        calls.append(chain_id)
        return CuratedContext(vault_count=1, pick=PICK)

    dag, classifier = _dag(curated)
    await _run(dag, "deposit 100 USDC into the vault")
    assert calls == [], "a command is not a question about the curated list"
    assert classifier.calls == 1, "the command routes through the normal intent path"
