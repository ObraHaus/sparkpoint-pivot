"""Pydantic wire models for the execution spine (feature 019 US2).

Byte-parity mirrors of the shared zod schemas (``.strict()`` → ``ConfigDict(extra="forbid")``,
camelCase field names, ``T | None`` for ``.nullable()``, ``Literal[...]`` for ``z.enum``):

    IntentBundle          ⟷ packages/shared/src/schemas/intent-bundle.ts
    IntentStep            ⟷ intent-bundle.ts (IntentStepSchema)
    PackedUserOperation   ⟷ intent-bundle.ts (PackedUserOperationSchema) — sig ALWAYS null (N1/N3)
    WirePolicyVerdict     ⟷ policy-verdict.ts (PolicyVerdictSchema)
    WireReason            ⟷ policy-verdict.ts (ReasonSchema)
    GuardrailCheck        ⟷ guardrail.ts (GuardrailCheckSchema)
    SimulationResult      ⟷ simulation.ts (reused from sim/simulator.py)

A drift guard lives in ``tests/execution/test_wire_parity.py`` (the repo's policy-parity CI only
covers 6 constants — model/enum parity was convention-only until this feature).
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, field_validator

from ..sim import SimulationResult

_UINT256_MAX = 2**256 - 1


# ── IntentBundle sub-shapes (intent-bundle.ts) ───────────────────────────────────────────────────


class IntentStep(BaseModel):
    """§2.1 IntentStepSchema — one ordered, UNSIGNED step (allowlisted target; recipient forced)."""

    model_config = ConfigDict(extra="forbid")

    chainId: int
    opType: Literal["userop", "eoa_call"]
    to: str
    value: str
    data: str
    label: str


class PackedUserOperation(BaseModel):
    """§2.1 PackedUserOperationSchema — UNSIGNED (EntryPoint v0.7). ``signature`` is ALWAYS null."""

    model_config = ConfigDict(extra="forbid")

    sender: str
    nonce: str
    factory: str | None
    factoryData: str | None
    callData: str
    callGasLimit: str
    verificationGasLimit: str
    preVerificationGas: str
    maxFeePerGas: str
    maxPriorityFeePerGas: str
    paymaster: str | None
    paymasterData: str | None
    # ALWAYS null from the service; a non-null value is a non-custody breach (N1/N3).
    signature: None = None


# ── PolicyVerdict wire (policy-verdict.ts) ───────────────────────────────────────────────────────


class WireReason(BaseModel):
    """§2.4/§1.5 ReasonSchema — one structured reason (foundation ReasonCode string + message)."""

    model_config = ConfigDict(extra="forbid")

    code: str
    message: str


class GuardrailCheck(BaseModel):
    """§2.5 GuardrailCheckSchema — one confirmation-checklist row in the ExecutionDrawer."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str
    status: Literal["pass", "fail", "warn"]
    # zod: z.string().optional() — a present string satisfies it; we always populate a detail.
    detail: str | None = None


class WirePolicyVerdict(BaseModel):
    """§2.4 PolicyVerdictSchema — the deterministic, LLM-free verdict carried by a bundle."""

    model_config = ConfigDict(extra="forbid")

    approved: bool
    policyVersion: str
    reasons: list[WireReason]
    # ProposedActionSchema.nullable() — built as a dict to match the zod optional-field shape
    # exactly.
    normalizedAction: dict[str, Any] | None
    simulation: SimulationResult | None


# ── IntentBundle (intent-bundle.ts) ──────────────────────────────────────────────────────────────


class IntentBundle(BaseModel):
    """§2.1 IntentBundleSchema — the ONLY state-changing artifact, inert + UNSIGNED.

    ``simulation`` is nullable for the exit path only (N2): a withdraw/redeem builds even when the
    simulator is unavailable; it is NEVER null on an approved inflow (VR-X2).
    """

    model_config = ConfigDict(extra="forbid")

    id: str
    userId: str
    kind: str
    steps: list[IntentStep]
    userOp: PackedUserOperation | None = None
    simulation: SimulationResult | None
    policyVerdict: WirePolicyVerdict
    guardrailChecklist: list[GuardrailCheck]
    rationale: str
    citations: list[dict[str, Any]]
    recommendationId: str | None = None
    policyVersion: str
    expiresAt: str


# ── Request / response bodies (agent-service-api.md §3.5/§3.6) ───────────────────────────────────


class BuildActionRequest(BaseModel):
    """The ``action`` object of a build request (a ProposedAction — §3.5).

    Lenient (``extra="ignore"``) so a swap proposal's extra token-pair fields do not 422 before the
    orchestrator honestly refuses the unsupported action type.
    """

    model_config = ConfigDict(extra="ignore")

    type: str
    asset: str
    decimals: int
    amount: str
    params: dict[str, Any] | None = None
    recommendationId: str | None = None

    @field_validator("amount")
    @classmethod
    def _validate_amount(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("amount must be a non-negative base-10 integer string")
        if int(value) > _UINT256_MAX:
            raise ValueError("amount exceeds uint256")
        return value

    @property
    def amount_int(self) -> int:
        return int(self.amount)


class BuildTxRequest(BaseModel):
    """``POST /build-tx`` request (§3.5)."""

    model_config = ConfigDict(extra="forbid")

    action: BuildActionRequest
    execMode: Literal["per_action", "session_key"] = "per_action"


class BuildTxResponse(BaseModel):
    """``POST /build-tx`` 200 body (§3.5)."""

    model_config = ConfigDict(extra="forbid")

    intentBundle: IntentBundle


class SimulateRequest(BaseModel):
    """``POST /simulate`` request (§3.5) — refresh a stored bundle, or preview raw steps."""

    model_config = ConfigDict(extra="forbid")

    intentId: str | None = None
    steps: list[dict[str, Any]] | None = None


class SimulateResponse(BaseModel):
    """``POST /simulate`` 200 body (§3.5)."""

    model_config = ConfigDict(extra="forbid")

    simulation: SimulationResult | None


class SignedPayload(BaseModel):
    """The user-signed artifact relayed to ``POST /submit-signed-tx`` (§3.6).

    ``userOp`` (userop path) carries a NON-null signature supplied BY THE WALLET; ``rawTx`` is a
    signed
    raw EOA tx; ``txHash`` is a hash the frontend already broadcast (direct submit) for correlation.
    """

    model_config = ConfigDict(extra="forbid")

    opType: Literal["userop", "eoa_call"]
    userOp: dict[str, Any] | None = None
    rawTx: str | None = None
    txHash: str | None = None


class SubmitSignedRequest(BaseModel):
    """``POST /submit-signed-tx`` request (§3.6)."""

    model_config = ConfigDict(extra="forbid")

    intentId: str
    signed: SignedPayload


class Submission(BaseModel):
    """§3.6 submission envelope."""

    model_config = ConfigDict(extra="forbid")

    intentId: str
    status: str
    userOpHash: str | None
    txHash: str | None
    bundler: str | None


class SubmitSignedResponse(BaseModel):
    """``POST /submit-signed-tx`` 202 body (§3.6)."""

    model_config = ConfigDict(extra="forbid")

    submission: Submission


class SubmissionStatusResponse(BaseModel):
    """``GET /submit-signed-tx/{intentId}`` 200 body (§3.6)."""

    model_config = ConfigDict(extra="forbid")

    status: Literal["pending", "confirmed", "failed"]
    txHash: str | None
    blockNumber: int | None
    receipt: dict[str, Any] | None
