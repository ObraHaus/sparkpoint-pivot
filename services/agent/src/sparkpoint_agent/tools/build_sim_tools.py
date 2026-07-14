"""The BUILD/SIM registry — the ONLY place calldata is ever built or simulated.

Grounding: research.md §6 (only executor / vault_manager may build) and
agent-service-api.md §3.5 (POST /build-tx: returns ONLY unsigned calldata +
simulation + verdict). This registry is attached ONLY to executor and vault_manager;
it is NEVER present in portfolio_reader's or strategy_recommender's registry. Even
here, ``build_unsigned_tx`` emits INERT calldata with ``signature`` ALWAYS null — the
service holds no key and no code path signs (N1, N3).
"""

from __future__ import annotations

from .registry import Capability, Tool, ToolRegistry

BUILD_UNSIGNED_TX = Tool(
    name="build_unsigned_tx",
    capability=Capability.BUILD_SIM,
    description="Build inert UNSIGNED calldata / UserOp — signature ALWAYS null (N1/N3).",
)
SIMULATE = Tool(
    name="simulate",
    capability=Capability.BUILD_SIM,
    description="Fresh pre-trade sim on the Anvil Base-fork (or eth_call dry-run); §8 step 6.",
)

BUILD_SIM_TOOLS: tuple[Tool, ...] = (BUILD_UNSIGNED_TX, SIMULATE)


def build_sim_registry() -> ToolRegistry:
    """The standalone BUILD/SIM registry (executor / vault_manager only)."""
    return ToolRegistry(name="build_sim", tools=BUILD_SIM_TOOLS)
