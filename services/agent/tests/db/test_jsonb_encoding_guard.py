# ruff: noqa: S101
"""031 — kill the SQL_ASCII jsonb bug as a CLASS, not one instance at a time.

The develop database is `server_encoding = SQL_ASCII`. Its jsonb parser HARD-REJECTS any
`\\uXXXX` escape above ASCII, and `json.dumps` escapes non-ASCII **by default**. So any jsonb
write whose payload contains an em-dash, a curly quote, an arrow or an accented name fails with
`UntranslatableCharacterError` — and because these writes are usually inside fail-open handlers,
it fails *silently*.

This bug has now been found and fixed three separate times, each time by accident:

  * **025 / #125** — the assistant's turn writer. Every real assistant reply was being dropped,
    invisibly, because LLM prose is full of em-dashes.
  * **030** — the mandate writer. A goal label with a curly quote would have failed the whole save.
  * **031** — the knowledge chunk indexer. Chunk metadata carries the note TITLE, so 19 of 40
    changelog entries failed to index, and they were precisely the well-written ones.

Three instances is a class, not a coincidence. Rather than wait for the fourth, this test asserts
the rule across the whole data layer: **every `json.dumps` that can reach the database passes
`ensure_ascii=False`.**

The permanent fix is to recreate the database as UTF8, which is a maintenance window the client
has not yet scheduled. Until then this test is what stands between the next new jsonb write and a
silent data-loss bug.
"""

from __future__ import annotations

import re
from pathlib import Path

#: Directories whose modules write to Postgres.
_DATA_LAYER = ("db", "data", "knowledge")

#: `json.dumps(` … up to its matching close, allowing one level of nested parens.
_DUMPS = re.compile(r"json\.dumps\(", re.MULTILINE)


def _source_files() -> list[Path]:
    root = Path(__file__).resolve().parents[2] / "src" / "sparkpoint_agent"
    files: list[Path] = []
    for area in _DATA_LAYER:
        files.extend(sorted((root / area).rglob("*.py")))
    return files


def _dumps_calls(text: str) -> list[str]:
    """Every `json.dumps(...)` call in `text`, as source strings (paren-balanced)."""
    calls: list[str] = []
    for match in _DUMPS.finditer(text):
        start = match.end() - 1  # at the opening paren
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "(":
                depth += 1
            elif text[i] == ")":
                depth -= 1
                if depth == 0:
                    calls.append(text[match.start() : i + 1])
                    break
    return calls


def test_every_data_layer_json_dumps_disables_ascii_escaping() -> None:
    offenders: list[str] = []
    for path in _source_files():
        text = path.read_text(encoding="utf-8")
        for call in _dumps_calls(text):
            if "ensure_ascii=False" not in call:
                one_line = " ".join(call.split())
                offenders.append(f"{path.name}: {one_line[:100]}")

    assert not offenders, (
        "These jsonb writes escape non-ASCII by default, which this database REJECTS.\n"
        "A payload containing an em-dash or curly quote will fail — usually silently, inside a\n"
        "fail-open handler. Add ensure_ascii=False:\n  " + "\n  ".join(offenders)
    )


def test_the_guard_can_actually_detect_an_offender() -> None:
    """A guard that cannot fail is not a guard. Proves the parser sees an unguarded call."""
    bad = 'json.dumps({"a": 1})'
    good = 'json.dumps({"a": 1}, ensure_ascii=False)'
    assert _dumps_calls(bad) == [bad]
    assert "ensure_ascii=False" not in _dumps_calls(bad)[0]
    assert "ensure_ascii=False" in _dumps_calls(good)[0]


def test_the_guard_handles_nested_calls_and_multiline_arguments() -> None:
    nested = 'json.dumps(dict(x=f(1, 2)), ensure_ascii=False)'
    assert _dumps_calls(nested) == [nested]

    multiline = 'json.dumps(\n    {"a": 1},\n    ensure_ascii=False,\n)'
    calls = _dumps_calls(multiline)
    assert len(calls) == 1
    assert "ensure_ascii=False" in calls[0]


def test_a_realistic_payload_would_have_broken_the_unguarded_form() -> None:
    """The actual failure, reproduced in miniature — this is what was reaching the database."""
    import json

    payload = {"title": "Sparky answers straight — and admits it when something breaks"}
    assert "\\u2014" in json.dumps(payload), "the default escapes the em-dash"
    assert "\\u2014" not in json.dumps(payload, ensure_ascii=False)
    assert "—" in json.dumps(payload, ensure_ascii=False)
