"""The deterministic chat-driven onboarding step machine (agent-service-api.md §3.1).

Grounding: §3.1 (POST /onboarding/turn — a stateful onboarding conversation that produces
a DRAFT mandate; the mandate is NOT persisted until explicitly confirmed, FR-002),
plan.md (the Coordinator is deterministic Python; the LLM shapes NL only, never a safety
decision). The DAG contract: "POST /onboarding/turn → understand + literacy (the step
machine wraps these)".

Design — why a rogue LLM cannot leak authority here:
  - The step order + the derived mandate params are 100% deterministic CODE. The scenario
    → risk-tier, timeline → horizon, and goals → labels mappings are fixed tables; an
    unknown answer fails SAFE to the most conservative value. The model NEVER chooses the
    risk profile, the slippage, or any mandate field.
  - The model is used ONLY for two NL touches: classifying a free-text side-question
    (planner ``understand``) and writing a literacy tip for it (literacy). Both are
    inert prose — a ``tip`` block carries no action and no policy stamp.
  - A refusal short-circuits to a safe REFUSAL block and the flow simply re-prompts; the
    machine never stalls and never fabricates an answer.
  - The terminal ``mandate_draft`` block carries goals / riskProfile / riskParams /
    summaryText / version and NOTHING signable — no ``proposedAction``, no policy stamp,
    no calldata, no signature. It is a proposal the user must confirm via POST /mandate.

This module emits §2.7 ChatBlocks (``text`` / ``tool_step`` / ``tip`` / ``error``) plus the
onboarding-only terminal ``mandate_draft`` block. ``mandate_draft`` is intentionally NOT a
member of the strict §2.7 chat-block union (chat-block.ts) — the onboarding stream is a
superset the onboarding surface validates separately.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator, Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any, Protocol

from ..agents.literacy import Literacy
from ..agents.planner import IntentKind, Planner
from .chat_blocks import ChatBlock, ErrorBlock, TextBlock, TipBlock

# ─────────────────────────────────────────────────────────────────────────────
# Step machine definition (§3.1 step enum).
# ─────────────────────────────────────────────────────────────────────────────


class OnboardingStep(StrEnum):
    """§3.1 — the ordered onboarding steps the client submits answers for."""

    WELCOME = "welcome"
    CONNECT = "connect"
    EXPERIENCE = "experience"
    GOALS = "goals"
    TIMELINE = "timeline"
    RISK_SCENARIO = "risk_scenario"
    REVIEW = "review"


# The canonical forward order. ``review`` is terminal — reaching it emits the mandate_draft.
STEP_ORDER: tuple[OnboardingStep, ...] = (
    OnboardingStep.WELCOME,
    OnboardingStep.CONNECT,
    OnboardingStep.EXPERIENCE,
    OnboardingStep.GOALS,
    OnboardingStep.TIMELINE,
    OnboardingStep.RISK_SCENARIO,
    OnboardingStep.REVIEW,
)

GREETING = (
    "Welcome to SparkPoint. I'll help you set up a plan that fits your goals — and you "
    "stay in full control the whole way: I hold no keys and can never move your funds. "
    "Let's start with a few quick questions."
)

# The question shown when the user is to answer each step. Canned + safe (never fabricated
# by the model); the model only answers optional side-questions.
STEP_PROMPTS: dict[OnboardingStep, str] = {
    OnboardingStep.CONNECT: (
        "First, connect the wallet you'd like to use. You keep custody — connecting only "
        "lets me tailor suggestions to what you actually hold."
    ),
    OnboardingStep.EXPERIENCE: (
        "How would you describe your experience with crypto and DeFi — new to it, some "
        "experience, or experienced?"
    ),
    OnboardingStep.GOALS: (
        "What are you hoping to achieve? For example: grow your savings safely, preserve "
        "your capital, or earn steady yield on your USDC."
    ),
    OnboardingStep.TIMELINE: (
        "What's your time horizon for this money — under a year, one to three years, or "
        "longer?"
    ),
    OnboardingStep.RISK_SCENARIO: (
        "Last one: if your balance dropped 20% in a month, what would you most likely do — "
        "sell to avoid further loss, hold and wait it out, or add more?"
    ),
}

REVIEW_INTRO = (
    "Thanks — here's the plan I put together from your answers. Review it and confirm to "
    "make it active. Nothing is applied until you confirm, and you can change it anytime."
)

REFUSAL_TEXT = (
    "I can't help with that one, but we can keep setting up your plan — you're always in "
    "control."
)


# ─────────────────────────────────────────────────────────────────────────────
# Deterministic mandate-draft derivation (fixed tables; unknown → conservative).
# ─────────────────────────────────────────────────────────────────────────────

# The risk-scenario answer is the canonical risk signal. Launch biases conservative (the
# vault is conservative-only); an unrecognized answer falls SAFE to conservative.
_SCENARIO_RISK: dict[str, str] = {
    "sell": "conservative",
    "sell_all": "conservative",
    "panic_sell": "conservative",
    "exit": "conservative",
    "hold": "conservative",
    "wait": "conservative",
    "hold_and_wait": "conservative",
    "buy": "moderate",
    "buy_more": "moderate",
    "invest_more": "moderate",
    "add_more": "moderate",
}

# Timeline answer → an explicit horizon in months.
_TIMELINE_MONTHS: dict[str, int] = {
    "short": 6,
    "under_a_year": 6,
    "months": 6,
    "medium": 24,
    "one_to_three_years": 24,
    "1_3_years": 24,
    "long": 60,
    "three_plus_years": 60,
    "3_plus_years": 60,
    "retirement": 60,
}
_DEFAULT_HORIZON_MONTHS = 12

# Per-tier defaults (all fail-safe; the policy layer still clamps slippage to min(mandate,
# hard ceiling) — VR-M3 — so a looser value here can never widen what policy allows).
_TIER_SLIPPAGE_BPS: dict[str, int] = {"conservative": 50, "moderate": 100, "growth": 150}
_TIER_DRAWDOWN: dict[str, str] = {"conservative": "low", "moderate": "medium", "growth": "high"}

_GOAL_LABELS: dict[str, str] = {
    "grow_savings": "Grow my savings safely",
    "preserve_capital": "Preserve my capital",
    "earn_yield": "Earn steady yield on my USDC",
    "beat_inflation": "Stay ahead of inflation",
    "save_for_goal": "Save toward a specific goal",
}
_DEFAULT_GOAL_KEY = "grow_savings"

_TIER_TONE: dict[str, str] = {
    "conservative": "Conservative, capital-preservation focus",
    "moderate": "Balanced growth with managed risk",
    "growth": "Growth-oriented with a higher risk tolerance",
}


@dataclass(frozen=True)
class Goal:
    """One onboarding goal (§3.1 mandate_draft.goals[]). Advisory metadata — never signable."""

    kind: str
    label: str

    def to_wire(self) -> dict[str, Any]:
        return {"kind": self.kind, "label": self.label}


@dataclass(frozen=True)
class RiskParams:
    """§3.1 mandate_draft.riskParams. All fields are advisory constraints, not authority."""

    max_slippage_bps: int
    drawdown_tolerance: str
    horizon_months: int

    def to_wire(self) -> dict[str, Any]:
        return {
            "maxSlippageBps": self.max_slippage_bps,
            "drawdownTolerance": self.drawdown_tolerance,
            "horizonMonths": self.horizon_months,
        }


@dataclass(frozen=True)
class MandateDraft:
    """§3.1 ``mandate_draft.mandate`` — a DRAFT mandate, non-signable by construction.

    Carries no ``proposedAction``, no policy stamp, no calldata, no signature. It is a
    proposal the user must confirm via POST /mandate before it takes effect (FR-002).
    """

    goals: tuple[Goal, ...]
    risk_profile: str
    risk_params: RiskParams
    summary_text: str
    version: int = 1

    def to_wire(self) -> dict[str, Any]:
        return {
            "goals": [g.to_wire() for g in self.goals],
            "riskProfile": self.risk_profile,
            "riskParams": self.risk_params.to_wire(),
            "summaryText": self.summary_text,
            "version": self.version,
        }


@dataclass(frozen=True)
class MandateDraftBlock(ChatBlock):
    """The onboarding-terminal ``mandate_draft`` block (§3.1). Not a §2.7 union member."""

    mandate: MandateDraft

    def to_wire(self) -> dict[str, Any]:
        return {"type": "mandate_draft", "mandate": self.mandate.to_wire()}


def _norm(value: Any) -> str:
    """Normalize a raw selection value to a lowercase key (non-str coerced via ``str``)."""
    return str(value).strip().lower()


def _normalize_goals(raw: Any) -> list[str]:
    """Coerce the ``goals`` selection to a non-empty list of keys (fail-safe to a default)."""
    keys: list[str]
    if isinstance(raw, str):
        keys = [_norm(raw)] if raw.strip() else []
    elif isinstance(raw, Iterable):
        keys = [_norm(item) for item in raw if str(item).strip()]
    else:
        keys = []
    # De-duplicate while preserving order; drop empties.
    seen: set[str] = set()
    ordered: list[str] = []
    for key in keys:
        if key and key not in seen:
            seen.add(key)
            ordered.append(key)
    return ordered or [_DEFAULT_GOAL_KEY]


def _goal_label(kind: str) -> str:
    """A safe label for a goal key (known → curated; unknown → a humanized fallback)."""
    return _GOAL_LABELS.get(kind, kind.replace("_", " ").capitalize())


def _time_horizon_bucket(months: int) -> str:
    """Bucket an explicit horizon into the data-model ``time_horizon`` enum."""
    if months <= 6:
        return "short"
    if months <= 24:
        return "medium"
    return "long"


def _summary_text(risk_tier: str, goals: tuple[Goal, ...]) -> str:
    """A deterministic, provable mandate summary (rendered back for confirmation, FR-002).

    Built only from the derived tier + goals — never fabricated by the model — and it
    always states the profit-only, 0-on-principal fee posture so the user sees the real
    economics before confirming.
    """
    tone = _TIER_TONE.get(risk_tier, _TIER_TONE["conservative"])
    return (
        f"{tone}; USDC yield via the 0-management, profit-only performance-fee vault "
        "(10% of yield, 0% on principal)."
    )


def build_mandate_draft(selections: Mapping[str, Any]) -> MandateDraft:
    """Derive the §3.1 :class:`MandateDraft` from accumulated onboarding selections.

    Fully deterministic + fail-safe: an unrecognized scenario/timeline/goal falls back to
    the most conservative value, so a garbled or adversarial answer can only ever produce
    a SAFER mandate, never a riskier one.
    """
    risk_tier = _SCENARIO_RISK.get(_norm(selections.get("scenario", "")), "conservative")
    horizon = _TIMELINE_MONTHS.get(
        _norm(selections.get("timeline", "")), _DEFAULT_HORIZON_MONTHS
    )
    goals = tuple(
        Goal(kind=k, label=_goal_label(k)) for k in _normalize_goals(selections.get("goals"))
    )
    params = RiskParams(
        max_slippage_bps=_TIER_SLIPPAGE_BPS[risk_tier],
        drawdown_tolerance=_TIER_DRAWDOWN[risk_tier],
        horizon_months=horizon,
    )
    return MandateDraft(
        goals=goals,
        risk_profile=risk_tier,
        risk_params=params,
        summary_text=_summary_text(risk_tier, goals),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Session store (mocked in tests; asyncpg-backed in prod via db/mandates.py).
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class SessionState:
    """The accumulated onboarding conversation state (a pre-confirmation scratchpad)."""

    step: str = OnboardingStep.WELCOME.value
    selections: Mapping[str, Any] = field(default_factory=dict)
    completed: bool = False


class OnboardingStore(Protocol):
    """Persists onboarding session state. NOT the mandate — nothing here is effective
    until the user confirms via POST /mandate (§3.1, FR-002)."""

    async def load(self, session_id: str) -> SessionState | None: ...

    async def save(self, session_id: str, state: SessionState) -> None: ...


@dataclass
class InMemoryOnboardingStore:
    """A process-local session store (default for dev/tests). Production swaps in the
    asyncpg-backed ``PgOnboardingStore`` so a session survives across workers/restarts."""

    _sessions: dict[str, SessionState] = field(default_factory=dict)

    async def load(self, session_id: str) -> SessionState | None:
        return self._sessions.get(session_id)

    async def save(self, session_id: str, state: SessionState) -> None:
        self._sessions[session_id] = state


def new_session_id() -> str:
    """A server-issued onboarding session id (``onb_`` + uuid4 hex), §3.1."""
    return f"onb_{uuid.uuid4().hex}"


# ─────────────────────────────────────────────────────────────────────────────
# The onboarding machine.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class OnboardingMachine:
    """The deterministic §3.1 step machine. Composes ``understand`` + ``literacy`` for
    optional NL side-questions; the mandate derivation itself is pure code."""

    planner: Planner
    literacy: Literacy
    store: OnboardingStore = field(default_factory=InMemoryOnboardingStore)

    async def turn(
        self,
        *,
        session_id: str,
        step: OnboardingStep,
        user_message: str | None = None,
        selections: Mapping[str, Any] | None = None,
    ) -> AsyncIterator[ChatBlock]:
        """Drive one onboarding turn as a stream of ChatBlocks (never a signable artifact).

        Merges the turn's ``selections`` into the session, answers an optional free-text
        side-question via the LLM (understand → literacy) without advancing, and otherwise
        advances the deterministic step machine — emitting the terminal ``mandate_draft``
        once the last question is answered.
        """
        prior = await self.store.load(session_id)
        merged: dict[str, Any] = dict(prior.selections) if prior is not None else {}
        merged.update(selections or {})

        # Optional side-question — answered inline, never advances the machine.
        if user_message and user_message.strip():
            handled = False
            async for block in self._handle_side_question(user_message):
                handled = True
                yield block
            if handled:
                await self.store.save(
                    session_id, SessionState(step=step.value, selections=merged, completed=False)
                )
                for block in self._reprompt(step):
                    yield block
                return

        # Normal advance.
        if step is OnboardingStep.WELCOME:
            yield TextBlock(GREETING)
            yield TextBlock(STEP_PROMPTS[OnboardingStep.CONNECT])
            await self.store.save(
                session_id,
                SessionState(step=OnboardingStep.CONNECT.value, selections=merged, completed=False),
            )
            return

        target = self._successor(step)
        if target is OnboardingStep.REVIEW:
            draft = build_mandate_draft(merged)
            yield TextBlock(REVIEW_INTRO)
            yield MandateDraftBlock(draft)
            await self.store.save(
                session_id,
                SessionState(step=OnboardingStep.REVIEW.value, selections=merged, completed=True),
            )
            return

        yield TextBlock(STEP_PROMPTS[target])
        await self.store.save(
            session_id, SessionState(step=target.value, selections=merged, completed=False)
        )

    async def _handle_side_question(self, user_message: str) -> AsyncIterator[ChatBlock]:
        """Classify a free-text message; emit a REFUSAL or a literacy tip, or nothing.

        Yields nothing when the message is a plain step answer (the caller then advances).
        A refusal fails closed to a safe REFUSAL block; a ``learn`` intent yields a tip.
        """
        intent = await self.planner.classify(user_message, surface="onboarding")
        if intent.refused:
            yield ErrorBlock("REFUSAL", REFUSAL_TEXT)
            return
        if intent.kind is IntentKind.LEARN:
            card = await self.literacy.tip(intent.topic)
            yield TipBlock(card.topic, card.body)

    def _reprompt(self, step: OnboardingStep) -> list[ChatBlock]:
        """Re-show the question the user is currently on (after a side-question)."""
        if step is OnboardingStep.WELCOME:
            return [TextBlock(GREETING), TextBlock(STEP_PROMPTS[OnboardingStep.CONNECT])]
        prompt = STEP_PROMPTS.get(step)
        if prompt is not None:
            return [TextBlock(prompt)]
        return [TextBlock(REVIEW_INTRO)]

    @staticmethod
    def _successor(step: OnboardingStep) -> OnboardingStep:
        """The next step after ``step`` (clamped at the terminal ``review``)."""
        index = STEP_ORDER.index(step)
        return STEP_ORDER[min(index + 1, len(STEP_ORDER) - 1)]
