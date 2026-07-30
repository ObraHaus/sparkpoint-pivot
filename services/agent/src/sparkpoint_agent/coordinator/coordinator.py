"""⚠️  SUPERSEDED — NOT EXECUTED (023, FR-023-016).

Nothing imports or calls this module. The execution interposition that actually RUNS is
``execution/orchestrate.py`` (feature 019) — an independent implementation of the same
ordering: decode → build → simulate → assemble → PURE ``policy.evaluate`` → gate → persist.

RETAINED deliberately (023 clarify decision) rather than deleted, because it holds the only
code-form record of
the deterministic-Coordinator design intent and its ``FlowState`` threading.

Read it as design documentation, NOT as a live guarantee: a Gate-C auditor reading a module
that presents itself as "the" policy interposition must not be misled about which one is
load-bearing. ``tests/coordinator/test_superseded_markers.py`` fails if this marker is dropped,
or if any module outside ``coordinator/`` starts importing these symbols — so the claim cannot
quietly rot.

The original module documentation follows.

----

The deterministic Coordinator — a Python DAG runner, NOT an LLM router.

Grounding: research.md §6 — the Coordinator is a deterministic Python DAG; the model
has NO tool to choose the next agent. ``run_read`` walks a flow's fixed, ordered
steps and invokes the corresponding agent runner; ``run_execution`` delegates the
state-changing path to the MANUAL agentic loop so the guardrail (policy.evaluate) is
interposed before any artifact becomes signable. Free agent-to-agent routing — which
would let an LLM escalate privilege by choosing which agent/tools run — is
structurally impossible here: the sequence is code (``flows.py``).

The Claude-backed agent runners are wired in later waves; the Coordinator is generic
over an injected ``runners`` map so the deterministic DAG walk is real and testable
now, without any model call.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..agents import AGENTS, guardrail
from ..policy import Action
from . import agentic_loop, flows
from .agentic_loop import Builder, ContextAssembler, ExecutionOutcome, PolicyGate, Simulator
from .flows import Flow, FlowKind


@dataclass
class FlowState:
    """Carried state threaded through a read flow's ordered steps.

    ``data`` accumulates each agent's typed output (positions, recommendations, …);
    ``visited`` records the exact agent order for the audit trail / determinism checks.
    """

    data: dict[str, Any] = field(default_factory=dict)
    visited: list[str] = field(default_factory=list)


class AgentRunner(Protocol):
    """A single agent's invocation (Claude call for LLM agents; pure for guardrail).

    Wired in later waves; the Coordinator only requires that a runner maps the current
    ``FlowState`` to the next one — it never lets a runner choose which agent runs next.
    """

    def __call__(self, state: FlowState) -> FlowState: ...


class Coordinator:
    """Invokes agents in a fixed per-flow order (a DAG), never via an LLM decision."""

    def __init__(self, flow_map: Mapping[str, Flow] | None = None) -> None:
        self._flows: dict[str, Flow] = dict(flow_map if flow_map is not None else flows.READ_FLOWS)

    def flow(self, name: str) -> Flow:
        """Look up a read flow by name (KeyError if unknown — flows are code, not input)."""
        return self._flows[name]

    def plan(self, name: str) -> tuple[str, ...]:
        """The ordered agent names a flow will invoke — deterministic, inspectable."""
        return self.flow(name).agents()

    def run_read(self, name: str, runners: Mapping[str, AgentRunner]) -> FlowState:
        """Walk a READ flow's fixed steps in order, invoking each step's runner.

        The order comes from ``flows.py`` (code), not from any model. A missing runner
        for a declared step is a wiring error (fail-closed: raises rather than skipping
        a step such as the guardrail stamp).
        """
        flow = self.flow(name)
        if flow.kind is not FlowKind.READ:
            raise ValueError(f"{name} is not a READ flow; use run_execution for {flow.kind}")
        state = FlowState()
        for step in flow.steps:
            if step.agent not in AGENTS:
                raise KeyError(f"unknown agent in flow {name!r}: {step.agent!r}")
            runner = runners.get(step.agent)
            if runner is None:
                raise KeyError(f"no runner wired for agent {step.agent!r} in flow {name!r}")
            state = runner(state)
            state.visited.append(step.agent)
        return state

    def run_execution(
        self,
        action: Action,
        *,
        builder: Builder,
        simulator: Simulator,
        assemble_context: ContextAssembler,
        gate: PolicyGate = guardrail.check,
    ) -> ExecutionOutcome:
        """Run the state-changing path through the MANUAL loop (policy interposed).

        The fixed (builder → guardrail) DAG for this action type is resolved from
        ``flows.execution_flow_for`` (deterministic, for the audit trail); the actual
        build → simulate → EVALUATE → gate sequence is enforced by
        ``agentic_loop.execute`` so a rejected verdict yields NO signable artifact.
        """
        # Resolve the fixed DAG (asserts a builder exists for this action type).
        _ = flows.execution_flow_for(action.action_type)
        return agentic_loop.execute(
            action,
            builder=builder,
            simulator=simulator,
            assemble_context=assemble_context,
            gate=gate,
        )
