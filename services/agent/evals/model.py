"""Typed model + loader for the Sparky golden eval set.

The set lives in ``golden.yaml`` next to this module. Every case is a real user message
(with optional conversation history and a wallet fixture) plus the CURRENT intended
behaviour: the route it should take, the blocks it should (not) emit, the substrings a
reply must (not) contain, and the rubric dimensions the judge should weigh.

Keeping the data in YAML makes the suite reviewable by non-engineers and means adding a
case never means touching the runner.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

EVALS_DIR = Path(__file__).resolve().parent
GOLDEN_PATH = EVALS_DIR / "golden.yaml"
RUBRIC_PATH = EVALS_DIR / "rubric.yaml"
OUT_DIR = EVALS_DIR / "out"

#: Route label for an emitted ``action`` block of type ``aerodrome_swap``.
SWAP_ROUTE_PREFIX = "swap_card:"


@dataclass(frozen=True)
class HistoryTurn:
    role: str
    content: str


@dataclass(frozen=True)
class ActionExpectation:
    """What the emitted ``proposedAction`` / recommendation card must look like."""

    type: str | None = None
    amount: str | None = None
    token_in: str | None = None
    token_out: str | None = None
    policy: str | None = None


@dataclass(frozen=True)
class Expectation:
    routes: tuple[str, ...]
    blocks_present: tuple[str, ...] = ()
    blocks_absent: tuple[str, ...] = ()
    must_contain: tuple[str, ...] = ()
    must_not_contain: tuple[str, ...] = ()
    english: bool = True
    rubric: tuple[str, ...] = ("accuracy", "grounding", "safety", "tone")
    action: ActionExpectation = field(default_factory=ActionExpectation)


@dataclass(frozen=True)
class Scripted:
    """Canned LLM behaviour for the deterministic OFFLINE run.

    ``intent`` supplies the planner's structured answer when a case legitimately needs the
    classifier (portfolio / proposal / knowledge / general). Deterministic routes must fire
    BEFORE this, so a wrong route still fails loudly instead of being papered over.
    ``prose`` is used by the literacy / Sparky doubles. ``ranking`` is the recommender's
    canned JSON when a RECOMMEND turn reaches stage 3.
    """

    intent: Mapping[str, Any] | None = None
    prose: str | None = None
    ranking: Mapping[str, Any] | None = None


@dataclass(frozen=True)
class Case:
    id: str
    category: str
    prompt: str
    wallet: str = "empty"
    chain_id: int = 8453
    history: tuple[HistoryTurn, ...] = ()
    expected: Expectation = field(default_factory=lambda: Expectation(()))
    offline: Scripted = field(default_factory=Scripted)
    offline_check_contains: bool = True
    read_only: bool = True


@dataclass(frozen=True)
class Rubric:
    dimensions: Mapping[str, str]
    min_each: int
    min_safety: int
    scale_min: int
    scale_max: int


def _as_tuple(value: Any) -> tuple[str, ...]:
    if value is None:
        return ()
    if isinstance(value, str):
        return (value,)
    return tuple(str(item) for item in value)


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _case_from_mapping(raw: Mapping[str, Any]) -> Case:
    expected_raw = _mapping(raw.get("expected"))
    action_raw = _mapping(expected_raw.get("action"))
    routes = _as_tuple(expected_raw.get("routes") or expected_raw.get("route"))
    history = tuple(
        HistoryTurn(role=str(turn.get("role")), content=str(turn.get("content")))
        for turn in raw.get("history") or ()
        if isinstance(turn, Mapping)
    )
    offline_raw = _mapping(raw.get("offline"))
    return Case(
        id=str(raw["id"]),
        category=str(raw.get("category", "uncategorised")),
        prompt=str(raw.get("prompt", "")),
        wallet=str(raw.get("wallet", "empty")),
        chain_id=int(raw.get("chain_id", 8453)),
        history=history,
        expected=Expectation(
            routes=routes,
            blocks_present=_as_tuple(expected_raw.get("blocks_present")),
            blocks_absent=_as_tuple(expected_raw.get("blocks_absent")),
            must_contain=_as_tuple(expected_raw.get("must_contain")),
            must_not_contain=_as_tuple(expected_raw.get("must_not_contain")),
            english=bool(expected_raw.get("english", True)),
            rubric=_as_tuple(
                expected_raw.get("rubric") or ("accuracy", "grounding", "safety", "tone")
            ),
            action=ActionExpectation(
                type=action_raw.get("type"),
                amount=action_raw.get("amount"),
                token_in=action_raw.get("token_in"),
                token_out=action_raw.get("token_out"),
                policy=action_raw.get("policy"),
            ),
        ),
        offline=Scripted(
            intent=_mapping(offline_raw.get("intent")) or None,
            prose=offline_raw.get("prose"),
            ranking=_mapping(offline_raw.get("ranking")) or None,
        ),
        offline_check_contains=bool(raw.get("offline_check_contains", True)),
        read_only=bool(raw.get("read_only", True)),
    )


def load_cases(path: Path | None = None) -> tuple[Case, ...]:
    """Load + validate the golden set (unique ids, every case has expected routes)."""
    payload = yaml.safe_load((path or GOLDEN_PATH).read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError("golden.yaml must be a mapping with a cases list")
    cases = tuple(_case_from_mapping(raw) for raw in payload.get("cases") or ())
    if not cases:
        raise ValueError("golden.yaml contains no cases")
    ids = [case.id for case in cases]
    if len(ids) != len(set(ids)):
        duplicates = sorted({item for item in ids if ids.count(item) > 1})
        raise ValueError(f"duplicate case ids: {duplicates}")
    missing = [case.id for case in cases if not case.expected.routes]
    if missing:
        raise ValueError(f"cases without an expected route: {missing}")
    return cases


def load_rubric(path: Path | None = None) -> Rubric:
    """Load the judge rubric (dimensions + pass thresholds)."""
    payload = yaml.safe_load((path or RUBRIC_PATH).read_text(encoding="utf-8"))
    if not isinstance(payload, Mapping):
        raise ValueError("rubric.yaml must be a mapping")
    scale = _mapping(payload.get("scale"))
    passing = _mapping(payload.get("pass"))
    dimensions = _mapping(payload.get("dimensions"))
    return Rubric(
        dimensions={str(key): str(value) for key, value in dimensions.items()},
        min_each=int(passing.get("min_each", 3)),
        min_safety=int(passing.get("min_safety", 4)),
        scale_min=int(scale.get("min", 1)),
        scale_max=int(scale.get("max", 5)),
    )


__all__ = [
    "ActionExpectation",
    "Case",
    "EVALS_DIR",
    "Expectation",
    "GOLDEN_PATH",
    "HistoryTurn",
    "OUT_DIR",
    "RUBRIC_PATH",
    "Rubric",
    "SWAP_ROUTE_PREFIX",
    "Scripted",
    "load_cases",
    "load_rubric",
]
