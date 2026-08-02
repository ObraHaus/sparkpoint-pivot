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

import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from ..llm import AsyncClaudeClient, Effort
from ..memory import CLASSIFIER_DIGEST_CHARS, render_digest
from ..policy import ActionType, Asset

# Bound the multi-turn context fed to the classifier (recent turns, each clamped) so the token
# window + attack surface stay small — history is disambiguation context, never authority.
_HISTORY_TURNS = 6
_HISTORY_CHARS = 300


def _render_history(history: Sequence[tuple[str, str]] | None) -> str:
    """Render the recent turns as a compact, delimited context block (empty when none)."""
    if not history:
        return ""
    lines = []
    for role, content in list(history)[-_HISTORY_TURNS:]:
        text = " ".join(str(content).split())[:_HISTORY_CHARS]
        speaker = "user" if role == "user" else "assistant"
        lines.append(f"{speaker}: {text}")
    return "recent_conversation:\n" + "\n".join(lines) + "\n"


def _render_memory(memory_lines: Sequence[str] | None) -> str:
    """Render the CROSS-conversation memory digest for the classifier (027), or "" when there is
    none — in which case the prompt is byte-identical to the pre-027 one.

    Tighter budget than the prose surface (:data:`CLASSIFIER_DIGEST_CHARS`): the classifier only
    needs enough to resolve a follow-up that reaches ACROSS conversations ("do that again", "the
    second option from yesterday"), and its prompt already carries the current thread's turns.
    Rendered here rather than clamped from an already-rendered block, so the untrusted-content
    fence can never be truncated open.

    BOUNDARY: this is NL-understanding context only. The classified :class:`Intent` still passes
    through the whitelist coercions below and then the deterministic, LLM-free policy gate — memory
    never reaches ``propose``, the gate, or ``/build-tx``.
    """
    return render_digest(memory_lines or (), max_chars=CLASSIFIER_DIGEST_CHARS)


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
    '  "asset": the token to act on — for a SWAP this is the token to swap FROM. "USDC", '
    '"ETH", or null.\n'
    '  "amount": the amount in RAW BASE UNITS as an integer string (USDC has 6 decimals, '
    "so 100 USDC = \"100000000\"), or null if the user gave no amount.\n"
    '  "maxSlippageBps": an integer basis-point slippage for swaps, or null.\n'
    '  "tokenOutAddress": for a swap INTO a specific token given by its contract address, the '
    '0x-prefixed 40-hex ERC-20 address (e.g. "0xabc…def"), or null. Use ONLY when the user '
    'pastes a contract address; for a plain "swap ETH to USDC" leave it null.\n'
    '  "topic": a short snake_case concept key for "learn" (e.g. "what_is_apy"), or null.\n'
    "Never guess an amount the user did not state. Never invent a contract address. "
    "Output JSON only."
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
    # Swaps only: a user-pasted receive-token address (007 · US4). The web re-reads it on-chain
    # (decimals authoritative) and treats a non-recommended token as unverified.
    token_out_addr: str | None = None
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


_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


def _coerce_address(raw: Any) -> str | None:
    """Validate a 0x-prefixed 20-byte hex address; anything else → ``None`` (fail-closed).

    Lower-cased for a stable wire value. This is a SYNTACTIC gate only — the web re-checksums and
    re-reads the token on-chain, so a malformed / hallucinated address is dropped here and the DAG
    falls back to the recommended pair rather than proposing a bogus token (non-custody).
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    return text.lower() if _ADDRESS_RE.match(text) else None


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
        token_out_addr=_coerce_address(payload.get("tokenOutAddress")),
        topic=_coerce_topic(payload.get("topic")),
    )


@dataclass
class Planner:
    """The ``understand`` stage runner — one structured LLM turn per user message."""

    llm: AsyncClaudeClient
    effort: Effort = EFFORT

    async def classify(
        self,
        message: str,
        *,
        surface: str = "chat",
        user: str | None = None,
        history: Sequence[tuple[str, str]] | None = None,
        memory_lines: Sequence[str] | None = None,
    ) -> Intent:
        """Classify ``message`` into an :class:`Intent`, fail-closed.

        A refusal returns ``Intent(kind=OTHER, refused=True)``; unparseable output returns
        ``Intent(kind=OTHER)``. Either way the caller can never build an action from the
        turn — only a valid, whitelisted classification yields actionable params. ``user`` is
        the verified wallet (LiteLLM per-user budget/attribution key) — identity only, never
        authority. ``history`` is the recent (role, content) turns — context so a follow-up
        ("yes, do that" / "the first one") classifies against the prior turn; it never grants
        authority and never bypasses the whitelist. ``memory_lines`` is the same idea across
        CONVERSATIONS (027): the user's rolling activity digest, so "do that again" in a brand-new
        chat still resolves. Both are advisory context with exactly the same standing — neither
        grants authority, and an empty/absent digest leaves this prompt byte-identical to pre-027.
        """
        context = _render_history(history)
        memory = _render_memory(memory_lines)
        if memory:
            memory = f"{memory}\n"
        user_content = f"surface={surface}\n{memory}{context}message={message}"
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
