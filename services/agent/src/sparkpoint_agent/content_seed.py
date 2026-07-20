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
from pathlib import Path
from typing import Any

from .db.content_entries import ContentEntryStore

logger = logging.getLogger(__name__)

_ALLOWED_TAGS = {"New", "Fixed", "Improved", "Announcement"}


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
        tag = item.get("tag")
        out.append(
            {
                "slug": slug[:80],
                "type_": "changelog" if item.get("type") != "announcement" else "announcement",
                "title": title[:200],
                "body": body[:4000],
                "tag": tag if tag in _ALLOWED_TAGS else None,
                "cta_label": (str(item["cta_label"])[:60] if item.get("cta_label") else None),
                "cta_href": _safe_href(item.get("cta_href")),
                "is_active": bool(item.get("active", True)),
                "published_at": (str(item["published_at"]) if item.get("published_at") else None),
            }
        )
    return out


async def seed_changelog(store: ContentEntryStore) -> dict[str, int]:
    """UPSERT every seed entry by slug. Returns counts {inserted, updated, adopted, skipped}."""
    counts = {"inserted": 0, "updated": 0, "adopted": 0, "skipped": 0}
    for entry in load_entries():
        try:
            result = await store.upsert_seed(**entry)
        except Exception:
            logger.warning("whats_new_upsert_failed slug=%s", entry.get("slug"))
            continue
        counts[result] = counts.get(result, 0) + 1
    logger.info("whats_new_seeded total=%d %s", sum(counts.values()), counts)
    return counts
