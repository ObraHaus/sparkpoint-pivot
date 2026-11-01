"""074 — comparative consistency eval (offline, noisy fake; live, opt-in).

The question this suite answers is NOT "is the prose good?" (the golden runner + judge do that)
but "does the SAME comparative prompt produce the SAME answer structure every time?". Before 074
the model wrote the whole answer, so phrasing, ordering, omissions and guard rejections all moved
the final text. 074 makes the skeleton code-authored; only the closing Bottom line is model text.

Offline mode runs every prompt ``repeats`` times through the REAL ``CoordinatorDag`` with a
seeded, deliberately noisy fake model, and asserts that route, skeleton, subject order and
citations are identical every time. It is fast, deterministic, and needs no network, so CI runs
it as a normal test (``tests/evals/test_consistency_offline.py``).

Live mode is opt-in: it replays a few prompts through the configured gateway and reports the
structural agreement rate. It skips cleanly without ``LITELLM_*`` and classifies 429/5xx as
infrastructure (not a product failure). It is never run by CI.
"""

from __future__ import annotations

import asyncio
import json
import random
import re
from collections.abc import AsyncIterator, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
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
from sparkpoint_agent.llm.claude import gateway_from_env
from sparkpoint_agent.policy import CapHeadroom
from sparkpoint_agent.wire import Citation

from .assertions import classify_route, is_english, visible_text
from .model import OUT_DIR

USER = "0x2222222222222222222222222222222222222222"
VAULT = "0x1111111111111111111111111111111111111111"
BIG = 10**15
INFRA_STATUS = frozenset({429, 500, 502, 503, 504, 529})

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

_DOCS = {
    "aave": (
        "AAVE-GROUNDING: Aave is a shared lending pool. Suppliers earn a variable rate driven by "
        "utilisation; risk is concentrated in one market and the contracts, and it is not insured."
    ),
    "morpho": (
        "MORPHO-GROUNDING: Morpho is a framework of isolated markets and curated vaults. A "
        "curator adds allocation and liquidity risk on top of the market risk; it is not insured."
    ),
    "compound": (
        "COMPOUND-GROUNDING: Compound is a shared-pool lending protocol governed by its token "
        "holders. It carries contract, governance and market risk, and it is not insured."
    ),
    "lido": (
        "LIDO-GROUNDING: Lido is liquid staking for Ethereum; the liquid staking token can trade "
        "below the value of the underlying ETH and the position is not insured."
    ),
    "rocket": (
        "ROCKET-GROUNDING: Rocket Pool is decentralised liquid staking backed by independent node "
        "operators; the token can trade below the value of the underlying ETH and is not insured."
    ),
    "aerodrome": (
        "AERODROME-GROUNDING: Aerodrome is a DEX on Base with liquidity pools; providers earn "
        "trading fees plus incentives and take impermanent-loss and contract risk."
    ),
    "uniswap": (
        "UNISWAP-GROUNDING: Uniswap is a DEX with liquidity pools; providers earn trading fees "
        "and take impermanent-loss and contract risk."
    ),
}


@dataclass(frozen=True)
class ConsistencyPrompt:
    id: str
    message: str
    history: tuple[tuple[str, str], ...] = ()
    wallet: str = "empty"


#: Eight-plus cases, including a safety question, a yield/venue question, a staking pair, a DEX
#: pair, the SparkPoint-vault comparison, two curated vaults by name, a deictic follow-up and an
#: unknown subject.
PROMPTS: tuple[ConsistencyPrompt, ...] = (
    ConsistencyPrompt("cmp-01-morpho-vs-aave", "Compare Morpho vs Aave."),
    ConsistencyPrompt("cmp-02-safer", "Is Morpho safer than Aave?"),
    ConsistencyPrompt("cmp-03-aave-compound", "Aave vs Compound for USDC."),
    ConsistencyPrompt("cmp-04-lido-rocket", "Lido vs Rocket Pool."),
    ConsistencyPrompt("cmp-05-dex", "Compare Aerodrome and Uniswap."),
    ConsistencyPrompt("cmp-06-sparkpoint-aave", "Compare the SparkPoint Vault with Aave."),
    ConsistencyPrompt(
        "cmp-07-two-curated-vaults",
        "Compare Gauntlet USDC Prime and Steakhouse USDC.",
    ),
    ConsistencyPrompt(
        "cmp-08-deictic",
        "Compare that with keeping it in Aave.",
        history=(
            ("user", "Tell me about the SparkPoint Vault."),
            ("assistant", "It routes USDC into Aave v3 through an ERC-4626 wrapper."),
        ),
    ),
    ConsistencyPrompt("cmp-09-unknown", "Compare Yearn and Aave for a beginner."),
)


class _NoisyLlm:
    """Seeded noisy model: wording, ordering, omissions, meta phrases and refusals.

    Only the closing Bottom line is requested on the 074 path, so this noise proves that the
    skeleton does not depend on it. The variants deliberately include a subject omission, a
    scaffolding/meta phrase, a refusal and an empty generation — each must degrade to the
    deterministic Bottom line without changing the structure.
    """

    _VALID = (
        "The trade-off comes down to who controls the contracts and how the yield is produced, "
        "so the fit depends on the risks you can tolerate.",
        "The difference is structural rather than a ranking; the right choice depends on your "
        "own risk tolerance and how the yield is generated.",
        "Both carry real trade-offs in control and liquidity, so weigh those against how the "
        "yield is produced rather than expecting one clean answer.",
    )
    _NOISE = (
        "Based on the reference notes I was given, the two options differ in structure.",
        "I can't compare them.",
        "",
        "The first option is the one to look at.",
    )

    def __init__(self, seed: int) -> None:
        self._rng = random.Random(seed)  # noqa: S311 — deterministic eval noise

    async def structured(self, **_: Any) -> StructuredResult[Any]:
        return StructuredResult(ok=True, value=Intent(kind=IntentKind.OTHER))

    async def complete(self, *, system: str = "", **_: Any) -> LlmResult:
        if "BOTTOM LINE" not in system:
            raise AssertionError("the comparative path only asks the model for a Bottom line")
        text = self._rng.choice((*self._VALID, *self._NOISE))
        return LlmResult(text=text, stop_reason="end_turn")

    async def stream_complete(self, **_: Any) -> AsyncIterator[StreamChunk]:
        raise AssertionError("comparative turns must not stream prose deltas")
        yield StreamChunk()  # pragma: no cover — keeps this an async generator


class _TieGrounder:
    """Returns tied passages in a RANDOM order, to prove the stable tie-break works."""

    def __init__(self, seed: int = 0) -> None:
        self._rng = random.Random(seed)  # noqa: S311 — deterministic eval noise

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
            for name, text in _DOCS.items()
            if name in lowered
        ]
        self._rng.shuffle(hits)
        return tuple(hits)


class _Portfolio:
    def __init__(self, wallet: str) -> None:
        self._wallet = wallet

    async def read(self, chain: ChainContext) -> PortfolioView:
        if self._wallet == "with_position":
            return PortfolioView(net_worth_usd="5250.00", idle_usdc=5_000_000_000)
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


def _dag(
    client: Any, grounder: Any, *, wallet: str, streaming: bool, single_call: bool
) -> CoordinatorDag:
    return CoordinatorDag(
        planner=Planner(llm=client),
        recommender=Recommender(llm=client),
        literacy=Literacy(llm=client),
        sparky=Sparky(llm=client),
        portfolio_provider=_Portfolio(wallet),
        mandate_provider=_Mandate(),
        curated=_Curated(),
        knowledge=grounder,
        streaming=streaming,
        single_call=single_call,
    )


@dataclass(frozen=True)
class _Run:
    route: str
    skeleton: str
    subjects: tuple[str, ...]
    citations: tuple[tuple[str, str], ...]
    bottom: str
    answer: str


def _subjects(text: str) -> tuple[str, ...]:
    intro = text.split("**What it is**", 1)[0]
    return tuple(re.findall(r"\*\*([^*]+)\*\*", intro))


def _split(text: str) -> tuple[str, str]:
    marker = "**Bottom line**"
    if marker not in text:
        return text, ""
    skeleton, bottom = text.split(marker, 1)
    return skeleton.rstrip(), bottom.strip()


def _wires(blocks: Sequence[Any]) -> list[dict[str, Any]]:
    return [block.to_wire() for block in blocks if not isinstance(block, ProseDelta)]


async def _one(
    prompt: ConsistencyPrompt,
    *,
    seed: int,
    streaming: bool,
    single_call: bool,
    client: Any | None = None,
    grounder: Any | None = None,
) -> _Run:
    client = client or _NoisyLlm(seed)
    grounder = grounder or _TieGrounder(seed)
    dag = _dag(client, grounder, wallet=prompt.wallet, streaming=streaming, single_call=single_call)
    blocks = [
        block
        async for block in dag.run_chat(prompt.message, _chain(), history=prompt.history or None)
    ]
    wires = _wires(blocks)
    text = visible_text(wires)
    skeleton, bottom = _split(text)
    citations = tuple(
        (str(source.get("provider")), str(source.get("endpoint")))
        for wire in wires
        if wire.get("type") == "citation"
        for source in wire.get("sources", ())
    )
    return _Run(
        route=classify_route(wires),
        skeleton=skeleton,
        subjects=_subjects(text),
        citations=citations,
        bottom=bottom,
        answer=text,
    )


@dataclass
class ConsistencyCaseResult:
    id: str
    message: str
    runs: int
    status: str
    routes: tuple[str, ...]
    skeletons: int
    subject_orders: int
    citations: int
    bottoms: int
    failures: list[str] = field(default_factory=list)
    first_answer: str = ""


@dataclass
class ConsistencyReport:
    mode: str
    results: list[ConsistencyCaseResult]
    repeats: int
    generated_at: str = ""

    @property
    def total(self) -> int:
        return len(self.results)

    @property
    def passed(self) -> int:
        return sum(1 for result in self.results if result.status == "pass")

    @property
    def failed(self) -> int:
        return sum(1 for result in self.results if result.status == "fail")

    @property
    def infra(self) -> int:
        return sum(1 for result in self.results if result.status == "infra")

    @property
    def structural_agreement(self) -> float:
        stable = sum(
            1
            for result in self.results
            if result.skeletons == 1
            and result.subject_orders == 1
            and len(result.routes) == 1
            and result.citations == 1
        )
        return stable / self.total if self.total else 0.0


def _case_result(prompt: ConsistencyPrompt, runs: Sequence[_Run]) -> ConsistencyCaseResult:
    skeletons = {run.skeleton for run in runs}
    subjects = {run.subjects for run in runs}
    routes = {run.route for run in runs}
    citations = {run.citations for run in runs}
    bottoms = {run.bottom for run in runs}
    failures: list[str] = []
    if len(routes) != 1:
        failures.append(f"route varied: {sorted(routes)}")
    if len(skeletons) != 1:
        failures.append(f"skeleton varied across {len(skeletons)} shapes")
    if len(subjects) != 1:
        failures.append(f"subject order varied: {sorted(subjects)}")
    if len(citations) != 1:
        failures.append(f"citations varied across {len(citations)} sets")
    if any(not run.bottom for run in runs):
        failures.append("the Bottom line is missing in at least one run")
    for run in runs:
        lower = run.answer.lower()
        for forbidden in ("reference notes", "the user asks", "action payload", "tool call"):
            if forbidden in lower:
                failures.append(f"forbidden text present: {forbidden}")
                break
        if not is_english(run.answer):
            failures.append("an answer was not English")
            break
    return ConsistencyCaseResult(
        id=prompt.id,
        message=prompt.message,
        runs=len(runs),
        status="fail" if failures else "pass",
        routes=tuple(sorted(routes)),
        skeletons=len(skeletons),
        subject_orders=len(subjects),
        citations=len(citations),
        bottoms=len(bottoms),
        failures=failures,
        first_answer=runs[0].answer if runs else "",
    )


async def run_offline(
    prompts: Sequence[ConsistencyPrompt] | None = None,
    *,
    repeats: int = 5,
    streaming: bool = False,
    single_call: bool = True,
) -> ConsistencyReport:
    """Run every prompt ``repeats`` times with a seeded noisy fake. No network, no DB, no clock."""
    selected = tuple(prompts) if prompts is not None else PROMPTS
    results: list[ConsistencyCaseResult] = []
    for prompt in selected:
        runs = [
            await _one(
                prompt,
                seed=1000 + index,
                streaming=streaming,
                single_call=single_call,
            )
            for index in range(max(1, repeats))
        ]
        results.append(_case_result(prompt, runs))
    return ConsistencyReport(
        mode="offline",
        results=results,
        repeats=repeats,
        generated_at=datetime.now(UTC).isoformat(),
    )


async def run_modes(
    prompts: Sequence[ConsistencyPrompt] | None = None, *, repeats: int = 5
) -> ConsistencyReport:
    """Run the offline suite once per SPARKY_STREAMING × SPARKY_SINGLE_CALL combination."""
    combined: list[ConsistencyCaseResult] = []
    for streaming in (False, True):
        for single_call in (False, True):
            report = await run_offline(
                prompts, repeats=repeats, streaming=streaming, single_call=single_call
            )
            combined.extend(report.results)
    return ConsistencyReport(
        mode="offline-all-modes",
        results=combined,
        repeats=repeats,
        generated_at=datetime.now(UTC).isoformat(),
    )


class LiveNotConfigured(RuntimeError):
    """The LiteLLM gateway env is absent — live consistency skips cleanly, never fails."""


def _is_infra(exc: BaseException) -> bool:
    status = getattr(exc, "status_code", None)
    return isinstance(status, int) and status in INFRA_STATUS


async def run_live(
    prompts: Sequence[ConsistencyPrompt] | None = None,
    *,
    repeats: int = 3,
) -> ConsistencyReport:
    """Opt-in: replay up to 4 prompts through the real gateway and report agreement.

    Bounded deliberately (``repeats`` ≤ 3, 4 prompts) so it can never become a long paid run.
    429/5xx are classified as infrastructure, not a product failure.
    """
    if gateway_from_env() is None:
        raise LiveNotConfigured("LITELLM_BASE_URL and LITELLM_API_KEY are not set; skipped.")

    from sparkpoint_agent.llm import AsyncClaudeClient

    client = AsyncClaudeClient.from_env()
    selected = tuple(prompts)[:4] if prompts is not None else PROMPTS[:4]
    bounded = max(1, min(3, repeats))
    results: list[ConsistencyCaseResult] = []
    for prompt in selected:
        runs: list[_Run] = []
        infra = False
        for index in range(bounded):
            try:
                runs.append(
                    await asyncio.wait_for(
                        _one(
                            prompt,
                            seed=index,
                            streaming=True,
                            single_call=True,
                            client=client,
                            grounder=_TieGrounder(index),
                        ),
                        timeout=60.0,
                    )
                )
            except Exception as exc:  # noqa: BLE001 — classify, never fail the report
                if _is_infra(exc):
                    infra = True
                    break
                raise
        if infra:
            results.append(
                ConsistencyCaseResult(
                    id=prompt.id,
                    message=prompt.message,
                    runs=len(runs),
                    status="infra",
                    routes=(),
                    skeletons=0,
                    subject_orders=0,
                    citations=0,
                    bottoms=0,
                    failures=["infra: gateway 429/5xx"],
                )
            )
        elif not runs:
            results.append(
                ConsistencyCaseResult(
                    id=prompt.id,
                    message=prompt.message,
                    runs=0,
                    status="fail",
                    routes=(),
                    skeletons=0,
                    subject_orders=0,
                    citations=0,
                    bottoms=0,
                    failures=["no runs completed"],
                )
            )
        else:
            results.append(_case_result(prompt, runs))
    return ConsistencyReport(
        mode="live",
        results=results,
        repeats=bounded,
        generated_at=datetime.now(UTC).isoformat(),
    )


def render(report: ConsistencyReport) -> str:
    lines = [
        f"# Comparative consistency — {report.mode}",
        "",
        f"- Cases: **{report.total}** (repeats each: {report.repeats})",
        f"- Pass: **{report.passed}**",
        f"- Fail: **{report.failed}**",
        f"- Infra (not a product failure): **{report.infra}**",
        f"- Structural agreement: **{report.structural_agreement:.1%}**",
        "",
        "| Case | Runs | Route(s) | Skeletons | Subject orders | Citations | Status |",
        "|---|---:|---|---:|---:|---:|---|",
    ]
    for result in report.results:
        lines.append(
            f"| `{result.id}` | {result.runs} | {', '.join(result.routes) or '—'} | "
            f"{result.skeletons} | {result.subject_orders} | {result.citations} | "
            f"{result.status} |"
        )
    problems = [result for result in report.results if result.status == "fail"]
    if problems:
        lines += ["", "## Non-passing cases", ""]
        for result in problems:
            lines.append(f"- `{result.id}` — {'; '.join(result.failures)}")
    lines.append("")
    return "\n".join(lines)


def report_payload(report: ConsistencyReport) -> dict[str, Any]:
    return {
        "mode": report.mode,
        "generated_at": report.generated_at,
        "repeats": report.repeats,
        "case_count": report.total,
        "passed": report.passed,
        "failed": report.failed,
        "infra": report.infra,
        "structural_agreement": round(report.structural_agreement, 4),
        "cases": [
            {
                "id": result.id,
                "message": result.message,
                "runs": result.runs,
                "status": result.status,
                "routes": list(result.routes),
                "distinct_skeletons": result.skeletons,
                "distinct_subject_orders": result.subject_orders,
                "distinct_citations": result.citations,
                "distinct_bottom_lines": result.bottoms,
                "failures": result.failures,
            }
            for result in report.results
        ],
    }


def write_outputs(refresh: ConsistencyReport, out_dir: Path | None = None) -> tuple[Path, Path]:
    target = out_dir or OUT_DIR
    target.mkdir(parents=True, exist_ok=True)
    json_path = target / f"consistency-{refresh.mode}.json"
    md_path = target / f"consistency-{refresh.mode}.md"
    json_path.write_text(
        json.dumps(report_payload(refresh), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    md_path.write_text(render(refresh), encoding="utf-8")
    return json_path, md_path


def exit_code(report: ConsistencyReport) -> int:
    if report.failed:
        return 1
    if report.infra and report.mode != "offline":
        return 2
    return 0


__all__ = [
    "ConsistencyCaseResult",
    "ConsistencyPrompt",
    "ConsistencyReport",
    "LiveNotConfigured",
    "PROMPTS",
    "exit_code",
    "render",
    "report_payload",
    "run_live",
    "run_modes",
    "run_offline",
    "write_outputs",
]
