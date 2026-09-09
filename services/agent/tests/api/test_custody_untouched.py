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


def test_subscription_verify_is_present_but_never_metered_or_custody() -> None:
    """Feature 012: the SRK-purchase verify endpoint is neither metered nor a funds path."""
    all_paths = {r.path for r in _iter_api_routes(app.routes)}
    assert "/subscription/verify" in all_paths  # it exists
    assert "/subscription/verify" not in _quota_paths()  # NOT metered (N2)


# ─────────────────────────────────────────────────────────────────────────────
# 023 T006 (FR-023-004) — the chain-identity gate must cover the chain-dependent
# surface and NOTHING else. Same shape as the quota guard above: a gate that
# reached the exit path, or an advisory read that could be silenced by it, is a
# blocking defect.
# ─────────────────────────────────────────────────────────────────────────────


def _chain_gated_paths() -> set[str]:
    """Paths whose route-level dependencies include ``require_verified_chain``."""
    paths: set[str] = set()
    for route in _iter_api_routes(app.routes):
        for dep in getattr(route, "dependencies", []):
            call = getattr(dep, "dependency", None)
            if call is not None and "require_verified_chain" in getattr(call, "__qualname__", ""):
                paths.add(route.path)
    return paths


def test_chain_gate_covers_exactly_the_chain_dependent_surface() -> None:
    """The gate is on every surface whose answer depends on chain state — and only those.

    An ungated chain-dependent route could still serve values read off the wrong chain, which is
    the whole defect 023 closes; an over-gated route would let a chain blip silence something that
    is supposed to degrade honestly instead.
    """
    assert _chain_gated_paths() == {
        # §3.7 vault quotes + the 018 pre-sign dry-run
        "/vault/quote/deposit",
        "/vault/quote/withdraw",
        "/vault/simulate/deposit",
        "/vault/simulate/withdraw",
        # §3.3 portfolio + the US5 outcomes ledger
        "/portfolio",
        "/portfolio/positions/{position_id}",
        "/outcomes",
        "/outcomes/{rec_id}",
        # §3.5/§3.6 the execution spine
        "/build-tx",
        "/simulate",
        "/submit-signed-tx",
        "/submit-signed-tx/{intent_id}",
        # §3.9 session-key grant / revoke / list (US6)
        "/session-keys",
        "/session-keys/grant/build",
        "/session-keys/revoke/build",
    }


def test_chain_gate_never_touches_probes_chat_or_admin() -> None:
    """N2 + honest degradation: the gate must not reach liveness, the assistant, or the consoles.

    ``/healthz`` and ``/readyz`` must answer so an orchestrator can still see the process; chat and
    the advisory reads must degrade rather than 503; and the operator consoles must stay reachable
    precisely so a mismatch can be diagnosed and fixed.
    """
    gated = _chain_gated_paths()
    must_not_be_gated = {
        "/healthz",
        "/readyz",
        "/chat",
        "/chat/feedback",
        "/recommendations",
        "/onboarding/turn",
        "/mandate",
        "/allowlist/status",
        "/conversations",
        "/content/changelog",
        "/tips",
        "/notifications",
        "/subscription/verify",
        "/usage/self",
    }
    assert gated & must_not_be_gated == set()
    assert not any(path.startswith("/admin/") for path in gated)


def test_chain_gate_is_not_on_any_exit_shaped_route() -> None:
    """FR-023-004 — the sacred exit is never gated by this service.

    ``/exit`` is a FRONTEND direct-RPC path that imports no agent client, so it should not appear
    here at all; ``revoke`` is the on-chain session kill-switch, whose BUILD is deliberately gated
    (it needs the right chain's account address to encode) while the authoritative revoke remains
    client-buildable and broadcastable with this service offline. This test pins the first fact and
    documents the second.
    """
    all_paths = {r.path for r in _iter_api_routes(app.routes)}
    assert "/exit" not in all_paths  # the exit hatch never routes through the agent (N2)
    assert not any("trust" in path for path in _chain_gated_paths())
