# ruff: noqa: S101
"""034 — every default is the cautious one, and that is load-bearing.

This feature adds a writer to a product whose entire trust proposition is that the assistant
proposes and a deterministic policy disposes. On a fresh install, a failed settings read, or a
database that has not had migration 0035 applied, the answer must be "it does nothing".
"""

from __future__ import annotations

import pytest

from sparkpoint_agent.selfauthor.settings import (
    DEFAULTS,
    MAX_DRAFT_WINDOW_HOURS,
    MODE_AUTOMATIC,
    SelfAuthorSettings,
    from_row,
    merge_patch,
    to_wire,
)


def test_the_defaults_do_nothing() -> None:
    # Ships disabled: the first run happens because someone chose it.
    assert DEFAULTS.enabled is False
    assert DEFAULTS.publish_mode == "manual"
    assert DEFAULTS.draft_window_hours == 336, "two weeks, the client's number"
    assert DEFAULTS.allowed_data_sources == ()
    assert DEFAULTS.allowed_prose_domains == ()
    assert DEFAULTS.fetches_prose is False


def test_an_unreadable_row_yields_the_cautious_defaults_not_an_error() -> None:
    """A missing table, a row from before a column existed, a None: all of them must mean "off",
    never "whatever the code was compiled with"."""
    assert from_row(None) == DEFAULTS
    assert from_row({}) == DEFAULTS
    assert from_row({"enabled": None, "publish_mode": None}) == DEFAULTS


def test_a_malformed_stored_domain_is_treated_as_NO_permission() -> None:
    """Fail closed. A domain we cannot parse is not a domain we may fetch from."""
    settings = from_row({"enabled": True, "allowed_prose_domains": ["https://docs.aave.com/v3"]})
    assert settings.allowed_prose_domains == ()
    assert settings.fetches_prose is False


def test_a_stored_mode_or_window_we_do_not_understand_falls_back_safely() -> None:
    settings = from_row({"publish_mode": "yolo", "draft_window_hours": -5})
    assert settings.publish_mode == "manual"
    assert settings.draft_window_hours == 336


def test_an_unknown_stored_data_source_is_dropped_rather_than_trusted() -> None:
    settings = from_row({"allowed_data_sources": ["chain", "wikipedia"]})
    assert settings.allowed_data_sources == ("chain",)


# ── patching ─────────────────────────────────────────────────────────────────


def test_a_partial_patch_leaves_everything_else_alone() -> None:
    """The console sends one field at a time. A PUT that reset the unmentioned fields would silently
    disable the feature every time somebody adjusted the draft window."""
    current = SelfAuthorSettings(
        enabled=True, publish_mode=MODE_AUTOMATIC, draft_window_hours=24,
        allowed_data_sources=("chain",), allowed_prose_domains=("docs.aave.com",),
    )
    patched = merge_patch(current, {"draft_window_hours": 0})
    assert patched.draft_window_hours == 0
    assert patched.enabled is True
    assert patched.allowed_prose_domains == ("docs.aave.com",)
    assert patched.allowed_data_sources == ("chain",)


def test_the_domain_list_is_normalised_on_the_way_in() -> None:
    patched = merge_patch(DEFAULTS, {"allowed_prose_domains": ["DOCS.Aave.com ", "defillama.com"]})
    assert patched.allowed_prose_domains == ("defillama.com", "docs.aave.com")


def test_a_bad_domain_is_rejected_BY_NAME() -> None:
    with pytest.raises(ValueError, match="docs.aave.com/v3"):
        merge_patch(DEFAULTS, {"allowed_prose_domains": ["docs.aave.com/v3"]})


@pytest.mark.parametrize("bad", [-1, MAX_DRAFT_WINDOW_HOURS + 1, "soon", None])
def test_an_impossible_draft_window_is_rejected(bad: object) -> None:
    with pytest.raises(ValueError):
        merge_patch(DEFAULTS, {"draft_window_hours": bad})


def test_an_unknown_publish_mode_is_rejected() -> None:
    with pytest.raises(ValueError, match="publish_mode"):
        merge_patch(DEFAULTS, {"publish_mode": "eventually"})


def test_an_unknown_data_source_is_rejected_by_name() -> None:
    with pytest.raises(ValueError, match="wikipedia"):
        merge_patch(DEFAULTS, {"allowed_data_sources": ["chain", "wikipedia"]})


def test_prose_is_not_selectable_as_a_data_source() -> None:
    """Prose is governed by the DOMAIN list. Offering it in both places would let one list silently
    contradict the other."""
    with pytest.raises(ValueError, match="prose"):
        merge_patch(DEFAULTS, {"allowed_data_sources": ["prose"]})


def test_the_wire_shape_is_camelCase_for_the_console() -> None:
    wire = to_wire(SelfAuthorSettings(enabled=True, allowed_prose_domains=("docs.aave.com",)))
    assert wire == {
        "enabled": True, "publishMode": "manual", "draftWindowHours": 336,
        "allowedDataSources": [], "allowedProseDomains": ["docs.aave.com"],
    }
