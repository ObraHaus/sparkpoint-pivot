#!/usr/bin/env python
"""074 — offline comparative variance probe (NO network).

Runs a handful of comparative prompts N times through the REAL ``CoordinatorDag`` with a
noisy fake model, and reports how many DISTINCT final answers / structures / routes come out.
The same script works on the pre-074 code and on the 074 tree, so the two runs are directly
comparable:

    uv run python scripts/comparative_variance_probe.py --runs 5

The fake model deliberately varies what a free gateway model really varies: phrasing,
subject ordering, an occasional omitted subject, an occasional scaffolding/meta phrase, and an
occasional refusal. Retrieval is deterministic here, so any difference in the result comes from
the model/prompt/post-processing path, not from a flaky corpus.
"""

from __future__ import annotations

import argparse
import asyncio
import random
import sys
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass
from typing import Any

from sparkpoint_agent.agents.literacy import Literacy
from sparkpoint_agent.agents.planner import Intent, IntentKind, Planner
from sparkpoint_agent.agents.recommender import Recommender
from sparkpoint_agent.agents.sparky import Sparky
from sparkpoint_agent.coordinator.chat_blocks import ProseDelta
from sparkpoint_agent.coordinator.curated import CuratedContext, CuratedPick
from sparkpoint_agent.coordinator.dag import (
    ChainContext,
    CoordinatorDag,
    MandateView,
    MarketData,
    PortfolioView,
)
from sparkpoint_agent.knowledge import Passage
from sparkpoint_agent.llm import LlmResult, StreamChunk, StructuredResult
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

AAVE = (
    "AAVE-GROUNDING: Aave is a shared lending pool. Suppliers earn a variable rate driven by "
    "utilisation; risk is concentrated in one market and the contracts, and it is not insured."
)
MORPHO = (
    "MORPHO-GROUNDING: Morpho is a framework of isolated markets and curated vaults. A curator "
    "adds allocation and liquidity risk on top of the market risk; it is not insured."
)
COMPOUND = (
    "COMPOUND-GROUNDING: Compound is a shared-pool lending protocol governed by its token "
    "holders. It carries contract, governance and market risk, and it is not insured."
)
LIDO = (
    "LIDO-GROUNDING: Lido is liquid staking for Ethereum; the liquid staking token can trade "
    "below the value of the underlying ETH and the position is not insured."
)
ROCKET = (
    "ROCKET-GROUNDING: Rocket Pool is decentralised liquid staking backed by independent node "
    "operators; the token can trade below the value of the underlying ETH and is not insured."
)
DOCS = {
    "aave": AAVE,
    "morpho": MORPHO,
    "compound": COMPOUND,
    "lido": LIDO,
    "rocket": ROCKET,
}


def _user_text(messages: Any) -> str:
    if not messages:
        return ""
    last = messages[-1]
    return str(last.get("content") or "") if isinstance(last, dict) else str(last)


class _NoisyLlm:
    """Seeded noisy model. Varies phrasing, ordering, omissions, meta and refusals."""

    def __init__(self, seed: int) -> None:
        self._rng = random.Random(seed)  # noqa: S311 — deterministic probe noise

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER))

    _LABELS = (
        ("aave", "Aave"),
        ("morpho", "Morpho"),
        ("compound", "Compound"),
        ("lido", "Lido"),
        ("rocket", "Rocket Pool"),
        ("gauntlet", "Gauntlet USDC Prime"),
        ("steakhouse", "Steakhouse USDC"),
        ("sparkpoint vault", "SparkPoint Vault"),
    )

    def _names(self, text: str) -> list[str]:
        lowered = text.lower()
        return [label for key, label in self._LABELS if key in lowered]

    def _answer(self, system: str, text: str) -> LlmResult:
        names = self._names(text)
        first = names[0] if names else "the first option"
        second = names[1] if len(names) > 1 else "the second option"
        # The post-074 bottom-line prompt is included so the same noise reaches it. Only the
        # dedicated prompt carries this marker; the pre-074 comparative rule does not.
        if "bottom line" in system.lower():
            choices = (
                f"The trade-off between {first} and {second} comes down to who controls the "
                "contracts and how the yield is produced, so the fit depends on your risks.",
                "The difference is structural rather than a simple ranking, and the right "
                "choice depends on your own risk tolerance.",
                "Based on the reference notes I was given, the two options differ mainly in "
                "structure.",
                "I can't compare them.",
                "",
            )
            return LlmResult(text=self._rng.choice(choices), stop_reason="end_turn")
        choices = (
            f"{first} and {second} differ in how risk is concentrated: {first} pools it while "
            "the other isolates it. Neither is automatically safer and neither is insured.",
            f"Structurally, {second} uses a different control structure from {first}, so the "
            "main differences are how the yield is made and who can change the parameters.",
            f"{first} is one shared market, while {second} works differently; compare the "
            "smart-contract, liquidity and governance risk of each, and note neither is insured.",
            f"Based on the reference notes, {first} and {second} are both DeFi protocols.",
            f"{first} is a DeFi protocol with market-wide risk.",
            f"I can't compare {first} and {second}.",
        )
        return LlmResult(text=self._rng.choice(choices), stop_reason="end_turn")

    async def complete(self, *, system: str = "", messages: Any = None, **_: Any) -> LlmResult:
        return self._answer(system, _user_text(messages))

    async def stream_complete(
        self, *, system: str = "", messages: Any = None, **_: Any
    ) -> AsyncIterator[StreamChunk]:
        result = self._answer(system, _user_text(messages))
        yield StreamChunk(delta=result.text)
        yield StreamChunk(result=result)


class _Grounder:
    """Deterministic corpus keyed by the subject names in the query."""

    def __init__(self, seed: int = 0) -> None:
        self._rng = random.Random(seed)  # noqa: S311 — deterministic probe noise

    async def retrieve_passages(
        self, query: str, *, k: int | None = None, min_score: float = 0.0
    ) -> tuple[Passage, ...]:
        lowered = query.lower()
        hits = [
            Passage(
                content=text,
                citation=Citation(
                    provider=name.title(),
                    endpoint=f"obsidian://{name}",
                    field="risk",
                    value=name,
                    as_of="2026-10-29T00:00:00Z",
                    stale=False,
                ),
            )
            for key, text in DOCS.items()
            if key in lowered
            for name in (key,)
        ]
        self._rng.shuffle(hits)  # retrieval order noise (ties)
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


def _chain() -> ChainContext:
    return ChainContext(
        chain_id=8453,
        user_account=USER,
        owner=USER,
        resolved_targets={"sparkpoint_vault": VAULT},
        caps=CapHeadroom(per_user=BIG, total=BIG, vault=BIG),
        market=MarketData(gross_apy_bps=421, projected_apy_bps=379, performance_fee_bps=1000),
    )


def _dag(llm: Any, grounder: Any) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=llm),
        recommender=Recommender(llm=llm),
        literacy=Literacy(llm=llm),
        sparky=Sparky(llm=llm),
        portfolio_provider=_Portfolio(),
        mandate_provider=_Mandate(),
        curated=_Curated(),
        knowledge=grounder,
        streaming=True,
        single_call=True,
    )


@dataclass(frozen=True)
class Prompt:
    message: str
    history: tuple[tuple[str, str], ...] = ()


PROMPTS: tuple[Prompt, ...] = (
    Prompt("Compare Morpho vs Aave."),
    Prompt("Is Morpho safer than Aave?"),
    Prompt("Aave vs Compound for USDC"),
    Prompt("Lido vs Rocket Pool"),
    Prompt(
        "Compare that with keeping it in Aave.",
        history=(
            ("user", "Tell me about the SparkPoint Vault."),
            ("assistant", "It routes USDC into Aave v3 through an ERC-4626 wrapper."),
        ),
    ),
    Prompt("Compare Gauntlet USDC Prime and Steakhouse USDC."),
)


def _structure(text: str) -> str:
    """Everything except the model-authored Bottom line (074's stable part)."""
    marker = "**Bottom line**"
    if marker in text:
        return text.split(marker, 1)[0].rstrip()
    return text


def _route(wires: Sequence[dict[str, Any]]) -> str:
    kinds = {wire.get("type") for wire in wires}
    if "error" in kinds:
        return f"error:{next(w.get('code') for w in wires if w.get('type') == 'error')}"
    if "action" in kinds or "recommendation" in kinds:
        return "action"
    if "tip" in kinds:
        return "tip"
    return "text"


async def _run(prompt: Prompt, run: int) -> dict[str, Any]:
    llm = _NoisyLlm(seed=1000 + run)
    dag = _dag(llm, _Grounder(seed=run))
    blocks = [
        block
        async for block in dag.run_chat(prompt.message, _chain(), history=prompt.history or None)
        if not isinstance(block, ProseDelta)
    ]
    wires = [block.to_wire() for block in blocks]
    text = next((w["markdown"] for w in wires if w["type"] == "text"), "")
    citations = tuple(
        (source.get("provider"), source.get("endpoint"))
        for wire in wires
        if wire["type"] == "citation"
        for source in wire.get("sources", ())
    )
    return {
        "answer": text,
        "structure": _structure(text),
        "route": _route(wires),
        "citations": citations,
    }


async def _main(runs: int) -> int:
    print(f"comparative variance probe — {runs} runs per prompt")
    totals = {"answers": 0, "structures": 0, "routes": 0, "citations": 0}
    for prompt in PROMPTS:
        results = [await _run(prompt, run) for run in range(runs)]
        answers = len({r["answer"] for r in results})
        structures = len({r["structure"] for r in results})
        routes = len({r["route"] for r in results})
        citations = len({r["citations"] for r in results})
        totals["answers"] += answers
        totals["structures"] += structures
        totals["routes"] += routes
        totals["citations"] += citations
        print(
            f"- {prompt.message!r}: distinct answers={answers} structures={structures} "
            f"routes={routes} citations={citations}"
        )
    print(
        "TOTAL distinct: "
        f"answers={totals['answers']} structures={totals['structures']} "
        f"routes={totals['routes']} citations={totals['citations']}"
    )
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=int, default=5, help="runs per prompt (default 5)")
    args = parser.parse_args(argv)
    return asyncio.run(_main(max(1, args.runs)))


if __name__ == "__main__":
    sys.exit(main())
