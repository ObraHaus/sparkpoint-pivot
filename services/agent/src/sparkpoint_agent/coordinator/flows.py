"""Per-endpoint fixed DAGs — the Coordinator's routes are CODE, not an LLM router.

Grounding: research.md §6 — "a fixed DAG, not free agent-to-agent routing": free
routing would let an LLM choose to escalate privilege (which agent, thus which
tools, runs); a code-defined DAG cannot. Each ``Flow`` is an ORDERED tuple of steps.
Read flows may use the SDK auto tool-runner; EXECUTION flows MUST run through the
MANUAL agentic loop (``agentic_loop.execute``) so the guardrail (policy.evaluate)
sits BETWEEN a proposed action and a signable artifact.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from ..agents import executor, guardrail, portfolio_reader, strategy_recommender, vault_manager
from ..policy import ActionType


class FlowKind(StrEnum):
    """How a flow is executed.

    - ``READ``      : read-only; the SDK auto tool-runner is permissible.
    - ``EXECUTION`` : state-changing; the MANUAL loop is MANDATORY so the policy gate
                      is interposed before any artifact becomes signable (research.md §6).
    """

    READ = "read"
    EXECUTION = "execution"


@dataclass(frozen=True)
class Step:
    """One node in a flow's fixed DAG: the agent to invoke + why (audit-legible)."""

    agent: str
    note: str = ""


@dataclass(frozen=True)
class Flow:
    """An ordered, code-defined DAG for one endpoint/flow (no LLM chooses the order)."""

    name: str
    kind: FlowKind
    steps: tuple[Step, ...]

    def agents(self) -> tuple[str, ...]:
        """The ordered agent names this flow invokes."""
        return tuple(step.agent for step in self.steps)


# ── Read flows ───────────────────────────────────────────────────────────────
# /chat and /recommendations end on the guardrail so a proposed action carries a
# deterministic policy STAMP (approved/rejected) — but they NEVER emit a signable
# bundle; that only happens on the EXECUTION path via /build-tx (agent-service-api
# §3.2/§3.4/§3.5, single signing chokepoint).

PORTFOLIO_FLOW = Flow(
    name="portfolio",
    kind=FlowKind.READ,
    steps=(Step(portfolio_reader.SPEC.name, "read/derive the portfolio"),),
)

CHAT_FLOW = Flow(
    name="chat",
    kind=FlowKind.READ,
    steps=(
        Step(portfolio_reader.SPEC.name, "ground the turn in the user's positions"),
        Step(strategy_recommender.SPEC.name, "propose advisory strategies (not signable)"),
        Step(guardrail.SPEC.name, "stamp each ProposedAction with a policy verdict"),
    ),
)

RECOMMENDATIONS_FLOW = Flow(
    name="recommendations",
    kind=FlowKind.READ,
    steps=(
        Step(portfolio_reader.SPEC.name, "read positions for mandate-fit ranking"),
        Step(strategy_recommender.SPEC.name, "rank whitelist-only strategies vs. mandate"),
        Step(guardrail.SPEC.name, "policy-stamp; renderer hides anything not cleared"),
    ),
)

READ_FLOWS: dict[str, Flow] = {
    PORTFOLIO_FLOW.name: PORTFOLIO_FLOW,
    CHAT_FLOW.name: CHAT_FLOW,
    RECOMMENDATIONS_FLOW.name: RECOMMENDATIONS_FLOW,
}


# ── Execution flow (build-tx) ────────────────────────────────────────────────
# A deterministic ActionType → builder mapping (NOT an LLM choice). Vault ops go to
# vault_manager; Aave/Aerodrome/session-key ops go to executor. Every execution flow
# ends on the guardrail — the interposed policy gate (agentic_loop.execute).

BUILDER_FOR_ACTION: dict[ActionType, str] = {
    ActionType.VAULT_DEPOSIT: vault_manager.SPEC.name,
    ActionType.VAULT_WITHDRAW: vault_manager.SPEC.name,
    ActionType.VAULT_REDEEM: vault_manager.SPEC.name,
    ActionType.AAVE_SUPPLY: executor.SPEC.name,
    ActionType.AAVE_WITHDRAW: executor.SPEC.name,
    ActionType.AERODROME_SWAP: executor.SPEC.name,
    ActionType.SESSION_KEY_GRANT: executor.SPEC.name,
    ActionType.SESSION_KEY_REVOKE: executor.SPEC.name,
}


def execution_flow_for(action_type: ActionType) -> Flow:
    """Build the fixed EXECUTION DAG for ``action_type``: (builder, guardrail).

    The builder is chosen deterministically from ``BUILDER_FOR_ACTION`` — never by a
    model. The trailing guardrail step is the policy interposition the manual loop
    enforces before any artifact becomes signable (N1/N3).
    """
    builder = BUILDER_FOR_ACTION[action_type]
    return Flow(
        name=f"build_tx:{action_type.value}",
        kind=FlowKind.EXECUTION,
        steps=(
            Step(builder, f"build UNSIGNED calldata + simulate for {action_type.value}"),
            Step(guardrail.SPEC.name, "policy gate: evaluate BEFORE signable (fail-closed)"),
        ),
    )
