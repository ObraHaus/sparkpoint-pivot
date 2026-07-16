"""Planner — classify the user's intent + extract parameters (LLM, structured).

Grounding: plan.md Coordinator DAG stage ``understand`` (NL understanding via the LLM);
agent-service-api.md §3.2 (chat turn). The planner is the ONLY place the model shapes
what the user wants; it does NOT choose which agent runs next (that is the deterministic
DAG) and it NEVER produces a signable artifact.

Fail-closed (non-custody, §0.5/§0.6): the model answers with strict JSON validated by
:func:`_parse_intent`. A refusal, non-JSON, or malformed classification yields a safe
:data:`Intent` with ``kind == OTHER`` — the DAG then answers generically and never
fabricates or executes an action from a garbled turn. Extracted params are coerced
conservatively: an amount that does not parse to clean base units becomes ``None`` (the
DAG asks the user rather than inventing a number), and an unknown asset/action drops out.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from ..llm import AsyncClaudeClient, Effort
from ..policy import ActionType, Asset

# Extraction is light judgment (parse an amount/asset from free text), not deep
# reasoning — MEDIUM effort (research.md §6 effort-tiering; the recommender is HIGH).
EFFORT: Effort = "medium"

# The advisory action set the planner may surface (the whitelisted, non-exit actions a
# chat turn can propose). A withdraw/redeem never routes through the advisory proposer —
# the exit path is the frontend's direct on-chain escape hatch (N2), not a chat action.
_ADVISORY_ACTIONS: frozenset[ActionType] = frozenset(
    {ActionType.VAULT_DEPOSIT, ActionType.AAVE_SUPPLY, ActionType.AERODROME_SWAP}
)

SYSTEM = (
    "You are the intent classifier for SparkPoint, a non-custodial DeFi assistant. "
    "Classify the user's latest message and extract parameters. Respond with a SINGLE "
    "JSON object and nothing else, using exactly these keys:\n"
    '  "kind": one of "recommend" (asking where/how to earn or for strategy ideas), '
    '"build_action" (a concrete command like \'deposit 100 USDC\'), "learn" (a concept '
    'question like \'what is APY?\'), "portfolio" (asking about their holdings/PnL), or '
    '"other".\n'
    '  "actionType": one of "vault_deposit", "aave_supply", "aerodrome_swap", or null.\n'
    '  "asset": "USDC", "ETH", or null.\n'
    '  "amount": the amount in RAW BASE UNITS as an integer string (USDC has 6 decimals, '
    "so 100 USDC = \"100000000\"), or null if the user gave no amount.\n"
    '  "maxSlippageBps": an integer basis-point slippage for swaps, or null.\n'
    '  "topic": a short snake_case concept key for "learn" (e.g. "what_is_apy"), or null.\n'
    "Never guess an amount the user did not state. Output JSON only."
)


class IntentKind(StrEnum):
    """The coarse intent that routes the deterministic DAG (plan.md ``understand``)."""

    RECOMMEND = "recommend"
    BUILD_ACTION = "build_action"
    LEARN = "learn"
    PORTFOLIO = "portfolio"
    OTHER = "other"


@dataclass(frozen=True)
class Intent:
    """The structured understanding of one user turn. Carries NO authority.

    ``refused`` marks a model refusal (the DAG emits a safe REFUSAL block). ``amount`` is
    raw base units (never a float) or ``None`` when the user stated none.
    """

    kind: IntentKind
    action_type: ActionType | None = None
    asset: Asset | None = None
    amount: int | None = None
    max_slippage_bps: int | None = None
    topic: str | None = None
    refused: bool = False


def _coerce_kind(raw: Any) -> IntentKind:
    """Map the model's ``kind`` to a known enum; anything unexpected → OTHER (fail-safe)."""
    try:
        return IntentKind(str(raw))
    except ValueError:
        return IntentKind.OTHER


def _coerce_action_type(raw: Any) -> ActionType | None:
    """Accept only an advisory-whitelisted action; drop anything else to ``None``."""
    if raw is None:
        return None
    try:
        action = ActionType(str(raw))
    except ValueError:
        return None
    return action if action in _ADVISORY_ACTIONS else None


def _coerce_asset(raw: Any) -> Asset | None:
    if raw is None:
        return None
    try:
        return Asset(str(raw))
    except ValueError:
        return None


def _coerce_amount(raw: Any) -> int | None:
    """Parse a raw base-unit integer; a non-integer / negative value is dropped to ``None``.

    Conservative on purpose: the DAG must ask the user for an amount rather than act on a
    fabricated one (non-custody). Floats are rejected outright to avoid base-unit drift.
    """
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw > 0 else None
    if isinstance(raw, str):
        text = raw.strip().replace("_", "")
        if not text.isdigit():
            return None
        value = int(text)
        return value if value > 0 else None
    return None


def _coerce_bps(raw: Any) -> int | None:
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, int):
        return raw if raw >= 0 else None
    if isinstance(raw, str) and raw.strip().isdigit():
        return int(raw.strip())
    return None


def _coerce_topic(raw: Any) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    return text or None


def _parse_intent(payload: Any) -> Intent:
    """Validate the model's JSON into an :class:`Intent` (raises on a non-object payload)."""
    if not isinstance(payload, dict):
        raise TypeError("intent payload must be a JSON object")
    return Intent(
        kind=_coerce_kind(payload.get("kind")),
        action_type=_coerce_action_type(payload.get("actionType")),
        asset=_coerce_asset(payload.get("asset")),
        amount=_coerce_amount(payload.get("amount")),
        max_slippage_bps=_coerce_bps(payload.get("maxSlippageBps")),
        topic=_coerce_topic(payload.get("topic")),
    )


@dataclass
class Planner:
    """The ``understand`` stage runner — one structured LLM turn per user message."""

    llm: AsyncClaudeClient
    effort: Effort = EFFORT

    async def classify(
        self, message: str, *, surface: str = "chat", user: str | None = None
    ) -> Intent:
        """Classify ``message`` into an :class:`Intent`, fail-closed.

        A refusal returns ``Intent(kind=OTHER, refused=True)``; unparseable output returns
        ``Intent(kind=OTHER)``. Either way the caller can never build an action from the
        turn — only a valid, whitelisted classification yields actionable params. ``user`` is
        the verified wallet (LiteLLM per-user budget/attribution key) — identity only, never
        authority.
        """
        user_content = f"surface={surface}\nmessage={message}"
        result = await self.llm.structured(
            system=SYSTEM,
            messages=[{"role": "user", "content": user_content}],
            parse=_parse_intent,
            effort=self.effort,
            user=user,
        )
        if result.refused:
            return Intent(kind=IntentKind.OTHER, refused=True)
        if not result.ok or result.value is None:
            return Intent(kind=IntentKind.OTHER)
        return result.value
