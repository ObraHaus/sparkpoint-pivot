"""Typed agent spec — name, effort tier, declared capabilities, scoped registry.

Grounding: research.md §6 — five modular agents; per-agent ``output_config.effort``
(recommender ``high``, executor/vault ``medium``, portfolio ``low``); Claude
``claude-opus-4-8`` with adaptive thinking. An ``AgentSpec`` is a pure, immutable
description of an agent's boundary; the concrete Claude client + prompt are wired in
later waves. ``effort is None`` marks a DETERMINISTIC, LLM-free agent (the guardrail).
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from ..tools import Capability, ToolRegistry, registry_for

# research.md §6 — the mandated reasoning model + on-mode. The older fixed
# ``budget_tokens`` extended-thinking config is REMOVED on Opus 4.8 (would 400); use
# adaptive thinking so the model self-moderates depth. Recorded here as the single
# obvious config anchor; the SDK call is wired in a later wave.
CLAUDE_MODEL = "claude-opus-4-8"
THINKING = "adaptive"


class Effort(StrEnum):
    """Anthropic ``output_config.effort`` tier (research.md §6), tuned per agent."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


@dataclass(frozen=True)
class AgentSpec:
    """An agent's immutable boundary: identity, reasoning effort, and tool scope.

    ``effort is None`` ⇒ the agent is deterministic + LLM-free (the guardrail runs
    ``policy.evaluate``, never a model). ``capabilities`` is the wiring that decides
    which tools the agent can ever hold (physical capability separation).
    """

    name: str
    effort: Effort | None
    capabilities: frozenset[Capability]
    scope: str

    def registry(self) -> ToolRegistry:
        """This agent's scoped tool registry — derived from its declared capabilities."""
        return registry_for(self.name, self.capabilities)

    @property
    def is_llm_agent(self) -> bool:
        """True for Claude-backed agents; False for the deterministic guardrail."""
        return self.effort is not None
