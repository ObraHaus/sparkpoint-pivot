"""The five modular agents (research.md §6).

Four Claude-backed agents (portfolio_reader ``low``, strategy_recommender ``high``,
executor / vault_manager ``medium``) plus the deterministic, LLM-free ``guardrail``
(a thin wrapper over ``policy.evaluate``). Each module exposes an immutable
``SPEC: AgentSpec`` declaring its effort tier + physically-scoped tool registry.
Capability separation is structural: only the builders (executor/vault_manager) hold
the BUILD/SIM tools; the read agents and the guardrail cannot build or simulate.
"""

from __future__ import annotations

from . import (
    executor,
    guardrail,
    portfolio_reader,
    strategy_recommender,
    vault_manager,
)
from .base import CLAUDE_MODEL, THINKING, AgentSpec, Effort

# Name → spec. The deterministic Coordinator (coordinator.py) invokes agents by name
# in a fixed per-flow order — this map is the lookup, NOT a router (research.md §6).
AGENTS: dict[str, AgentSpec] = {
    portfolio_reader.SPEC.name: portfolio_reader.SPEC,
    strategy_recommender.SPEC.name: strategy_recommender.SPEC,
    executor.SPEC.name: executor.SPEC,
    vault_manager.SPEC.name: vault_manager.SPEC,
    guardrail.SPEC.name: guardrail.SPEC,
}

__all__ = [
    "AGENTS",
    "CLAUDE_MODEL",
    "THINKING",
    "AgentSpec",
    "Effort",
    "executor",
    "guardrail",
    "portfolio_reader",
    "strategy_recommender",
    "vault_manager",
]
