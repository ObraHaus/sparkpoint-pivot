"""Append-only audit store for admin LLM-gateway config changes (R3).

Every mutating admin-gateway call (add / remove a `sparkpoint-chat` deployment) records one row
here AFTER the LiteLLM management call succeeds — so the log reflects what actually changed. The
panel's Activity/Config tabs read it back. NO SECRETS (VR-A3): ``detail`` holds model names / ids
/ rpm only; the API scrubs key-shaped fields before calling ``record``. Access/config only — never
custody (N2). Mirrors :mod:`db.knowledge_notes` (0008).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .pool import Database

_INSERT_SQL = (
    "INSERT INTO gateway_audit (action, subject, actor, detail) VALUES ($1, $2, $3, $4::jsonb)"
)
_READ_SQL = (
    "SELECT action, subject, actor, detail, at FROM gateway_audit ORDER BY at DESC LIMIT $1"
)


@dataclass
class GatewayAuditStore:
    """asyncpg-backed append-only store for ``gateway_audit``."""

    db: Database

    async def record(
        self, action: str, subject: str, actor: str | None, detail: dict[str, Any] | None = None
    ) -> None:
        act = (actor or "").lower() or None
        await self.db.execute(
            _INSERT_SQL, action, subject, act, json.dumps(detail or {}, ensure_ascii=False)
        )

    async def recent(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = await self.db.fetch(_READ_SQL, max(1, min(limit, 500)))
        return [
            {
                "action": str(r["action"]),
                "subject": str(r["subject"]),
                "actor": (str(r["actor"]) if r["actor"] else None),
                "detail": _as_detail(r["detail"]),
                "at": r["at"].isoformat(),
            }
            for r in rows
        ]


def _as_detail(raw: Any) -> dict[str, Any]:
    """asyncpg may hand back JSONB as a dict or a JSON string — normalise to a dict either way."""
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if isinstance(raw, str) else {}
    except (ValueError, TypeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}
