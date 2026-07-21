# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Constitution N2 guard (feature 008, US1): a compute limit must NEVER sit on a funds path.

These tests introspect the live FastAPI app and assert that ``require_within_quota`` is attached
to EXACTLY the three advisory-compute endpoints (chat / recommendations / onboarding) and to NO
vault / withdraw / exit / trust / build-tx / portfolio route. A throttle that could block a
withdrawal is a blocking defect (Constitution I, N2).
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

from fastapi.routing import APIRoute

from sparkpoint_agent.api.main import app


def _iter_api_routes(routes: Any) -> Iterator[APIRoute]:
    """Yield every APIRoute, descending into the app's custom ``_IncludedRouter`` wrappers."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield route
        original = getattr(route, "original_router", None)
        if original is not None and getattr(original, "routes", None):
            yield from _iter_api_routes(original.routes)


def _quota_paths() -> set[str]:
    """Paths whose route-level dependencies include ``require_within_quota``."""
    paths: set[str] = set()
    for route in _iter_api_routes(app.routes):
        for dep in getattr(route, "dependencies", []):
            call = getattr(dep, "dependency", None)
            if call is not None and "require_within_quota" in getattr(call, "__qualname__", ""):
                paths.add(route.path)
    return paths


def test_quota_is_only_on_the_three_llm_endpoints() -> None:
    assert _quota_paths() == {"/chat", "/recommendations", "/onboarding/turn"}


def test_no_funds_path_route_is_metered() -> None:
    metered = _quota_paths()
    forbidden = ("vault", "exit", "withdraw", "redeem", "trust", "build-tx", "portfolio")
    offenders = sorted(p for p in metered if any(marker in p for marker in forbidden))
    assert offenders == []  # N2: no compute limit on any funds/custody path
