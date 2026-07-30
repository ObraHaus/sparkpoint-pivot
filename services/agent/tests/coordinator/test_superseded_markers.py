# ruff: noqa: S101  (pytest asserts)
"""023 T023 — the superseded coordinator scaffolding stays marked, and stays unreachable.

FR-023-016 / SC-023-007. ``coordinator/coordinator.py``, ``flows.py`` and ``agentic_loop.py``
describe
the execution interposition, but the one that RUNS is ``execution/orchestrate.py``. The 023 clarify
decision was to RETAIN them with a marker rather than delete them — which means the "not executed"
claim now rests on a comment, and a comment can rot. This test is what makes it durable: prose never
stopped a regression; a failing test does.

Two halves, both necessary:
  1. the marker is present in all three modules (so an auditor cannot read them as load-bearing);
  2. nothing outside ``coordinator/`` imports the superseded symbols (so the claim is TRUE).
"""

from __future__ import annotations

import ast
from pathlib import Path

_SRC = Path(__file__).resolve().parents[2] / "src" / "sparkpoint_agent"
_COORDINATOR = _SRC / "coordinator"

SUPERSEDED_MODULES = ("coordinator.py", "flows.py", "agentic_loop.py")

#: Symbols that exist ONLY in the superseded scaffolding. If one of these appears in a module
#: outside
#: ``coordinator/``, the scaffolding is live after all and the marker is a lie.
SUPERSEDED_SYMBOLS = frozenset(
    {"Coordinator", "FlowState", "AgentRunner", "run_read", "run_execution", "execution_flow_for"}
)

#: The live implementation the marker must point at.
LIVE_INTERPOSITION = "execution/orchestrate.py"


def test_every_superseded_module_carries_the_marker() -> None:
    for name in SUPERSEDED_MODULES:
        text = (_COORDINATOR / name).read_text()
        assert "SUPERSEDED" in text, f"{name} lost its SUPERSEDED marker"
        assert "NOT EXECUTED" in text, f"{name} must say plainly that it does not run"
        assert LIVE_INTERPOSITION in text, f"{name} must name the live path ({LIVE_INTERPOSITION})"
        # The marker belongs in the module DOCSTRING, not in a comment somewhere further down —
        # that is what a reader (and a doc tool) actually sees first.
        doc = ast.get_docstring(ast.parse(text)) or ""
        assert "SUPERSEDED" in doc, f"{name}'s marker must be in the module docstring"


def _modules_outside_coordinator() -> list[Path]:
    return [
        path
        for path in _SRC.rglob("*.py")
        if _COORDINATOR not in path.parents and path.parent != _COORDINATOR
    ]


def test_no_module_outside_coordinator_imports_the_superseded_symbols() -> None:
    """The half that keeps the marker HONEST. Parsed with ``ast`` rather than grepped, so a symbol
    mentioned in prose or a docstring does not raise a false alarm — only a real import counts."""
    offenders: list[str] = []
    for path in _modules_outside_coordinator():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                imported = {alias.name for alias in node.names}
                if imported & SUPERSEDED_SYMBOLS:
                    offenders.append(f"{path.name}: from {node.module} import {sorted(imported)}")
            elif isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.endswith((".coordinator.flows", ".coordinator.agentic_loop")):
                        offenders.append(f"{path.name}: import {alias.name}")
    assert offenders == [], (
        "the superseded scaffolding is being imported outside coordinator/ — either it is live "
        f"again (drop the marker and wire it properly) or this is a mistake: {offenders}"
    )


def test_the_live_interposition_actually_exists() -> None:
    """A marker pointing at a moved or renamed module would be worse than no marker."""
    assert (_SRC / "execution" / "orchestrate.py").is_file()
    text = (_SRC / "execution" / "orchestrate.py").read_text()
    # The live module must still be the one that calls the pure policy gate.
    assert "evaluate(action, ctx)" in text
