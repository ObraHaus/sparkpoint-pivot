"""The READ registry — derive/read-only tools (the ENTIRE portfolio_reader toolset).

Grounding: research.md §6 (portfolio reader is mechanical, effort ``low``) and
agent-service-api.md §3.3 (GET /portfolio). None of these tools can move funds or
build calldata — they read/derive only. They form portfolio_reader's whole registry
and are ALSO available (as context) to the recommender and the builders; the
capability that matters for non-custody is the one they do NOT have (BUILD_SIM).
"""

from __future__ import annotations

from .registry import Capability, Tool, ToolRegistry

GET_POSITIONS = Tool(
    name="get_positions",
    capability=Capability.READ,
    description="Enriched/derived positions for the user's account (agent-service-api.md §3.3).",
)
GET_PNL = Tool(
    name="get_pnl",
    capability=Capability.READ,
    description="Realized/unrealized PnL series per position/recommendation (FR-039).",
)
READ_ONCHAIN_BALANCES = Tool(
    name="read_onchain_balances",
    capability=Capability.READ,
    description="Fresh on-chain balances via RPC — never cached at decision time (§5 authority).",
)
GET_DATA_HEALTH = Tool(
    name="get_data_health",
    capability=Capability.READ,
    description="Data-source staleness/health; drives the fail-closed DATA_STALE branch (§8 6b).",
)

READ_TOOLS: tuple[Tool, ...] = (
    GET_POSITIONS,
    GET_PNL,
    READ_ONCHAIN_BALANCES,
    GET_DATA_HEALTH,
)


def read_registry() -> ToolRegistry:
    """The standalone READ registry (portfolio_reader's complete toolset)."""
    return ToolRegistry(name="read", tools=READ_TOOLS)
