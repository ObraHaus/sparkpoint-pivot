# ruff: noqa: S101
"""Feature 006 — the committed changelog seed loader (content_seed.py).

Tests the pure JSON parsing/validation and the seed_changelog orchestration against a fake store.
The adopt/skip/update SQL semantics live in ContentEntryStore.upsert_seed and are exercised live in
the quickstart (they need a real asyncpg connection). Content only, never custody (N2).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from sparkpoint_agent import content_seed


def _write(path: Path, entries: list[Any]) -> None:
    path.write_text(json.dumps({"entries": entries}), encoding="utf-8")


def test_load_entries_parses_and_validates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    f = tmp_path / "whats-new.json"
    _write(
        f,
        [
            {"slug": "a", "tag": "New", "title": "Title A", "body": "Body A",
             "cta_label": "Go", "cta_href": "/x", "published_at": "2026-07-17"},
            {"slug": "b", "tag": "Bogus", "title": "Title B", "body": "Body B",
             "cta_href": "javascript:alert(1)"},
            {"slug": "", "title": "no slug", "body": "x"},   # dropped: no slug
            {"slug": "c", "title": "only title"},            # dropped: no body
            "not-a-dict",                                    # dropped: not an object
        ],
    )
    monkeypatch.setenv("SPARKPOINT_WHATS_NEW_PATH", str(f))
    out = content_seed.load_entries()

    assert [e["slug"] for e in out] == ["a", "b"]           # only the two valid entries survive
    assert out[0]["type_"] == "changelog"
    assert out[0]["tag"] == "New"
    assert out[0]["cta_href"] == "/x"
    assert out[1]["tag"] is None                            # unknown tag coerced to None
    assert out[1]["cta_href"] is None                       # javascript: scheme rejected


def test_load_entries_missing_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SPARKPOINT_WHATS_NEW_PATH", str(tmp_path / "nope.json"))
    assert content_seed.load_entries() == []


@pytest.mark.asyncio
async def test_seed_changelog_upserts_each_and_aggregates(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "whats-new.json"
    _write(f, [{"slug": "a", "tag": "New", "title": "A", "body": "ba"},
               {"slug": "b", "tag": "Fixed", "title": "B", "body": "bb"}])
    monkeypatch.setenv("SPARKPOINT_WHATS_NEW_PATH", str(f))

    class _Fake:
        def __init__(self) -> None:
            self.calls: list[str] = []

        async def upsert_seed(self, **kw: Any) -> str:
            self.calls.append(kw["slug"])
            return "inserted"

    store = _Fake()
    counts = await content_seed.seed_changelog(store)  # type: ignore[arg-type]
    assert store.calls == ["a", "b"]
    assert counts["inserted"] == 2


@pytest.mark.asyncio
async def test_seed_changelog_swallows_upsert_error(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    f = tmp_path / "whats-new.json"
    _write(f, [{"slug": "a", "title": "A", "body": "ba"}, {"slug": "b", "title": "B", "body": "bb"}])
    monkeypatch.setenv("SPARKPOINT_WHATS_NEW_PATH", str(f))

    class _Boom:
        async def upsert_seed(self, **kw: Any) -> str:
            if kw["slug"] == "a":
                raise RuntimeError("db down")
            return "inserted"

    counts = await content_seed.seed_changelog(_Boom())  # type: ignore[arg-type]
    assert counts["inserted"] == 1  # 'a' failed and was swallowed; 'b' succeeded
