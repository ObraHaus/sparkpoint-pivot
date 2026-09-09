"""Scoped tool registries — physical capability separation (research.md §6).

The catalog is keyed by ``Capability``; ``registry_for`` builds an agent's registry
from ONLY the capabilities it was explicitly wired with. An agent that does not
declare ``BUILD_SIM`` can never receive ``build_unsigned_tx`` / ``simulate`` — the
separation is structural, not prompt-based (belt-and-suspenders with the policy
layer; N1/N3). ``tests/agents/test_capability_separation.py`` asserts the invariant.
"""

from __future__ import annotations

from .build_sim_tools import BUILD_SIM_TOOLS, build_sim_registry
from .read_tools import READ_TOOLS, read_registry
from .registry import Capability, Tool, ToolFn, ToolRegistry

# The ONLY source of tools. A capability absent from an agent's wiring cannot leak in
# because ``registry_for`` reads exclusively from this catalog by declared capability.
_CATALOG: dict[Capability, tuple[Tool, ...]] = {
    Capability.READ: READ_TOOLS,
    Capability.BUILD_SIM: BUILD_SIM_TOOLS,
}


def registry_for(agent_name: str, capabilities: frozenset[Capability]) -> ToolRegistry:
    """Build ``agent_name``'s scoped registry from its declared capabilities ONLY.

    Iterating ``Capability`` (declaration order) rather than the passed set keeps tool
    order deterministic across runs (research.md §6 caching note) and guarantees a
    non-declared capability contributes no tools.
    """
    tools: tuple[Tool, ...] = tuple(
        tool
        for capability in Capability
        if capability in capabilities
        for tool in _CATALOG[capability]
    )
    return ToolRegistry(name=agent_name, tools=tools)


__all__ = [
    "BUILD_SIM_TOOLS",
    "READ_TOOLS",
    "Capability",
    "Tool",
    "ToolFn",
    "ToolRegistry",
    "build_sim_registry",
    "read_registry",
    "registry_for",
]
