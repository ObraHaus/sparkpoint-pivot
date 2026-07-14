"""Leaf wire primitives shared across layers (no intra-package imports).

Grounding: agent-service-api.md §2.6 (Citation). This module is a dependency LEAF — it
imports only the stdlib — so both the ``agents`` layer (which attaches provenance to a
recommendation) and the ``coordinator`` layer (which renders the ChatBlocks) can depend
on it WITHOUT creating a package cycle (agents must never import coordinator).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Citation:
    """§2.6 — one provenance record surfaced under a rec/answer.

    Closed wire shape: ``to_wire`` emits camelCase and OMITS the optional ``url`` when
    absent (never ``null``) so the frontend's strict-optional schema accepts it.
    """

    provider: str
    endpoint: str
    field: str
    value: str
    as_of: str
    stale: bool
    url: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "provider": self.provider,
            "endpoint": self.endpoint,
            "field": self.field,
            "value": self.value,
            "asOf": self.as_of,
            "stale": self.stale,
        }
        if self.url is not None:
            wire["url"] = self.url
        return wire
