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
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

from ..llm import AsyncClaudeClient, Effort
from .guard_text import is_unusable, prefix_is_usable

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
    # 029 — the two topics the verification run watched degrade into the generic line. Both have
    # stable, knowable answers, and one of them is the EXIT PATH: a user asking how to get their
    # money out must never be met with a shrug, whatever the model is doing.
    "how_to_withdraw": (
        "You can withdraw at any time — there is no lock-up and no notice period. Open the Vault "
        "page, choose Withdraw, enter an amount (or take everything), and sign in your wallet. "
        "The vault is an ERC-4626 contract, so redeeming is a direct on-chain call: it works even "
        "if the SparkPoint app is offline, and nobody can stop or delay it. You are charged 0% to "
        "withdraw and 0% on your principal."
    ),
    "vault_safety": (
        "The SparkPoint vault is non-custodial: it holds your USDC in a smart contract that only "
        "you can withdraw from, and it supplies that USDC to Aave v3 to earn yield. The real "
        "risks are smart-contract risk (in the vault and in Aave), and a variable rate that can "
        "fall. Deposits are not insured and returns are not guaranteed. What is guaranteed is "
        "control: SparkPoint holds no keys and cannot move your funds."
    ),
    FALLBACK_TOPIC: (
        "SparkPoint is a non-custodial assistant: it can suggest and simulate strategies, "
        "but only you can sign a transaction, and you keep control of your funds at all "
        "times."
    ),
}

#: Keyword → pre-written topic, for the model-authored slugs we cannot enumerate. The planner
#: invents topic keys freely (``aave_vault_safety``, ``how_to_withdraw``, ``is_aave_vault_safe``),
#: so an exact-key lookup misses almost every real one. Ordered: first match wins.
_TOPIC_ALIASES: tuple[tuple[str, str], ...] = (
    ("withdraw", "how_to_withdraw"),
    ("redeem", "how_to_withdraw"),
    ("exit", "how_to_withdraw"),
    ("safe", "vault_safety"),
    ("safety", "vault_safety"),
    ("risk", "vault_safety"),
    ("apy", "what_is_apy"),
    ("slippage", "what_is_slippage"),
    ("custod", "what_is_non_custodial"),
    ("performance_fee", "what_is_a_performance_fee"),
    ("vault", "what_is_a_vault"),
)


def default_tip(topic: str) -> str:
    """The best pre-written answer for ``topic`` — exact key, then keyword, then the general line.

    029: an exact-key lookup missed nearly every real topic, because the planner writes its own
    slugs. The verification run caught "How do I withdraw everything?" degrading to the generic
    "SparkPoint is a non-custodial assistant…" line — a shrug, on the exit path.
    """
    if topic in DEFAULT_TIPS:
        return DEFAULT_TIPS[topic]
    lowered = topic.lower()
    for needle, key in _TOPIC_ALIASES:
        if needle in lowered:
            return DEFAULT_TIPS[key]
    return DEFAULT_TIPS[FALLBACK_TOPIC]


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


@dataclass(frozen=True)
class TipChunk:
    """One event from :meth:`Literacy.stream_tip` — a text delta or the terminal card.

    ``attempt`` is 1-based and lets the transport surface a NEW stream id when the first attempt
    degraded and a retry starts, so the client replaces the partial text instead of appending a
    second answer to it. The terminal card is authoritative.
    """

    delta: str | None = None
    card: TipCard | None = None
    attempt: int = 1


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

    def _user_content(self, key: str, context_hint: str | None) -> str:
        """The user turn exactly as :meth:`tip` builds it (shared by the streaming path)."""
        user_content = f"concept={key}"
        if context_hint:
            user_content = f"{user_content}\ncontext={context_hint}"
        return user_content

    async def stream_tip(
        self, topic: str | None, *, context_hint: str | None = None, user: str | None = None
    ) -> AsyncIterator[TipChunk]:
        """Stream the tip body as deltas, then yield the SAME fail-closed :class:`TipCard`.

        Mirrors :meth:`tip` (including the single retry) but emits deltas while the model writes.
        The full body still passes the shared ``is_unusable`` guard, so a meta/action-shaped
        generation is discarded and the caller's terminal card replaces the streamed text. A
        retry is tagged with a new ``attempt`` so the client RESETS rather than concatenates.
        """
        key = (topic or FALLBACK_TOPIC).strip() or FALLBACK_TOPIC
        if not hasattr(self.llm, "stream_complete"):
            yield TipChunk(card=await self.tip(topic, context_hint=context_hint, user=user))
            return
        user_content = self._user_content(key, context_hint)
        for attempt in (1, 2):
            parts: list[str] = []
            pending: list[str] = []
            released = False
            blocked = False
            result = None
            try:
                async for chunk in self.llm.stream_complete(
                    system=self._system(),
                    messages=[{"role": "user", "content": user_content}],
                    effort=self.effort,
                    user=user,
                ):
                    if chunk.delta:
                        parts.append(chunk.delta)
                        # Hold the opening until it passes the same guard the full body will, so
                        # an attempt whose opening is already action/meta-shaped is never painted.
                        # A later-unusable body may paint; the terminal card replaces it.
                        if not released and not blocked:
                            pending.append(chunk.delta)
                            # 063 — release the opening as soon as it exists and passes the
                            # guard. The 059 char-count hold buffered a short/slow answer until
                            # the model finished; the terminal card still replaces any paint.
                            if not prefix_is_usable("".join(pending)):
                                blocked = True
                                pending.clear()
                                continue
                            released = True
                            for buffered in pending:
                                yield TipChunk(delta=buffered, attempt=attempt)
                            pending.clear()
                            continue
                        if not blocked:
                            yield TipChunk(delta=chunk.delta, attempt=attempt)
                    elif chunk.result is not None:
                        result = chunk.result
            except Exception:
                _logger.info("literacy_upstream_error topic=%s attempt=%d", key, attempt)
                continue
            body = result.text.strip() if result is not None else ""
            if result is not None and not (result.refused or is_unusable(body)):
                # A short (< hold) answer is painted only now that the FULL body passed the guard.
                if not released and not blocked:
                    for buffered in pending:
                        yield TipChunk(delta=buffered, attempt=attempt)
                yield TipChunk(card=TipCard(topic=key, body=body, fell_back=False), attempt=attempt)
                return
            if attempt == 1:
                _logger.info("literacy_retry: first tip attempt degraded for topic=%s", key)
        yield TipChunk(card=TipCard(topic=key, body=default_tip(key), fell_back=True))

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
        user_content = self._user_content(key, context_hint)
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
        return TipCard(topic=key, body=default_tip(key), fell_back=True)
