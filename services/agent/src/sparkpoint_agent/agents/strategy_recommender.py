"""Strategy Recommender — judgment-heavy ranking agent.

Effort: HIGH (research.md §6 — the recommender is judgment-heavy). Scope: rank
whitelist-only strategies (Aave v3, Aerodrome) against the user's mandate and emit
advisory ``ProposedAction``s + rationale + citations (agent-service-api.md §3.4).
It produces advice, NOT signable artifacts: its registry holds READ tools only — no
build/sim tool. The (future) ``knowledge_search`` capability attaches ONLY here (and
literacy), never to portfolio_reader or the builders (research.md §6).
"""

from __future__ import annotations

from ..tools import Capability
from .base import AgentSpec, Effort

EFFORT = Effort.HIGH

SPEC = AgentSpec(
    name="strategy_recommender",
    effort=EFFORT,
    capabilities=frozenset({Capability.READ}),
    scope=(
        "Rank whitelist-only strategies vs. the mandate; emit advisory ProposedActions "
        "+ rationale + citations. No build/sim tool; recommendations become signable "
        "only via the /build-tx execution path."
    ),
)
