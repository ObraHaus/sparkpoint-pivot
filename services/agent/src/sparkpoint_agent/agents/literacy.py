"""Literacy — emit a non-signable, context-keyed TipCard (FR-007).

Grounding: spec.md FR-007 (financial-literacy tips); agent-service-api.md §2.7 (the
``tip`` ChatBlock). The literacy agent teaches a concept keyed by the planner's intent
topic (e.g. ``what_is_apy``). A :class:`TipCard` carries NO action and NO policy stamp —
it is structurally non-signable (the ``tip`` block has no ``proposedAction`` field), so
this agent can never surface something the user could sign.

Fail-closed: the model writes the body, but a refusal or an empty generation falls back
to a pre-written, safe default explanation — the user always gets a correct tip, never a
fabricated or empty one. Effort LOW (research.md §6 tiering; explanation is mechanical).

029 — the fallback now also covers a META-SHAPED generation. The 028 hotfix taught the
conversational agent to discard answers that talk about their own inputs, but the literacy path
kept its own copy of the fail-closed logic and so kept leaking: the Aug-3 battery watched a tip
card render "I don't have information about 'srktoken' in the reference notes provided". That
sentence tells a user two things they should never learn — that there are "reference notes", and
that the assistant is reasoning about its retrieval — and it does so in the confident voice of an
answer. The guard now lives in ``guard_text`` and BOTH paths import it.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from dataclasses import dataclass, field

from ..llm import AsyncClaudeClient, Effort
from .guard_text import is_unusable

EFFORT: Effort = "low"

_logger = logging.getLogger(__name__)


def _no_persona() -> str:
    """Default persona provider — no persona (preserves the exact pre-persona SYSTEM)."""
    return ""

FALLBACK_TOPIC = "general"

# Pre-written, safe fallbacks used when the model refuses or returns nothing. Keyed by the
# planner's snake_case topic. These never promise a return or give buy/sell advice.
DEFAULT_TIPS: dict[str, str] = {
    "what_is_apy": (
        "APY (annual percentage yield) is the yearly return on your deposit including "
        "compounding. It is an estimate based on current rates, not a guarantee — the "
        "real rate moves with the market."
    ),
    "what_is_a_vault": (
        "A vault is a smart contract that pools deposits and puts them to work in a "
        "strategy (here, lending USDC on Aave). You hold shares that represent your "
        "portion; you can withdraw your share on-chain at any time."
    ),
    "what_is_slippage": (
        "Slippage is the difference between the price you expect on a swap and the price "
        "you actually get, caused by the market moving as your trade executes. A max-"
        "slippage setting cancels the trade if it would move more than you allow."
    ),
    # 024/T024 — deliberately scoped to the vault the claim is TRUE of. Constitution v3.0.0
    # ratified Morpho Vault V2 Fee Wrappers, which keep no high-water-mark state, so an
    # unqualified "above your high-water mark" here would become false the moment one is
    # listed. This is a canned answer with no vault context available, so it names its subject
    # rather than generalising, and states the part that holds on every vault.
    "what_is_a_performance_fee": (
        "A performance fee is charged on gains, not on your deposit. On SparkPoint's Aave "
        "Yield Vault it is 10% of yield, charged only on profit above your high-water mark "
        "— 0% on your principal, and nothing at all in flat or down periods. It is taken as "
        "share dilution and never blocks your withdrawal. Each vault states its exact terms "
        "on its own screen before you sign, because how the fee accrues depends on that "
        "vault's contract."
    ),
    "what_is_non_custodial": (
        "Non-custodial means you always control your funds: SparkPoint holds no keys and "
        "cannot move your money. Every action is calldata your own wallet signs, and you "
        "can exit directly on-chain even if the app is offline."
    ),
    FALLBACK_TOPIC: (
        "SparkPoint is a non-custodial assistant: it can suggest and simulate strategies, "
        "but only you can sign a transaction, and you keep control of your funds at all "
        "times."
    ),
}

SYSTEM = (
    "You are SparkPoint's financial-literacy tutor. Explain the given DeFi concept in two "
    "or three plain sentences a beginner can follow. Define any jargon you use. Do NOT give "
    "buy/sell/allocation advice, do NOT promise or predict a specific return, and do NOT "
    "invent numbers. Output plain text only (no headings, no markdown)."
)


@dataclass(frozen=True)
class TipCard:
    """A literacy tip (FR-007). Non-signable by construction — no action, no policy stamp."""

    topic: str
    body: str
    #: 029/FR-014 — True when ``body`` is the pre-written default rather than a generated answer.
    #: The caller uses this to decide whether attaching the retrieved sources would be honest: a
    #: canned tip is not grounded in the passages that happened to be retrieved for the question.
    fell_back: bool = False


@dataclass
class Literacy:
    """The literacy stage runner — one prose LLM turn, fail-closed to a safe default."""

    llm: AsyncClaudeClient
    effort: Effort = EFFORT
    # Sparky's persona (``persona.get_persona`` in production; ``_no_persona`` in tests). Read at
    # CALL time so an operator's live persona reload propagates without a redeploy, while staying
    # byte-stable between reloads (it returns a memoised, process-stable string). Prepended to the
    # task SYSTEM — the only free-form prose surface, so this is where Sparky's voice shows.
    persona_provider: Callable[[], str] = field(default=_no_persona)

    def _system(self) -> str:
        """Persona FIRST (establishes character), task SYSTEM LAST (operational constraints
        closest to the user turn). Empty persona keeps the exact pre-persona SYSTEM."""
        persona = self.persona_provider().strip()
        return f"{persona}\n\n{SYSTEM}" if persona else SYSTEM

    async def tip(
        self, topic: str | None, *, context_hint: str | None = None, user: str | None = None
    ) -> TipCard:
        """Explain ``topic`` as a non-signable :class:`TipCard`, fail-closed.

        RETRIES ONCE before giving up (029, same rule as the general branch). The verification
        run caught "Is the Aave vault safe?" answering with the GENERIC fallback — "SparkPoint is
        a non-custodial assistant…" — which is true, unrelated, and reads as though the assistant
        did not understand the question. The model itself answered that topic correctly on every
        direct attempt, so a single degraded turn was being converted straight into a non-answer.

        Only a topic with its OWN pre-written default degrades silently: that default is a real
        answer to the question asked. A topic without one degrades to the general line and is
        marked ``fell_back`` so the caller can decline to dress it up with citations, and callers
        that can do better (the DAG's LEARN branch) surface an honest error instead.
        """
        key = (topic or FALLBACK_TOPIC).strip() or FALLBACK_TOPIC
        user_content = f"concept={key}"
        if context_hint:
            user_content = f"{user_content}\ncontext={context_hint}"
        for attempt in (1, 2):
            try:
                result = await self.llm.complete(
                    system=self._system(),
                    messages=[{"role": "user", "content": user_content}],
                    effort=self.effort,
                    user=user,
                )
            except Exception:
                # An upstream transport failure is a DEGRADED turn, not a crash. Sparky's prose
                # path already treats it that way; this one propagated, so a gateway blip on a
                # literacy turn tore down the whole SSE stream and the user got the generic
                # mid-stream failure block instead of an answer or an honest, retryable error.
                # (BaseException — e.g. a cancelled request — deliberately still propagates.)
                _logger.info("literacy_upstream_error topic=%s attempt=%d", key, attempt)
                continue
            body = result.text.strip()
            if not (result.refused or is_unusable(body)):
                return TipCard(topic=key, body=body, fell_back=False)
            if attempt == 1:
                _logger.info("literacy_retry: first tip attempt degraded for topic=%s", key)
        return TipCard(
            topic=key, body=DEFAULT_TIPS.get(key, DEFAULT_TIPS[FALLBACK_TOPIC]), fell_back=True
        )
