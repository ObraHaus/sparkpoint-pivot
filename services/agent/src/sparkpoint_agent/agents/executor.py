"""Executor — builds inert UNSIGNED calldata for protocol actions.

Effort: MEDIUM (research.md §6 — executor/vault ``medium``). Scope: for allowlisted
Aave v3 / Aerodrome actions (and account-level session-key grant/revoke), build
inert UNSIGNED calldata and run a fresh simulation. It holds the BUILD/SIM tools —
but every artifact it builds passes through the guardrail (policy.evaluate) in the
MANUAL agentic loop BEFORE it can become signable, and ``signature`` is ALWAYS null
(N1, N3). The service holds no key and no code path signs.
"""

from __future__ import annotations

from ..tools import Capability
from .base import AgentSpec, Effort

EFFORT = Effort.MEDIUM

SPEC = AgentSpec(
    name="executor",
    effort=EFFORT,
    capabilities=frozenset({Capability.READ, Capability.BUILD_SIM}),
    scope=(
        "Build UNSIGNED calldata + simulate for allowlisted Aave/Aerodrome + session-key "
        "ops. Every artifact is policy-gated before signable; signature always null."
    ),
)
