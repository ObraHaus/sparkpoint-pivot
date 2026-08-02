# ruff: noqa: S101
"""The committed in-app changelog seed must be SHIPPABLE AS-IS — CI-enforced shape.

The client has twice found /changelog entries missing their New/Fixed/Improved chip. Both times
the cause was the same: an author used off-vocabulary tags ("Added", "Changed" — Keep-a-Changelog
habit) and the loader silently nulled them. The loader now normalizes synonyms as a runtime
safety net, but the FILE itself must stay canonical — this test makes an off-vocabulary or
missing tag a CI failure with a message that names the entry, so the bug class cannot ship again.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from sparkpoint_agent.content_seed import _normalize_tag, load_entries

_SEED = Path(__file__).resolve().parents[1] / "content_seed" / "whats-new.json"
_CANONICAL_TAGS = {"New", "Fixed", "Improved", "Announcement"}


def _raw_entries() -> list[dict]:
    data = json.loads(_SEED.read_text(encoding="utf-8"))
    entries = data.get("entries")
    assert isinstance(entries, list) and entries, "whats-new.json must carry entries"
    return entries


def test_every_entry_carries_a_canonical_tag_exactly() -> None:
    for e in _raw_entries():
        tag = e.get("tag")
        assert tag in _CANONICAL_TAGS, (
            f"whats-new entry '{e.get('slug')}' has tag {tag!r} — must be one of "
            f"{sorted(_CANONICAL_TAGS)} EXACTLY (no 'Added'/'Changed'; the /changelog chip "
            "vocabulary is New/Fixed/Improved/Announcement)"
        )


def test_every_entry_has_the_required_fields() -> None:
    for e in _raw_entries():
        slug = e.get("slug")
        assert isinstance(slug, str) and slug.strip(), f"entry missing slug: {e.get('title')!r}"
        assert isinstance(e.get("title"), str) and e["title"].strip(), f"'{slug}' missing title"
        assert isinstance(e.get("body"), str) and e["body"].strip(), f"'{slug}' missing body"
        published = e.get("published_at")
        assert isinstance(published, str), f"'{slug}' missing published_at"
        datetime.fromisoformat(published.replace("Z", "+00:00"))  # must parse
        # ``active`` is optional (the loader defaults it to True); when present it must be bool.
        if "active" in e:
            assert isinstance(e["active"], bool), f"'{slug}' active must be a bool"


def test_slugs_are_unique() -> None:
    slugs = [e.get("slug") for e in _raw_entries()]
    dupes = {s for s in slugs if slugs.count(s) > 1}
    assert not dupes, f"duplicate whats-new slugs: {sorted(dupes)}"


def test_the_loader_never_emits_a_null_tag_for_any_entry() -> None:
    # The runtime safety net: even a hypothetically-bad file yields tagged entries.
    for entry in load_entries():
        assert entry["tag"] in _CANONICAL_TAGS, entry["slug"]


def test_the_normalizer_maps_the_synonyms_that_burned_us() -> None:
    assert _normalize_tag("Added", "changelog") == "New"
    assert _normalize_tag("Changed", "changelog") == "Improved"
    assert _normalize_tag("fixed", "changelog") == "Fixed"
    assert _normalize_tag(None, "changelog") == "Improved"
    assert _normalize_tag("mystery", "changelog") == "Improved"
    assert _normalize_tag(None, "announcement") == "Announcement"
