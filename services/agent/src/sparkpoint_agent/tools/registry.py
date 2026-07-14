"""Scoped tool-registry primitives — capability separation is PHYSICAL.

Grounding: research.md §6 (deterministic Coordinator + scoped per-agent tool
registries) and the non-custody rules. Capability is enforced by WHICH tools exist
in an agent's registry, NOT by prompting the model to behave. A read-only agent
(portfolio_reader) that never receives a ``BUILD_SIM`` tool has no in-registry path
to build or simulate — let alone sign — a transaction (belt-and-suspenders with the
deterministic policy layer; N1/N3). This module defines the primitives; the wiring
(agent → registry) lives in ``tools/__init__.py``.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any


class Capability(StrEnum):
    """The physical capability classes a tool can belong to.

    - ``READ``      : derive/read-only (positions, PnL, balances, data health). It can
                      move NO funds and build NO calldata.
    - ``BUILD_SIM`` : build inert UNSIGNED calldata + simulate. Attached ONLY to
                      executor / vault_manager (research.md §6). NEVER in a read agent.

    A future ``KNOWLEDGE`` capability (knowledge_search) would attach ONLY to
    strategy_recommender / literacy — never to portfolio_reader or the builders.
    """

    READ = "read"
    BUILD_SIM = "build_sim"


# A tool implementation. ``None`` in the scaffold — the concrete Anvil/RPC/build
# bindings are wired in later waves. The registry SHAPE + capability tag is what
# enforces separation NOW; a missing ``fn`` never grants a capability.
ToolFn = Callable[..., Any]


@dataclass(frozen=True)
class Tool:
    """A single, capability-tagged tool. Immutable so a registry cannot be mutated
    into holding a capability it was not wired with."""

    name: str
    capability: Capability
    description: str
    fn: ToolFn | None = None


@dataclass(frozen=True)
class ToolRegistry:
    """An agent's scoped, immutable toolset.

    The registry is the enforcement boundary: an agent can only ever call a tool that
    is IN its registry, and the registry only holds tools for the capabilities the
    agent was explicitly wired with (see ``tools.registry_for``).
    """

    name: str
    tools: tuple[Tool, ...]

    def names(self) -> frozenset[str]:
        """The set of tool names in this registry."""
        return frozenset(t.name for t in self.tools)

    def capabilities(self) -> frozenset[Capability]:
        """The set of capabilities present in this registry."""
        return frozenset(t.capability for t in self.tools)

    def has_capability(self, capability: Capability) -> bool:
        """True iff any tool of ``capability`` is present (the separation assertion)."""
        return any(t.capability is capability for t in self.tools)

    def get(self, name: str) -> Tool | None:
        """Look up a tool by name, or ``None`` if this agent may not call it."""
        for tool in self.tools:
            if tool.name == name:
                return tool
        return None
