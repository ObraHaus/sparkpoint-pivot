# ruff: noqa: S101
"""zod ⟷ pydantic wire-parity guard for the execution models (feature 019 US2).

The repo's policy-parity CI only compares 6 numeric/address constants; model/enum parity was
convention-only (both enum files carry a stale "T098 fails on drift" comment that nothing enforces —
research R8). This test parses the shared zod ``.strict()`` schemas and asserts the pydantic mirrors
expose EXACTLY the same field names — a real drift guard for the models this feature adds.

Skips gracefully if ``packages/shared`` is not checked out alongside the agent (it always is in CI).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import BaseModel

from sparkpoint_agent.execution.models import (
    GuardrailCheck,
    IntentBundle,
    IntentStep,
    PackedUserOperation,
    WirePolicyVerdict,
    WireReason,
)
from sparkpoint_agent.sim import SimulationResult

_SCHEMAS_DIR = Path(__file__).resolve().parents[4] / "packages" / "shared" / "src" / "schemas"


def _zod_fields(source: str, schema_name: str) -> set[str]:
    """Extract the top-level object field names from a flat zod ``.strict()`` schema."""
    start = source.index(f"export const {schema_name} = z")
    obj = source.index(".object({", start) + len(".object({")
    end = source.index("})", obj)
    block = source[obj:end]
    # strip block comments so a `word:` inside a /** ... */ doc isn't captured
    block = re.sub(r"/\*.*?\*/", "", block, flags=re.S)
    # a field is a 4-space-indented `name:` at the start of a line
    return set(re.findall(r"^\s{4}(\w+):", block, flags=re.M))


def _read(name: str) -> str:
    return (_SCHEMAS_DIR / name).read_text(encoding="utf-8")


_CASES: list[tuple[type[BaseModel], str, str]] = [
    (IntentStep, "intent-bundle.ts", "IntentStepSchema"),
    (PackedUserOperation, "intent-bundle.ts", "PackedUserOperationSchema"),
    (IntentBundle, "intent-bundle.ts", "IntentBundleSchema"),
    (WirePolicyVerdict, "policy-verdict.ts", "PolicyVerdictSchema"),
    (WireReason, "policy-verdict.ts", "ReasonSchema"),
    (GuardrailCheck, "guardrail.ts", "GuardrailCheckSchema"),
    (SimulationResult, "simulation.ts", "SimulationResultSchema"),
]


@pytest.mark.skipif(not _SCHEMAS_DIR.exists(), reason="packages/shared not checked out")
@pytest.mark.parametrize(("model", "file", "schema"), _CASES)
def test_pydantic_matches_zod_field_set(model: type[BaseModel], file: str, schema: str) -> None:
    zod = _zod_fields(_read(file), schema)
    py = set(model.model_fields.keys())
    assert py == zod, (
        f"{model.__name__} drifted from {schema}: py-only={py - zod}, zod-only={zod - py}"
    )
