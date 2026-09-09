"""⚠️  SUPERSEDED — NOT EXECUTED (023, FR-023-016).

Nothing imports or calls this module. The execution interposition that actually RUNS is
``execution/orchestrate.py`` (feature 019) — an independent implementation of the same
ordering: decode → build → simulate → assemble → PURE ``policy.evaluate`` → gate → persist.

RETAINED deliberately (023 clarify decision) rather than deleted, because it holds the only
code-form record of
the manual build → simulate → EVALUATE → gate loop as originally specified.

Read it as design documentation, NOT as a live guarantee: a Gate-C auditor reading a module
that presents itself as "the" policy interposition must not be misled about which one is
load-bearing. ``tests/coordinator/test_superseded_markers.py`` fails if this marker is dropped,
or if any module outside ``coordinator/`` starts importing these symbols — so the claim cannot
quietly rot.

The original module documentation follows.

----

The MANUAL execution loop — policy interposed BETWEEN "proposed" and "signable".

This is the non-custody crux (research.md §6; agent-service-api.md §3.5; N1/N3).
Unlike the read paths (which may use the SDK auto tool-runner), the execution path
uses THIS manual loop so ``guardrail.check`` (``policy.evaluate``) runs AFTER the
model has proposed an action and the (unsigned) calldata + a FRESH simulation are
built, but BEFORE any artifact can become signable. A rejected verdict yields NO
signable artifact — the loop returns the verdict + reasons, never a bundle. The
service holds no key; the built calldata's ``signature`` is ALWAYS null.

Ordered steps (agent-service-api.md §3.5 build-tx behavior, fail-closed):
    1. BUILD     — builder.build_unsigned(action)  → inert UNSIGNED calldata.
    2. SIMULATE  — simulator.simulate(...)          → a FRESH SimulationInput.
    3. ASSEMBLE  — assemble_context(...)            → PolicyContext (fresh reads + sim).
    4. EVALUATE  — evaluate(action, ctx)            ← the interposed policy gate.
    5. GATE      — signable ONLY iff verdict.is_signable; else fail-closed (no bundle).

The builder / simulator / context-assembler are injected Protocols; the concrete
Anvil-fork + RPC + calldata bindings are wired in later waves. What is real NOW is
the control flow: the policy check is structurally between proposal and signable, and
``is_signable`` is derived ONLY from the deterministic verdict.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

from ..agents import guardrail
from ..policy import Action, ActionType, PolicyContext, PolicyVerdict


@dataclass(frozen=True)
class UnsignedStep:
    """One inert, UNSIGNED call in a build (agent-service-api.md §2.1 ``steps[]``)."""

    chain_id: int
    to: str
    value: str
    data: str
    label: str
    op_type: str = "userop"  # "userop" (ERC-4337) | "eoa_call"


@dataclass(frozen=True)
class UnsignedArtifact:
    """The inert product of a build — UNSIGNED calldata only.

    ``signature`` is typed ``None`` and defaulted ``None`` to encode the invariant at
    the type level: the service NEVER signs; the user's wallet fills the signature
    later (N1, N3). There is no code path that sets it non-null.
    """

    kind: ActionType
    steps: tuple[UnsignedStep, ...]
    signature: None = None


class Builder(Protocol):
    """A builder agent's build tool (executor / vault_manager only)."""

    def build_unsigned(self, action: Action) -> UnsignedArtifact: ...


class Simulator(Protocol):
    """The fresh pre-trade simulation tool (Anvil fork / eth_call dry-run)."""

    def simulate(self, action: Action, artifact: UnsignedArtifact) -> object: ...


# Assembles the deterministic PolicyContext from FRESH chain reads + the fresh sim.
# Typed as a callable so the loop stays agnostic to how context is gathered (the
# reads happen OUTSIDE the pure policy layer, then are handed in — policy §0 rule 6).
ContextAssembler = Callable[[Action, UnsignedArtifact, object], PolicyContext]

# The interposed policy gate. Defaults to the guardrail (a thin wrapper over
# policy.evaluate); overridable in tests. A reference, not a call — no B008.
PolicyGate = Callable[[Action, PolicyContext], PolicyVerdict]


@dataclass(frozen=True)
class ExecutionOutcome:
    """The result of the manual loop.

    ``artifact`` is present ONLY when the verdict is signable; on any rejection it is
    ``None`` (fail-closed — no signable bundle for an out-of-policy action). The
    ``simulation`` is retained for the preview/error envelope either way.
    """

    verdict: PolicyVerdict
    artifact: UnsignedArtifact | None
    simulation: object | None

    @property
    def signable(self) -> bool:
        """True iff the policy verdict cleared AND a bundle was emitted (N1/N3)."""
        return self.verdict.is_signable and self.artifact is not None


def execute(
    action: Action,
    *,
    builder: Builder,
    simulator: Simulator,
    assemble_context: ContextAssembler,
    gate: PolicyGate = guardrail.check,
) -> ExecutionOutcome:
    """Run the fixed build → simulate → EVALUATE → gate sequence, fail-closed.

    ``action`` is the model-proposed action (the "proposed" side of the interposition).
    The guardrail (``gate``) is evaluated AFTER build+simulate and BEFORE the artifact
    is exposed as signable; a non-signable verdict returns ``artifact=None``. This
    ordering is the single structural guarantee that an out-of-policy action can never
    yield a signable bundle.
    """
    # 1. BUILD — inert UNSIGNED calldata (signature always null).
    artifact = builder.build_unsigned(action)

    # 2. SIMULATE — a FRESH preview (revert / slippage / balance deltas).
    simulation = simulator.simulate(action, artifact)

    # 3. ASSEMBLE — the deterministic context: fresh chain reads + the fresh sim.
    ctx = assemble_context(action, artifact, simulation)

    # 4. EVALUATE — the interposed, LLM-free policy gate (policy.evaluate).
    verdict = gate(action, ctx)

    # 5. GATE — signable ONLY on an approved verdict; else fail-closed, NO bundle.
    if not verdict.is_signable:
        return ExecutionOutcome(verdict=verdict, artifact=None, simulation=simulation)
    return ExecutionOutcome(verdict=verdict, artifact=artifact, simulation=simulation)
