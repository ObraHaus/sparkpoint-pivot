"""The Sparky eval runner — offline (deterministic), live (gateway), and HTTP targets.

Offline is the blocking CI path: every case runs through the real ``CoordinatorDag`` with a
canned LLM and fixed reads, so routing/cards/guardrails are pinned in under a minute.
Live replays the same cases through the configured LiteLLM gateway and adds an LLM judge;
it is intentionally NON-BLOCKING in CI because free-model infrastructure is flaky.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sparkpoint_agent.llm import AsyncClaudeClient
from sparkpoint_agent.llm.claude import gateway_from_env

from .assertions import case_failures, classify_route
from .fixtures import RecordingClient, build_dag, chain_context
from .judge import JudgeResult, judge_case, judge_passes
from .model import OUT_DIR, Case, Rubric, load_cases, load_rubric

_INFRA_ERROR_CODE = "UPSTREAM_UNAVAILABLE"


class LiveNotConfigured(RuntimeError):
    """The LiteLLM gateway env is absent — live mode skips cleanly, never fails."""


class HttpNotConfigured(RuntimeError):
    """EVAL_BASE_URL / EVAL_SESSION_COOKIE are absent — HTTP mode skips cleanly."""


@dataclass
class CaseResult:
    id: str
    category: str
    status: str
    routes: tuple[str, ...]
    observed: str
    failures: list[str] = field(default_factory=list)
    scores: Mapping[str, int] | None = None
    notes: str = ""
    latency_ms: Mapping[str, float] | None = None
    infra_reason: str | None = None


@dataclass
class Report:
    mode: str
    results: list[CaseResult]
    gateway_model: str | None = None
    generated_at: str = ""
    rubric: Rubric | None = None

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
    def pass_rate(self) -> float:
        judged = self.passed + self.failed
        return (self.passed / judged) if judged else 0.0


def _now() -> str:
    return datetime.now(UTC).isoformat()


async def _execute(
    case: Case,
    client: Any,
    *,
    live: bool,
) -> list[dict[str, Any]]:
    dag = build_dag(case=case, client=client, live=live)
    history = [(turn.role, turn.content) for turn in case.history]
    return [
        block.to_wire()
        async for block in dag.run_chat(case.prompt, chain_context(case.chain_id), history=history)
    ]


async def _execute_timed(
    case: Case,
    client: Any,
) -> tuple[list[dict[str, Any]], dict[str, float]]:
    dag = build_dag(case=case, client=client, live=True)
    history = [(turn.role, turn.content) for turn in case.history]
    start = time.perf_counter()
    first_ms: float | None = None
    wires: list[dict[str, Any]] = []
    async for block in dag.run_chat(case.prompt, chain_context(case.chain_id), history=history):
        wire = block.to_wire()
        wires.append(wire)
        if first_ms is None and wire.get("type") != "tool_step":
            first_ms = (time.perf_counter() - start) * 1000
    total_ms = (time.perf_counter() - start) * 1000
    return wires, {"first_token": first_ms if first_ms is not None else total_ms, "total": total_ms}


def _result(
    case: Case,
    *,
    status: str,
    observed: str,
    failures: Sequence[str] = (),
    scores: Mapping[str, int] | None = None,
    notes: str = "",
    latency: Mapping[str, float] | None = None,
    infra_reason: str | None = None,
) -> CaseResult:
    return CaseResult(
        id=case.id,
        category=case.category,
        status=status,
        routes=case.expected.routes,
        observed=observed,
        failures=list(failures),
        scores=scores,
        notes=notes,
        latency_ms=latency,
        infra_reason=infra_reason,
    )


async def run_offline(cases: Sequence[Case] | None = None) -> Report:
    """Deterministic in-process run — no network, no DB, no clock in the expectations."""
    selected = tuple(cases) if cases is not None else load_cases()
    results: list[CaseResult] = []
    for case in selected:
        client = _fake_client(case)
        try:
            wires = await _execute(case, client, live=False)
        except Exception as exc:  # noqa: BLE001 — one bad case must not abort the suite
            results.append(
                _result(
                    case,
                    status="fail",
                    observed="error",
                    failures=[f"runner error: {type(exc).__name__}: {exc}"],
                )
            )
            continue
        failures = case_failures(case, wires, offline=True)
        results.append(
            _result(
                case,
                status="fail" if failures else "pass",
                observed=classify_route(wires),
                failures=failures,
            )
        )
    return Report(mode="offline", results=results, generated_at=_now())


def _fake_client(case: Case) -> Any:
    from .fixtures import _FakeLlm  # local import keeps the public fixture surface small

    return _FakeLlm(case.offline)


def _error_label(exc: BaseException) -> str:
    name = type(exc).__name__
    status = getattr(exc, "status_code", None)
    return f"{name} {status}" if status is not None else name


def _is_infra(wires: Sequence[Mapping[str, Any]], client: RecordingClient) -> str | None:
    if client.errors:
        return f"llm transport: {_error_label(client.errors[-1])}"
    for wire in wires:
        if wire.get("type") == "error" and wire.get("code") == _INFRA_ERROR_CODE:
            return "assistant returned UPSTREAM_UNAVAILABLE"
    if not wires or all(wire.get("type") == "tool_step" for wire in wires):
        return "empty stream"
    return None


async def _judge_with_retries(
    client: AsyncClaudeClient,
    case: Case,
    wires: Sequence[Mapping[str, Any]],
    rubric: Rubric,
    *,
    timeout_s: float,
) -> JudgeResult:
    last = JudgeResult(scores=None, error="judge not attempted")
    for attempt in range(2):
        try:
            last = await asyncio.wait_for(
                judge_case(client, case, wires, rubric), timeout=timeout_s
            )
        except TimeoutError:
            last = JudgeResult(scores=None, error="judge timeout")
        if last.ok:
            return last
        if attempt == 0:
            await asyncio.sleep(2)
    return last


async def run_live(
    cases: Sequence[Case] | None = None,
    *,
    retries: int = 2,
    timeout_s: float = 60.0,
) -> Report:
    """Replay the set through the real gateway, then score every reply with the LLM judge."""
    if gateway_from_env() is None:
        raise LiveNotConfigured(
            "LITELLM_BASE_URL and LITELLM_API_KEY are not set; live mode skipped."
        )
    selected = tuple(cases) if cases is not None else load_cases()
    rubric = load_rubric()
    client = AsyncClaudeClient.from_env()
    gateway_model = (os.getenv("LITELLM_MODEL") or "").strip() or "sparkpoint-chat"
    results: list[CaseResult] = []

    for case in selected:
        last_infra: str | None = None
        for attempt in range(retries + 1):
            recording = RecordingClient(client)
            try:
                wires, latency = await asyncio.wait_for(
                    _execute_timed(case, recording), timeout=timeout_s
                )
                failure: str | None = None
            except TimeoutError:
                wires, latency, failure = [], None, "timeout"
            except Exception as exc:  # noqa: BLE001 — transport failures are infra, not answers
                wires, latency, failure = [], None, f"transport: {_error_label(exc)}"
            infra = failure or _is_infra(wires, recording)
            if infra and attempt < retries:
                await asyncio.sleep(2 ** (attempt + 1))
                last_infra = infra
                continue
            if infra:
                results.append(
                    _result(
                        case,
                        status="infra",
                        observed="infra",
                        failures=[f"infra: {infra}"],
                        latency=latency,
                        infra_reason=infra,
                    )
                )
                break

            failures = case_failures(case, wires, offline=False)
            judge = await _judge_with_retries(
                client, case, wires, rubric, timeout_s=timeout_s
            )
            observed = classify_route(wires)
            if not judge.ok or judge.scores is None:
                results.append(
                    _result(
                        case,
                        status="infra",
                        observed=observed,
                        failures=[f"judge infra: {judge.error or 'no scores'}"],
                        latency=latency,
                        infra_reason=f"judge: {judge.error or 'no scores'}",
                    )
                )
                break
            if not judge_passes(judge.scores, rubric):
                failures.append(
                    "judge below threshold: "
                    + ", ".join(f"{key}={value}" for key, value in judge.scores.items())
                )
            results.append(
                _result(
                    case,
                    status="fail" if failures else "pass",
                    observed=observed,
                    failures=failures,
                    scores=judge.scores,
                    notes=judge.notes,
                    latency=latency,
                )
            )
            break
        else:  # pragma: no cover - the loop always breaks or continues to retries
            results.append(
                _result(
                    case,
                    status="infra",
                    observed="infra",
                    failures=[f"infra: {last_infra or 'exhausted retries'}"],
                    infra_reason=last_infra,
                )
            )
    return Report(
        mode="live",
        results=results,
        gateway_model=gateway_model,
        generated_at=_now(),
        rubric=rubric,
    )


async def run_http(
    cases: Sequence[Case] | None = None,
    *,
    request_timeout: float = 60.0,
) -> Report:
    """Optional read-only run against a deployed ``/chat`` SSE endpoint."""
    base_url = (os.getenv("EVAL_BASE_URL") or "").strip()
    cookie = (os.getenv("EVAL_SESSION_COOKIE") or "").strip()
    if not base_url or not cookie:
        raise HttpNotConfigured("EVAL_BASE_URL / EVAL_SESSION_COOKIE are not set; HTTP skipped.")

    import httpx

    selected = tuple(cases) if cases is not None else load_cases()
    readable = tuple(
        case
        for case in selected
        if case.read_only
        and not (set(case.expected.blocks_present) & {"action", "recommendation"})
        and not any(
            route.startswith(("proposal:", "swap_card:", "recommendation"))
            for route in case.expected.routes
        )
    )
    results: list[CaseResult] = []
    url = base_url.rstrip("/") + "/chat"
    headers = {"Cookie": cookie, "Accept": "text/event-stream"}
    async with httpx.AsyncClient(timeout=request_timeout) as http:
        for case in readable:
            wires: list[dict[str, Any]] = []
            try:
                async with http.stream(
                    "POST", url, json={"message": case.prompt}, headers=headers
                ) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        payload = line[len("data:") :].strip()
                        if not payload:
                            continue
                        try:
                            decoded = json.loads(payload)
                        except json.JSONDecodeError:
                            continue
                        if isinstance(decoded, Mapping) and decoded.get("type"):
                            wires.append(dict(decoded))
            except Exception as exc:  # noqa: BLE001 — an HTTP failure is infra, not an answer
                results.append(
                    _result(
                        case,
                        status="infra",
                        observed="infra",
                        failures=[f"http: {type(exc).__name__}"],
                        infra_reason=type(exc).__name__,
                    )
                )
                continue
            failures = case_failures(case, wires, offline=False)
            results.append(
                _result(
                    case,
                    status="fail" if failures else "pass",
                    observed=classify_route(wires),
                    failures=failures,
                )
            )
    return Report(mode="http", results=results, generated_at=_now())


def _percentile(values: Sequence[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    weight = position - lower
    return ordered[lower] * (1 - weight) + ordered[upper] * weight


def _rubric_means(report: Report) -> dict[str, float]:
    means: dict[str, float] = {}
    if report.rubric is None:
        return means
    for dimension in report.rubric.dimensions:
        values = [
            float(result.scores[dimension])
            for result in report.results
            if result.scores is not None and dimension in result.scores
        ]
        if values:
            means[dimension] = round(sum(values) / len(values), 2)
    return means


def _latencies(report: Report) -> dict[str, dict[str, float | None]]:
    first = [
        float(result.latency_ms["first_token"])
        for result in report.results
        if result.latency_ms and result.latency_ms.get("first_token") is not None
    ]
    total = [
        float(result.latency_ms["total"])
        for result in report.results
        if result.latency_ms and result.latency_ms.get("total") is not None
    ]
    return {
        "first_token": {
            "p50": _percentile(first, 0.5),
            "p95": _percentile(first, 0.95),
        },
        "total": {"p50": _percentile(total, 0.5), "p95": _percentile(total, 0.95)},
    }


def _categories(report: Report) -> dict[str, dict[str, int]]:
    categories: dict[str, dict[str, int]] = {}
    for result in report.results:
        bucket = categories.setdefault(
            result.category, {"cases": 0, "pass": 0, "fail": 0, "infra": 0}
        )
        bucket["cases"] += 1
        bucket[result.status] += 1
    return categories


def report_payload(report: Report) -> dict[str, Any]:
    return {
        "mode": report.mode,
        "generated_at": report.generated_at,
        "gateway_model": report.gateway_model,
        "case_count": report.total,
        "passed": report.passed,
        "failed": report.failed,
        "infra": report.infra,
        "pass_rate": round(report.pass_rate, 4),
        "categories": _categories(report),
        "rubric_means": _rubric_means(report),
        "latency_ms": _latencies(report),
        "cases": [
            {
                "id": result.id,
                "category": result.category,
                "status": result.status,
                "expected_routes": list(result.routes),
                "observed_route": result.observed,
                "failures": result.failures,
                "scores": dict(result.scores) if result.scores is not None else None,
                "notes": result.notes,
                "latency_ms": result.latency_ms,
                "infra_reason": result.infra_reason,
            }
            for result in report.results
        ],
    }


def render_summary(report: Report) -> str:
    lines = [
        f"# Agent evals — {report.mode}",
        "",
        f"- Cases: **{report.total}**",
        f"- Pass: **{report.passed}** ({report.pass_rate:.1%})",
        f"- Fail: **{report.failed}**",
        f"- Infra (not a product failure): **{report.infra}**",
    ]
    if report.gateway_model:
        lines.append(f"- Gateway model alias: `{report.gateway_model}`")
    if report.rubric is not None:
        lines.append(
            f"- Judge pass threshold: each ≥ {report.rubric.min_each}, "
            f"safety ≥ {report.rubric.min_safety} (scale {report.rubric.scale_min}–"
            f"{report.rubric.scale_max})"
        )
    lines += [
        "",
        "## By category",
        "",
        "| Category | Cases | Pass | Fail | Infra |",
        "|---|---:|---:|---:|---:|",
    ]
    for name, bucket in _categories(report).items():
        lines.append(
            f"| {name} | {bucket['cases']} | {bucket['pass']} | {bucket['fail']} | "
            f"{bucket['infra']} |"
        )
    means = _rubric_means(report)
    if means:
        lines += ["", "## Rubric means", ""]
        lines += [f"- {name}: **{value}**" for name, value in means.items()]
    if report.mode in {"live", "http"}:
        latency = _latencies(report)
        lines += ["", "## Latency (ms)", ""]
        for bucket, stats in latency.items():
            p50 = f"{stats['p50']:.0f}" if stats["p50"] is not None else "—"
            p95 = f"{stats['p95']:.0f}" if stats["p95"] is not None else "—"
            lines.append(f"- {bucket}: p50 {p50} · p95 {p95}")
    problems = [result for result in report.results if result.status != "pass"]
    if problems:
        lines += ["", "## Non-passing cases", ""]
        for result in problems:
            detail = "; ".join(result.failures)[:220]
            lines.append(f"- `{result.id}` ({result.status}) — {detail}")
    lines.append("")
    return "\n".join(lines)


def write_outputs(report: Report, out_dir: Path | None = None) -> tuple[Path, Path]:
    target = out_dir or OUT_DIR
    target.mkdir(parents=True, exist_ok=True)
    results_path = target / "results.json"
    summary_path = target / "summary.md"
    results_path.write_text(
        json.dumps(report_payload(report), indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    summary_path.write_text(render_summary(report), encoding="utf-8")
    return results_path, summary_path


def exit_code(report: Report) -> int:
    if report.failed:
        return 1
    if report.infra and report.mode != "offline":
        return 2
    return 0


__all__ = [
    "CaseResult",
    "HttpNotConfigured",
    "LiveNotConfigured",
    "Report",
    "exit_code",
    "render_summary",
    "report_payload",
    "run_http",
    "run_live",
    "run_offline",
    "write_outputs",
]
