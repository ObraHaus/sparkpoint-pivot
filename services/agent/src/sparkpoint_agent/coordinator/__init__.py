"""The deterministic Coordinator + fixed per-flow DAGs + the manual execution loop.

research.md §6: a deterministic Python Coordinator (NOT an LLM router) invokes the
five agents in a fixed per-flow order. Read flows may use the SDK auto tool-runner;
the state-changing path uses the MANUAL agentic loop so the guardrail
(``policy.evaluate``) is interposed between a proposed action and a signable artifact.
"""

from __future__ import annotations

from .agentic_loop import (
    Builder,
    ContextAssembler,
    ExecutionOutcome,
    PolicyGate,
    Simulator,
    UnsignedArtifact,
    UnsignedStep,
    execute,
)
from .coordinator import AgentRunner, Coordinator, FlowState
from .flows import (
    BUILDER_FOR_ACTION,
    READ_FLOWS,
    Flow,
    FlowKind,
    Step,
    execution_flow_for,
)

__all__ = [
    "BUILDER_FOR_ACTION",
    "READ_FLOWS",
    "AgentRunner",
    "Builder",
    "ContextAssembler",
    "Coordinator",
    "ExecutionOutcome",
    "Flow",
    "FlowKind",
    "FlowState",
    "PolicyGate",
    "Simulator",
    "Step",
    "UnsignedArtifact",
    "UnsignedStep",
    "execute",
    "execution_flow_for",
]
