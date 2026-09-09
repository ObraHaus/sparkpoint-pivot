"""Portfolio Reader — mechanical read/derive agent.

Effort: LOW (research.md §6 — the portfolio reader is mechanical). Scope: read the
user's enriched positions, PnL, fresh on-chain balances, and data-source health
(agent-service-api.md §3.3). It PROPOSES nothing signable and CANNOT build or
simulate a transaction: its registry holds READ tools only. No build/sim tool is
reachable from this agent — capability separation is physical (research.md §6; N1/N3).
"""

from __future__ import annotations

from ..tools import Capability
from .base import AgentSpec, Effort

EFFORT = Effort.LOW

SPEC = AgentSpec(
    name="portfolio_reader",
    effort=EFFORT,
    capabilities=frozenset({Capability.READ}),
    scope=(
        "Read/derive the user's portfolio (positions, PnL, balances, data health). "
        "Proposes nothing; holds NO build/sim tool (physical capability separation)."
    ),
)
