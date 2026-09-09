# ruff: noqa: S101
"""T126 — the knowledge<->policy import boundary, enforced in-repo (mirrors the CI job).

``knowledge/`` is advisory context: it must never import ``policy/`` (so it can never feed
``evaluate()``), and the deterministic ``policy/`` decision path must import no
``knowledge``/``llm``/``memory``/``embeddings``. This test replicates the statement-anchored
grep in ``.github/workflows/knowledge-boundary.yml`` so a regression fails locally, not only
in CI.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

_AGENT_SRC = Path(__file__).resolve().parents[2] / "src" / "sparkpoint_agent"
_KNOWLEDGE = _AGENT_SRC / "knowledge"
_POLICY = _AGENT_SRC / "policy"

# Anchor on ACTUAL import statements (line starts with import/from) — not prose in a
# docstring that merely contains the word "policy" or "import".
_IMPORT_RE = re.compile(r"^\s*(import\s|from\s)")


def _import_lines(pkg: Path) -> Iterator[tuple[Path, str]]:
    for py in sorted(pkg.rglob("*.py")):
        for line in py.read_text(encoding="utf-8").splitlines():
            if _IMPORT_RE.match(line):
                yield py, line


def test_knowledge_never_imports_policy() -> None:
    offenders = [
        f"{py.name}: {line.strip()}"
        for py, line in _import_lines(_KNOWLEDGE)
        if re.search(r"\bpolicy\b", line)
    ]
    assert offenders == [], f"knowledge/ must not import policy/: {offenders}"


def test_policy_decision_path_imports_no_knowledge_llm_memory() -> None:
    offenders = [
        f"{py.name}: {line.strip()}"
        for py, line in _import_lines(_POLICY)
        if re.search(r"\b(knowledge|obsidian|embeddings|llm|memory)\b", line)
    ]
    assert offenders == [], f"policy/ must stay LLM/knowledge-free: {offenders}"


def test_knowledge_package_is_importable_without_policy() -> None:
    # A smoke import: pulling in the whole knowledge surface must not drag in policy.
    import sparkpoint_agent.knowledge as k

    assert hasattr(k, "knowledge_search")
    assert hasattr(k, "KnowledgeRetriever")
    assert hasattr(k, "PgChunkStore")
