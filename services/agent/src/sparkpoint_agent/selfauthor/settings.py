"""034 — the settings an admin edits, and the defaults that make a misconfiguration harmless.

PURE. Validation and merging only; the store persists them.

EVERY DEFAULT HERE IS THE CAUTIOUS ONE, and that is deliberate rather than timid. This feature adds
a writer to a product whose entire trust proposition is that the assistant proposes and a
deterministic policy disposes. On a fresh install, a failed settings read, or a database that has
not yet had migration 0035 applied, the answer must be "it does nothing" — not "it does
whatever the code was compiled with".

So: **disabled**, **manual publishing**, a **two-week draft window**, and an **empty prose
allowlist**. The first run happens because someone chose it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from typing import Any

from .allowlist import normalise_domains
from .evidence import KNOWN_SOURCES, SOURCE_PROSE

MODE_MANUAL = "manual"
MODE_AUTOMATIC = "automatic"
MODES: frozenset[str] = frozenset({MODE_MANUAL, MODE_AUTOMATIC})

#: Two weeks — the client's number. A SETTING rather than a constant so it can be shortened once the
#: output is trusted, without a redeploy.
DEFAULT_DRAFT_WINDOW_HOURS = 336
MAX_DRAFT_WINDOW_HOURS = 8760  # a year; beyond that "draft" is a euphemism for "off"

#: `prose` is not selectable as a data source: prose is governed by the DOMAIN list, and offering it
#: in both places would let one list silently contradict the other.
SELECTABLE_SOURCES: frozenset[str] = KNOWN_SOURCES - {SOURCE_PROSE}


@dataclass(frozen=True)
class SelfAuthorSettings:
    enabled: bool = False
    publish_mode: str = MODE_MANUAL
    draft_window_hours: int = DEFAULT_DRAFT_WINDOW_HOURS
    allowed_data_sources: tuple[str, ...] = ()
    allowed_prose_domains: tuple[str, ...] = ()

    @property
    def fetches_prose(self) -> bool:
        """An empty domain list means NO prose is fetched — never that any source is permitted."""
        return bool(self.allowed_prose_domains)

    def allows(self, source: str) -> bool:
        return source in self.allowed_data_sources


DEFAULTS = SelfAuthorSettings()


def _as_bool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    raise ValueError(f"{field} must be true or false")


def _as_mode(value: Any) -> str:
    mode = str(value).strip().lower()
    if mode not in MODES:
        raise ValueError(f"publish_mode must be one of {sorted(MODES)}")
    return mode


def _as_window(value: Any) -> int:
    try:
        hours = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("draft_window_hours must be a whole number of hours") from exc
    if not 0 <= hours <= MAX_DRAFT_WINDOW_HOURS:
        raise ValueError(f"draft_window_hours must be between 0 and {MAX_DRAFT_WINDOW_HOURS}")
    return hours


def _as_sources(value: Any) -> tuple[str, ...]:
    if not isinstance(value, (list, tuple)):
        raise ValueError("allowed_data_sources must be a list")
    chosen: set[str] = set()
    for item in value:
        name = str(item).strip().lower()
        if name not in SELECTABLE_SOURCES:
            raise ValueError(f"{item!r}: not a known data source ({sorted(SELECTABLE_SOURCES)})")
        chosen.add(name)
    return tuple(sorted(chosen))


def merge_patch(current: SelfAuthorSettings, patch: dict[str, Any]) -> SelfAuthorSettings:
    """Apply a partial update.

    Absent keys are unchanged — the console sends one field at a time, and a PUT that reset the
    unmentioned fields to their defaults would silently disable the feature every time somebody
    adjusted the draft window.

    Every validation error names the offending value, because an admin who typed
    ``https://docs.aave.com/v3`` into the domain list needs to know it was rejected rather than
    quietly stored as something else.
    """
    updated = current
    if "enabled" in patch:
        updated = replace(updated, enabled=_as_bool(patch["enabled"], "enabled"))
    if "publish_mode" in patch:
        updated = replace(updated, publish_mode=_as_mode(patch["publish_mode"]))
    if "draft_window_hours" in patch:
        updated = replace(updated, draft_window_hours=_as_window(patch["draft_window_hours"]))
    if "allowed_data_sources" in patch:
        updated = replace(updated, allowed_data_sources=_as_sources(patch["allowed_data_sources"]))
    if "allowed_prose_domains" in patch:
        updated = replace(
            updated, allowed_prose_domains=tuple(normalise_domains(patch["allowed_prose_domains"]))
        )
    return updated


def from_row(row: Any) -> SelfAuthorSettings:
    """Build settings from a database row, falling back to the cautious defaults field by field.

    Per-field fallback rather than all-or-nothing: a row written before a column existed should
    still yield working settings for the columns it does have, and the missing one gets the safe
    default rather than taking the whole feature down.
    """
    if row is None:
        return DEFAULTS

    def get(key: str, fallback: Any) -> Any:
        try:
            value = row[key]
        except (KeyError, TypeError, IndexError):
            return fallback
        return fallback if value is None else value

    try:
        mode = _as_mode(get("publish_mode", DEFAULTS.publish_mode))
    except ValueError:
        mode = DEFAULTS.publish_mode
    try:
        window = _as_window(get("draft_window_hours", DEFAULTS.draft_window_hours))
    except ValueError:
        window = DEFAULTS.draft_window_hours

    sources = tuple(
        sorted(
            str(s)
            for s in (get("allowed_data_sources", []) or [])
            if str(s) in SELECTABLE_SOURCES
        )
    )
    try:
        domains = tuple(normalise_domains(list(get("allowed_prose_domains", []) or [])))
    except ValueError:
        # A malformed stored domain must not be treated as permission. Fail closed.
        domains = ()

    return SelfAuthorSettings(
        enabled=bool(get("enabled", False)),
        publish_mode=mode,
        draft_window_hours=window,
        allowed_data_sources=sources,
        allowed_prose_domains=domains,
    )


def to_wire(settings: SelfAuthorSettings) -> dict[str, Any]:
    return {
        "enabled": settings.enabled,
        "publishMode": settings.publish_mode,
        "draftWindowHours": settings.draft_window_hours,
        "allowedDataSources": list(settings.allowed_data_sources),
        "allowedProseDomains": list(settings.allowed_prose_domains),
    }
