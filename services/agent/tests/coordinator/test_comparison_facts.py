# ruff: noqa: S101  (pytest asserts are the idiomatic assertion mechanism in pytest)
"""074 — deterministic facts, template and sampling plumbing.

These unit tests pin the guarantees the consistency eval relies on: every known subject has a
reviewed, figure-free structural record; rendering is a pure function; retrieval ties break
deterministically; curated-vault figures come from the stored board; and only comparative
Bottom-line calls put ``temperature``/``seed`` on the wire.
"""

from __future__ import annotations

import random
from collections.abc import AsyncIterator
from typing import Any

import pytest

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.agents.sparky import (
    BOTTOM_LINE_SEED,
    BOTTOM_LINE_TEMPERATURE,
    Sparky,
)
from sparkpoint_agent.coordinator.chat_blocks import ProseDelta, TextBlock
from sparkpoint_agent.coordinator.comparative import KNOWN_SUBJECTS
from sparkpoint_agent.coordinator.comparison_facts import (
    CURATED_VAULT_FACTS,
    SUBJECT_FACTS,
    deterministic_bottom_line,
    format_vault_figures,
    render_comparison,
)
from sparkpoint_agent.coordinator.curated import CuratedContext, CuratedPick
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
    _bottom_line_is_acceptable,
)
from sparkpoint_agent.knowledge import Passage
from sparkpoint_agent.llm import LlmResult, StreamChunk, StructuredResult
from sparkpoint_agent.llm.client import OpenAICompatTransport
from sparkpoint_agent.policy import CapHeadroom
from sparkpoint_agent.wire import Citation

USER = "0x2222222222222222222222222222222222222222"
VAULT = "0x1111111111111111111111111111111111111111"
BIG = 10**15

PICK_A = CuratedPick(
    address="0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    label="Gauntlet USDC Prime",
    net_apy_bps=441,
    tvl_usd=420_747_952.0,
    curator="Gauntlet",
    curator_verified=True,
    reason="Highest screen score.",
    as_of="2026-09-18T00:05:00+00:00",
    wrapped=False,
)
PICK_B = CuratedPick(
    address="0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    label="Steakhouse USDC",
    net_apy_bps=397,
    tvl_usd=88_200_000.0,
    curator="Steakhouse",
    curator_verified=True,
    reason="Conservative allocation.",
    as_of="2026-09-18T00:15:00+00:00",
    wrapped=True,
)
CURATED = CuratedContext(vault_count=2, pick=PICK_A, vaults=(PICK_A, PICK_B))


def test_every_known_subject_has_a_figure_free_structural_record() -> None:
    assert set(SUBJECT_FACTS) == set(KNOWN_SUBJECTS), (
        "the reviewed facts table must cover exactly the alias-table subjects"
    )
    for name, facts in SUBJECT_FACTS.items():
        assert facts.category and facts.what_it_is and facts.how_yield_is_made
        assert facts.main_risks and facts.fees_and_structure and facts.custody
        blob = " ".join(
            (
                facts.category,
                facts.what_it_is,
                facts.how_yield_is_made,
                facts.main_risks,
                facts.fees_and_structure,
                facts.custody,
            )
        )
        assert "%" not in blob, f"{name} must not contain an APY figure"
        assert "$" not in blob, f"{name} must not contain a USD figure"
        lowered = blob.lower()
        assert "safer than" not in lowered and "better than" not in lowered


def test_rendering_is_byte_identical_and_uses_the_canonical_subject_order() -> None:
    first = render_comparison(("Aave", "Morpho"), bottom_line="A trade-off.")
    second = render_comparison(("Aave", "Morpho"), bottom_line="A trade-off.")
    assert first == second
    assert first is not None
    assert first.index("**Aave**") < first.index("**Morpho**")
    headings = [
        "**What it is**",
        "**How the yield is made**",
        "**Main risks**",
        "**Fees & structure**",
        "**Bottom line**",
    ]
    positions = [first.index(heading) for heading in headings]
    assert positions == sorted(positions)


def test_only_the_bottom_line_changes_when_the_model_text_changes() -> None:
    first = render_comparison(("Aave", "Morpho"), bottom_line="One closing.")
    second = render_comparison(("Aave", "Morpho"), bottom_line="Another closing.")
    assert first is not None and second is not None
    assert first.split("**Bottom line**")[0] == second.split("**Bottom line**")[0]
    fallback = render_comparison(("Aave", "Morpho"))
    assert fallback is not None and deterministic_bottom_line(("Aave", "Morpho")) in fallback
    assert render_comparison(("Yearn",)) is None


def test_curated_vault_uses_the_shared_structure_and_stored_figures() -> None:
    text = render_comparison(
        ("Gauntlet USDC Prime", "Steakhouse USDC"),
        figures={
            "Gauntlet USDC Prime": format_vault_figures(PICK_A),
            "Steakhouse USDC": format_vault_figures(PICK_B),
        },
        vault_subjects=("Gauntlet USDC Prime", "Steakhouse USDC"),
        bottom_line="A trade-off.",
    )
    assert text is not None
    assert CURATED_VAULT_FACTS.what_it_is in text
    assert "**Live figures**" in text
    assert "4.41%" in text and "$420.7M" in text and "Gauntlet (verified)" in text
    assert "as of 2026-09-18" in text
    # A wrapped vault gets the fee note; the direct one does not.
    assert "performance-fee wrapper" in text
    assert "no SparkPoint fee" in text


class _ShuffledGrounder:
    def __init__(self, seed: int) -> None:
        self._rng = random.Random(seed)  # noqa: S311 — deterministic test noise

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        lowered = query.lower()
        names = [name for name in ("Aave", "Morpho") if name.lower() in lowered]
        hits = [
            Passage(
                content=f"{name}-{index}: shared structural note.",
                citation=Citation(
                    provider=name,
                    endpoint=f"obsidian://{name.lower()}-{index}",
                    field="risk",
                    value=name,
                    as_of="2026-10-29T00:00:00Z",
                    stale=False,
                ),
            )
            for name in names
            for index in range(3)
        ]
        self._rng.shuffle(hits)
        return tuple(hits)


class _Portfolio:
    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView(net_worth_usd="0.00", idle_usdc=0)


class _Mandate:
    async def active(self, chain: ChainContext) -> MandateView | None:
        return None


class _Curated:
    async def __call__(self, chain_id: int) -> CuratedContext:
        return CURATED


class _RecordingLlm:
    def __init__(self, bottom: str = "A plain trade-off, not a ranking.") -> None:
        self.bottom = bottom
        self.complete_kwargs: list[dict[str, Any]] = []

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER))

    async def complete(self, **kwargs: Any) -> LlmResult:
        self.complete_kwargs.append(kwargs)
        system = str(kwargs.get("system") or "")
        text = self.bottom if "BOTTOM LINE" in system else "unexpected prose call"
        return LlmResult(text=text, stop_reason="end_turn")

    async def stream_complete(self, **_: Any) -> AsyncIterator[StreamChunk]:
        raise AssertionError("comparative turns must not stream")
        yield StreamChunk()  # pragma: no cover


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        market=MarketData(gross_apy_bps=421, projected_apy_bps=379, performance_fee_bps=1000),
    )


def _dag(llm: Any, grounder: Any = None) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=llm),
        recommender=Recommender(llm=llm),
        literacy=Literacy(llm=llm),
        sparky=Sparky(llm=llm),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(),
        curated=_Curated(),
        knowledge=grounder,
        streaming=False,
        single_call=True,
    )


async def test_retrieval_ties_break_deterministically() -> None:
    dag = _dag(_RecordingLlm(), _ShuffledGrounder(seed=1))
    first, covered_first = await dag._ground_comparative(
        "Compare Aave and Morpho", ("Aave", "Morpho")
    )
    dag_other = _dag(_RecordingLlm(), _ShuffledGrounder(seed=99))
    second, covered_second = await dag_ground_other(dag_other)
    assert covered_first == covered_second == ("Aave", "Morpho")
    assert [(p.citation.endpoint, p.content) for p in first] == [
        (p.citation.endpoint, p.content) for p in second
    ]


async def dag_ground_other(dag: CoordinatorDag) -> tuple[tuple[Passage, ...], tuple[str, ...]]:
    return await dag._ground_comparative("Compare Aave and Morpho", ("Aave", "Morpho"))


async def test_curated_vault_figures_come_from_the_board_not_the_model() -> None:
    llm = _RecordingLlm("The net APY is 99% and it is the safest.")
    blocks = [
        block
        async for block in _dag(llm).run_chat(
            "Compare Gauntlet USDC Prime and Steakhouse USDC.", _chain()
        )
        if not isinstance(block, ProseDelta)
    ]
    text = next(block.markdown for block in blocks if isinstance(block, TextBlock))
    assert "**Live figures**" in text
    assert "4.41%" in text and "$420.7M" in text
    assert "3.97%" in text and "$88.2M" in text
    assert "99%" not in text, "the model must never supply a figure"
    assert "safest" not in text.lower()


async def test_bottom_line_temperature_reaches_only_the_comparative_call() -> None:
    llm = _RecordingLlm()
    blocks = [
        block
        async for block in _dag(llm).run_chat("Compare Morpho vs Aave.", _chain())
        if not isinstance(block, ProseDelta)
    ]
    assert any(isinstance(block, TextBlock) for block in blocks)
    assert llm.complete_kwargs, "the Bottom line is the one prose call"
    assert llm.complete_kwargs[-1]["temperature"] == BOTTOM_LINE_TEMPERATURE
    assert llm.complete_kwargs[-1]["seed"] == BOTTOM_LINE_SEED


def test_gateway_payload_omits_sampling_unless_asked() -> None:
    transport = OpenAICompatTransport(base_url="http://gw.example/v1", api_key="secret")
    plain = transport._payload(system=[], messages=[], max_tokens=8, user=None, stream=False)
    assert "temperature" not in plain and "seed" not in plain
    sampled = transport._payload(
        system=[],
        messages=[],
        max_tokens=8,
        user=None,
        stream=False,
        temperature=0.2,
        seed=7,
    )
    assert sampled["temperature"] == 0.2 and sampled["seed"] == 7


class _PayloadTransport:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return _Message()


class _Message:
    content: list[Any] = []
    stop_reason = "end_turn"
    usage = None
    stop_details = None


async def test_client_forwards_temperature_only_when_set() -> None:
    from sparkpoint_agent.llm import AsyncClaudeClient, AuthMode

    transport = _PayloadTransport()
    client = AsyncClaudeClient(transport=transport, auth_mode=AuthMode.API_KEY)  # type: ignore[arg-type]
    await client.complete(system="x", messages=[{"role": "user", "content": "hi"}])
    assert "temperature" not in transport.calls[-1]
    await client.complete(
        system="x",
        messages=[{"role": "user", "content": "hi"}],
        temperature=0.2,
        seed=7,
    )
    assert transport.calls[-1]["temperature"] == 0.2
    assert transport.calls[-1]["seed"] == 7


@pytest.mark.parametrize(
    "answer",
    [
        "Based on the reference notes, the two differ.",
        "I can't compare them.",
        "I won't compare them.",
        "Aave is safer than Morpho.",
        "The APY is 4.41%.",
        "",
    ],
)
def test_bottom_line_rejects_meta_refusal_verdict_figures_and_empty(answer: str) -> None:
    assert _bottom_line_is_acceptable(answer) is False


def test_bottom_line_accepts_a_plain_tradeoff() -> None:
    assert _bottom_line_is_acceptable(
        "The trade-off is structural rather than a ranking, so the fit depends on your risks."
    )
    assert _bottom_line_is_acceptable("Neither is automatically safer; the trade-off is risk.")


class _EmptySparkyLlm(_RecordingLlm):
    async def complete(self, **kwargs: Any) -> LlmResult:
        self.complete_kwargs.append(kwargs)
        return LlmResult(text="", stop_reason="end_turn")


async def test_empty_model_bottom_line_uses_the_deterministic_sentence() -> None:
    blocks = [
        block
        async for block in _dag(_EmptySparkyLlm()).run_chat("Compare Morpho vs Aave.", _chain())
        if not isinstance(block, ProseDelta)
    ]
    text = next(block.markdown for block in blocks if isinstance(block, TextBlock))
    assert deterministic_bottom_line(("Morpho", "Aave")) in text
