"""The §3.1 Onboarding / Mandate endpoints (chat onboarding + versioned mandate CRUD).

agent-service-api.md §3.1:
  - ``POST /onboarding/turn`` — drive the chat-driven onboarding step machine; streams
    ChatBlocks, and the terminal block of a completed flow is a ``mandate_draft`` (a DRAFT
    mandate that is NOT persisted until the user explicitly confirms, FR-002).
  - ``POST /mandate`` — persist a confirmed mandate (FR-002). 201.
  - ``GET  /mandate`` — read the active mandate (200; ``null`` when none).
  - ``PUT  /mandate`` — update goals/risk → a NEW versioned row (FR-004). 200.

Non-custody (§0): every response here is advisory. The onboarding stream emits only
``text``/``tool_step``/``tip``/``error`` blocks plus the terminal ``mandate_draft`` — none
carry a ``proposedAction``, a policy stamp, calldata, or a signature. The mandate CRUD
responses carry the mandate's goals/risk/summary/version — never a signable artifact. A
mandate only NARROWS the onchain allowlist (VR-M5); the deterministic policy layer
re-checks every action regardless, so nothing persisted here can authorize a fund move.
The middleware's ``X-Account``/``X-Owner`` headers scope persistence to a user only — never
authority to move funds (§1.2).
"""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator

from ..agents.literacy import Literacy
from ..agents.planner import Planner
from ..coordinator.onboarding import (
    InMemoryOnboardingStore,
    OnboardingMachine,
    OnboardingStep,
    new_session_id,
)
from ..db import get_database
from ..db.mandates import MandateStore, MandateWrite, PgMandateStore
from ..llm import AsyncClaudeClient
from ..persona import get_persona
from .errors import ApiError, ErrorCode
from .security import AccountContext

router = APIRouter(tags=["mandate"])

# conservative | moderate | growth (data-model.md sec.5 ``risk_tier``). Launch defaults
# conservative (the vault is conservative-only). A mandate tier only NARROWS the onchain
# allowlist (VR-M5); the policy layer never widens from it.
_ALLOWED_RISK_PROFILES: frozenset[str] = frozenset({"conservative", "moderate", "growth"})

# risk_tier → normalized 0..100 risk score persisted for provability (data-model.md sec.5).
_RISK_SCORE: dict[str, int] = {"conservative": 20, "moderate": 50, "growth": 80}

# A process-local onboarding session store (default for dev). Production swaps in the
# asyncpg-backed store so a session survives across workers/restarts (mirrors the
# IdempotencyStore note in api/main.py).
_ONBOARDING_STORE = InMemoryOnboardingStore()


# ─────────────────────────────────────────────────────────────────────────────
# Request models (camelCase field names = the exact §3.1 wire shape).
# ─────────────────────────────────────────────────────────────────────────────


class OnboardingTurnRequest(BaseModel):
    """§3.1 ``POST /onboarding/turn`` body."""

    sessionId: str | None = None
    step: OnboardingStep = OnboardingStep.WELCOME
    userMessage: str | None = None
    selections: dict[str, Any] = Field(default_factory=dict)


class GoalBody(BaseModel):
    """§3.1 mandate goal ``{ kind, label }``."""

    kind: str
    label: str


class RiskParamsBody(BaseModel):
    """§3.1 mandate ``riskParams``. Slippage is clamped to ``min(this, hard ceiling)`` by
    the policy layer (VR-M3) — a looser value here never widens what policy allows."""

    maxSlippageBps: int = Field(ge=0, le=10000)
    drawdownTolerance: str
    horizonMonths: int = Field(gt=0)


class MandateBody(BaseModel):
    """§3.1 confirmed-mandate body (also the shape of a ``mandate_draft.mandate``).

    ``version`` is advisory on the wire; the server assigns the authoritative version on
    persist (a fork of the next version), so the client can never pin/downgrade it.
    """

    goals: list[GoalBody] = Field(default_factory=list)
    riskProfile: str
    riskParams: RiskParamsBody
    summaryText: str
    version: int | None = None

    @field_validator("riskProfile")
    @classmethod
    def _validate_risk_profile(cls, value: str) -> str:
        if value not in _ALLOWED_RISK_PROFILES:
            raise ValueError(f"riskProfile must be one of {sorted(_ALLOWED_RISK_PROFILES)}")
        return value


class MandatePersistRequest(BaseModel):
    """§3.1 ``POST``/``PUT /mandate`` body: ``{ "mandate": { ... } }``."""

    mandate: MandateBody


# ─────────────────────────────────────────────────────────────────────────────
# Dependencies.
# ─────────────────────────────────────────────────────────────────────────────


def get_account(request: Request) -> AccountContext:
    """The user-scoping identity the middleware asserted (§1.2). NOT fund authority —
    scopes mandate persistence/reads to a user only."""
    account = getattr(request.state, "account", None)
    if not isinstance(account, AccountContext):  # pragma: no cover — middleware guarantees it
        raise ApiError(ErrorCode.ACCOUNT_HEADERS_INVALID, "Missing user-scoping account context.")
    return account


def get_mandate_store() -> MandateStore:
    """The asyncpg-backed mandate store (production). Overridden with a fake in tests."""
    return PgMandateStore(get_database())


def get_onboarding_machine() -> OnboardingMachine:
    """The onboarding step machine (deterministic core + LLM for NL side-questions).

    The LLM is used ONLY to classify a free-text side-question and write a literacy tip;
    the mandate derivation is pure code. Overridden with mocked agents in tests.
    """
    llm = AsyncClaudeClient.from_env()
    return OnboardingMachine(
        planner=Planner(llm=llm),
        literacy=Literacy(llm=llm, persona_provider=get_persona),
        store=_ONBOARDING_STORE,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Mapping helpers.
# ─────────────────────────────────────────────────────────────────────────────


def _network_id(chain_id: int) -> str:
    """The ``networks`` mirror id for a chain. The mirror carries only ``base`` (EVM) +
    ``sui``; both Base mainnet (8453) and Base Sepolia (84532) map to ``base``."""
    return "base"


def _time_horizon_bucket(months: int) -> str:
    """Bucket an explicit horizon (months) into the data-model ``time_horizon`` enum."""
    if months <= 6:
        return "short"
    if months <= 24:
        return "medium"
    return "long"


def _to_write(body: MandateBody) -> MandateWrite:
    """Map the validated §3.1 request body to the persisted :class:`MandateWrite`.

    ``risk_params`` is stored verbatim so the wire round-trips exactly; the individual
    columns (risk_tier/max_slippage_bps/time_horizon/…) mirror it for policy/provability.
    """
    horizon = body.riskParams.horizonMonths
    return MandateWrite(
        risk_tier=body.riskProfile,
        risk_score=_RISK_SCORE[body.riskProfile],
        max_slippage_bps=body.riskParams.maxSlippageBps,
        time_horizon=_time_horizon_bucket(horizon),
        horizon_months=horizon,
        drawdown_tolerance=body.riskParams.drawdownTolerance,
        allowed_assets=["USDC"],
        goals=[{"kind": g.kind, "label": g.label} for g in body.goals],
        risk_params={
            "maxSlippageBps": body.riskParams.maxSlippageBps,
            "drawdownTolerance": body.riskParams.drawdownTolerance,
            "horizonMonths": horizon,
        },
        summary_text=body.summaryText,
    )


def _sse(event: str, data: dict[str, Any]) -> bytes:
    """One SSE frame (§3.2 framing): ``event: <name>\\ndata: <json>\\n\\n``."""
    return f"event: {event}\ndata: {json.dumps(data)}\n\n".encode()


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints.
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/onboarding/turn")
async def onboarding_turn(
    body: OnboardingTurnRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    machine: Annotated[OnboardingMachine, Depends(get_onboarding_machine)],
) -> StreamingResponse:
    """Drive one onboarding turn as an SSE stream of ChatBlocks (§3.1).

    Streams ``text``/``tool_step``/``tip``/``error`` blocks and, once the flow completes, a
    terminal ``mandate_draft`` block. NEVER returns a signable bundle: the draft carries no
    ``proposedAction``, no policy stamp, no calldata, and no signature. The mandate takes
    effect only when the user confirms via ``POST /mandate``.
    """
    session_id = body.sessionId or new_session_id()

    async def _events() -> AsyncIterator[bytes]:
        count = 0
        async for block in machine.turn(
            session_id=session_id,
            step=body.step,
            user_message=body.userMessage,
            selections=body.selections,
        ):
            count += 1
            yield _sse("block", block.to_wire())
        yield _sse("done", {"sessionId": session_id, "blockCount": count})

    return StreamingResponse(_events(), media_type="text/event-stream")


@router.post("/mandate", status_code=201)
async def create_mandate(
    body: MandatePersistRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[MandateStore, Depends(get_mandate_store)],
) -> dict[str, Any]:
    """Persist a confirmed mandate (FR-002). Returns 201 with the stored mandate.

    Never returns a signable artifact — only the mandate's goals/risk/summary/version.
    """
    record = await store.persist(
        owner_eoa=account.owner,
        network_id=_network_id(account.chain_id),
        write=_to_write(body.mandate),
    )
    return {"mandate": record.to_wire()}


@router.get("/mandate")
async def get_mandate(
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[MandateStore, Depends(get_mandate_store)],
) -> dict[str, Any]:
    """Read the user's active mandate (§3.1). ``200`` with ``mandate: null`` when none."""
    record = await store.get_active(
        owner_eoa=account.owner, network_id=_network_id(account.chain_id)
    )
    return {"mandate": record.to_wire() if record is not None else None}


@router.put("/mandate")
async def update_mandate(
    body: MandatePersistRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    store: Annotated[MandateStore, Depends(get_mandate_store)],
) -> dict[str, Any]:
    """Update goals/risk → a NEW versioned row (FR-004). The prior version is retained
    (superseded, inactive); the new version becomes active. Never returns a signable
    artifact."""
    record = await store.persist(
        owner_eoa=account.owner,
        network_id=_network_id(account.chain_id),
        write=_to_write(body.mandate),
    )
    return {"mandate": record.to_wire()}
