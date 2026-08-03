"""Repo-file changelog seed (feature 006).

The in-app changelog used to be admin-DB-only, so a shipped client entry lived nowhere a hook or CI
could see. This loads a committed ``content_seed/whats-new.json`` at boot (and via
``POST /admin/content/reingest``) and idempotently UPSERTs each entry by ``slug`` into
``content_entries`` — one repo edit feeds the in-app changelog, travels in the PR diff, and never
duplicates on redeploy. Fail-open; content only, never custody (N2).
"""

from __future__ import annotations

import json
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .db.content_entries import ContentEntryStore

logger = logging.getLogger(__name__)

_ALLOWED_TAGS = {"New", "Fixed", "Improved", "Announcement"}
#: Synonym → canonical. Authors reach for Keep-a-Changelog vocabulary ("Added"/"Changed") out of
#: habit; silently NULLING those (the old behavior) is how untagged entries kept reaching
#: /changelog.
#: Normalize instead — and default anything else to "Improved", the least-specific honest claim.
_TAG_SYNONYMS = {
    "new": "New",
    "added": "New",
    "add": "New",
    "fixed": "Fixed",
    "fix": "Fixed",
    "bugfix": "Fixed",
    "hotfix": "Fixed",
    "improved": "Improved",
    "improvement": "Improved",
    "changed": "Improved",
    "change": "Improved",
    "updated": "Improved",
    "update": "Improved",
    "announcement": "Announcement",
}


def _normalize_tag(raw: object, type_: str) -> str:
    """Every changelog entry gets a canonical tag — never None (the client hit untagged entries
    twice; a display chip that can silently vanish is a bug class, not an option)."""
    if isinstance(raw, str):
        canonical = _TAG_SYNONYMS.get(raw.strip().lower())
        if canonical:
            return canonical
    return "Announcement" if type_ == "announcement" else "Improved"


def whats_new_path() -> Path:
    """Resolve the committed seed file — /app/content_seed/whats-new.json in prod (Dockerfile COPY),
    services/agent/content_seed/whats-new.json in dev. Mirrors persona.default_persona_dir()."""
    override = os.getenv("SPARKPOINT_WHATS_NEW_PATH")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[2] / "content_seed" / "whats-new.json"


def _safe_href(value: Any) -> str | None:
    """Only internal paths or https — mirrors the ContentWrite.cta_href validator (no js:/data:)."""
    if not value:
        return None
    candidate = str(value).strip()
    if not (candidate.startswith("/") or candidate.startswith("https://")):
        return None
    return candidate[:400]


def load_entries() -> list[dict[str, Any]]:
    """Parse + validate the seed file into store.upsert_seed kwargs. Returns [] on any problem."""
    path = whats_new_path()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        logger.warning("whats_new_missing path=%s", path)
        return []
    except (ValueError, OSError):
        logger.warning("whats_new_unreadable path=%s", path)
        return []

    items = raw.get("entries") if isinstance(raw, dict) else raw
    if not isinstance(items, list):
        return []

    out: list[dict[str, Any]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        slug = str(item.get("slug") or "").strip()
        title = str(item.get("title") or "").strip()
        body = str(item.get("body") or "").strip()
        if not slug or not title or not body:
            continue
        type_ = "changelog" if item.get("type") != "announcement" else "announcement"
        out.append(
            {
                "slug": slug[:80],
                "type_": type_,
                "title": title[:200],
                "body": body[:4000],
                "tag": _normalize_tag(item.get("tag"), type_),
                "cta_label": (str(item["cta_label"])[:60] if item.get("cta_label") else None),
                "cta_href": _safe_href(item.get("cta_href")),
                "is_active": bool(item.get("active", True)),
                "published_at": (str(item["published_at"]) if item.get("published_at") else None),
            }
        )
    return out


def _warn_if_future_dated(entry: dict[str, Any]) -> None:
    """033 — a publish date in the future is nearly always a mistake, so say so.

    ``published_at`` exists so the timeline can be BACKdated and read honestly. Four entries
    shipped forward-dated instead, because the times were written as local wall-clock and stored
    as UTC — putting the newest releases hours ahead of the clock, and one of them on tomorrow's
    date for anyone reading in Asia/Manila. Nothing rejected it, because nothing looked.

    A warning, not a refusal: scheduling an entry ahead is a legitimate thing to want, and a seed
    load must never fail over a timestamp. This just makes the mistake visible in the boot log.
    """
    raw = entry.get("published_at")
    if not raw:
        return
    try:
        when = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return
    if when.tzinfo is None:
        when = when.replace(tzinfo=UTC)
    if when > datetime.now(UTC):
        logger.warning(
            "whats_new_future_dated slug=%s published_at=%s — this entry is dated AHEAD of the "
            "clock. If that was not deliberate, it was probably written as local time; the field "
            "is UTC.",
            entry.get("slug"),
            raw,
        )


async def seed_changelog(store: ContentEntryStore) -> dict[str, int]:
    """UPSERT every seed entry by slug. Returns counts {inserted, updated, adopted, skipped}."""
    counts = {"inserted": 0, "updated": 0, "adopted": 0, "skipped": 0}
    for entry in load_entries():
        _warn_if_future_dated(entry)
        try:
            result = await store.upsert_seed(**entry)
        except Exception:
            logger.warning("whats_new_upsert_failed slug=%s", entry.get("slug"))
            continue
        counts[result] = counts.get(result, 0) + 1
    logger.info("whats_new_seeded total=%d %s", sum(counts.values()), counts)
    return counts
