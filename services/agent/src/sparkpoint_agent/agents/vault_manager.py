"""Vault Manager — builds inert UNSIGNED calldata for the ERC-4626 vault.

Effort: MEDIUM (research.md §6 — executor/vault ``medium``). Scope: build inert
UNSIGNED calldata and fresh simulations for the SparkPoint Aave Yield Vault
(deposit / withdraw / redeem, ERC-4626-accurate) and session-key rebalances bounded
by the on-chain PolicyModule. Like the executor it holds the BUILD/SIM tools, but
every artifact passes the guardrail (policy.evaluate) in the MANUAL loop before it is
signable, ``signature`` is ALWAYS null, and the fund recipient is forced to the
user's own account/owner (N1, N3). Withdraw/redeem are never cap-/pause-gated (N2).
"""

from __future__ import annotations

from ..tools import Capability
from .base import AgentSpec, Effort

EFFORT = Effort.MEDIUM

SPEC = AgentSpec(
    name="vault_manager",
    effort=EFFORT,
    capabilities=frozenset({Capability.READ, Capability.BUILD_SIM}),
    scope=(
        "Build UNSIGNED calldata + simulate for the ERC-4626 vault (deposit/withdraw/"
        "redeem) + policy-bounded session rebalances. Policy-gated before signable; "
        "recipient pinned to the user; withdraw never cap-/pause-gated (N2)."
    ),
)
