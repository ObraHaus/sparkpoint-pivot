# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Regression guard for the limits_event verdict set (062).

The beta `quota_refund_failed` alarm came from writing a `refund` verdict into a table whose
0015 CHECK only permits `allow`/`deny`/`throttle`. These tests keep the code constant and the
SQL CHECK in lockstep, and reject any literal verdict passed to `record_event(` that the DB
would refuse — the class of misuse that a permissive fake hid for two features.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

from sparkpoint_agent.db.limits import EVENT_VERDICTS

_AGENT_ROOT = Path(__file__).resolve().parents[1]
_MIGRATION = _AGENT_ROOT / "migrations" / "0015_limits.sql"
_SRC = _AGENT_ROOT / "src"


def _verdicts_from_migration() -> tuple[str, ...]:
    sql = _MIGRATION.read_text(encoding="utf-8")
    match = re.search(
        r"CHECK\s*\(\s*verdict\s+IN\s*\(([^)]*)\)\s*\)", sql, flags=re.IGNORECASE | re.DOTALL
    )
    assert match is not None, "could not find the limits_event verdict CHECK in 0015_limits.sql"
    return tuple(re.findall(r"'([^']+)'", match.group(1)))


def _literal_verdicts_passed_to_record_event() -> list[tuple[str, str]]:
    """(file, literal verdict) for every literal first arg/keyword passed to `record_event(`."""
    found: list[tuple[str, str]] = []
    for path in sorted(_SRC.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", None)
            if name != "record_event":
                continue
            args = list(node.args)
            verdict_node = args[0] if args else None
            if verdict_node is None:
                for kw in node.keywords:
                    if kw.arg == "verdict":
                        verdict_node = kw.value
                        break
            if isinstance(verdict_node, ast.Constant) and isinstance(verdict_node.value, str):
                found.append((str(path.relative_to(_AGENT_ROOT)), verdict_node.value))
    return found


def test_event_verdicts_matches_the_0015_check() -> None:
    assert _verdicts_from_migration() == EVENT_VERDICTS


def test_every_literal_record_event_verdict_is_allowed() -> None:
    literals = _literal_verdicts_passed_to_record_event()
    # Sanity: the scan must actually find the deny call, or the guard is vacuous.
    assert any(verdict == "deny" for _, verdict in literals)
    invalid = [(path, verdict) for path, verdict in literals if verdict not in EVENT_VERDICTS]
    assert invalid == [], f"record_event called with a verdict the 0015 CHECK rejects: {invalid}"
