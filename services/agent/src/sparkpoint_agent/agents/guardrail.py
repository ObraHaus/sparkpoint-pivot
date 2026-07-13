"""Guardrail — the deterministic, LLM-FREE policy gate (a thin wrapper over evaluate).

This is NOT a Claude agent: ``effort`` is ``None`` and its registry holds NO tools.
It runs the ordered, fail-closed §8 step machine (``policy.evaluate``) and returns a
``PolicyVerdict``; a rejected verdict carries ``normalized_action = None`` — NO
signable artifact is ever produced for an out-of-policy action. The policy layer is
PURE (policy-schema.md §0 rule 6): it imports no llm/knowledge/memory and does no
network I/O at decision time. The Coordinator interposes ``check`` BETWEEN "model
proposed" and "signable" in the execution agentic loop (agentic_loop.py).
"""

from __future__ import annotations

from ..policy import (
    Action,
    AuditSink,
    PolicyContext,
    PolicyVerdict,
    evaluate,
    evaluate_and_audit,
)
from ..tools import Capability
from .base import AgentSpec

# LLM-free: the guardrail declares no effort and no capabilities/tools.
EFFORT = None

SPEC = AgentSpec(
    name="guardrail",
    effort=EFFORT,
    capabilities=frozenset[Capability](),
    scope=(
        "Deterministic, LLM-free policy gate (policy.evaluate). Holds no tools; "
        "interposed between a proposed action and a signable artifact. A rejected "
        "verdict yields NO signable artifact (non-custody)."
    ),
)


def check(action: Action, ctx: PolicyContext) -> PolicyVerdict:
    """Run the pure, fail-closed policy machine and return the verdict.

    Thin, intentional pass-through to ``policy.evaluate`` so the interposition point
    in the execution loop reads as a single, obvious call. Deterministic and
    side-effect-free; auditing is a separate side-channel (see ``check_and_audit``).
    """
    return evaluate(action, ctx)


def check_and_audit(action: Action, ctx: PolicyContext, sink: AuditSink) -> PolicyVerdict:
    """Run ``check`` and append the append-only audit row via ``sink`` (side-channel).

    The decision is still made by the pure ``evaluate()``; the audit write is layered
    on top so the purity boundary (policy-schema.md §0 rule 6) is preserved (VR-A2).
    """
    return evaluate_and_audit(action, ctx, sink)
