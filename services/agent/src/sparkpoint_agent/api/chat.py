"""The §3.2 chat surface — ``POST /chat`` (SSE) + ``POST /chat/feedback``.

agent-service-api.md §3.2 — ``/chat`` is the primary conversational surface. It streams
a sequence of §2.7 ``ChatBlock``s produced by the deterministic Coordinator DAG
(``coordinator/dag.py``) as Server-Sent Events. The typical order is
``tool_step``(running) → ``tool_step``(done) → ``text`` / ``recommendation`` / ``tip`` /
``citation`` blocks, then a terminal ``done`` event carrying the conversation id + block
count.

Non-custody invariants this endpoint upholds (it is a thin transport over the DAG — it
adds NO authority of its own):

- **Never a signable bundle.** ``/chat`` only ever streams ``ProposedAction`` + a policy
  ``stamp``; materializing an ``IntentBundle`` is the single ``/build-tx`` chokepoint
  (§3.5), and the USER signs. This module has no code path that emits a signature or a
  bundle — the block union simply cannot represent one.
- **Signability rule (§2.7).** A ``recommendation`` / ``action`` block is signable ONLY
  when ``policy.status == "approved"``. That status is stamped upstream by the
  deterministic, LLM-free ``policy.evaluate`` (via ``CoordinatorDag.policy_gate``) and is
  serialized here verbatim — the endpoint never re-derives, upgrades, or invents it. An
  out-of-policy proposal arrives already stamped ``rejected`` (no ``checks``, a human
  ``reason``, no sign path) and is streamed exactly so.
- **Fail-closed streaming.** Malformed / refused LLM output is absorbed inside the DAG
  (the planner degrades to a safe intent, the recommender to no candidates), so the stream
  degrades to inert ``text`` / ``error`` blocks — never a fabricated action. Any unexpected
  error raised mid-stream (after the response has started, so the app exception handlers
  can no longer intercept it) is caught here and turned into a single inert ``error``
  block; a raw traceback or partial CoT can never reach the wire.
- **Summarized trace only.** The ``tool_step`` labels are the code-authored strings emitted
  by the DAG; the LLM client already drops ``thinking`` blocks, so no raw chain-of-thought
  is ever framed onto the SSE stream.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Annotated, Any, Literal, Protocol

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..agents.literacy import Literacy
from ..agents.planner import Planner
from ..agents.recommender import Recommender
from ..coordinator import (
    ChainContext,
    ChatBlock,
    CoordinatorDag,
    ErrorBlock,
    MandateView,
    PortfolioView,
)
from ..knowledge import default_citation_retriever, default_grounder
from ..llm import AsyncClaudeClient, ClaudeAuthError
from .errors import ApiError, ErrorCode
from .security import AccountContext
from .vault import get_account

router = APIRouter(tags=["chat"])

# The §3.2 SSE content type + the two event names the frontend seam consumes.
SSE_MEDIA_TYPE = "text/event-stream"
_EVENT_BLOCK = "block"
_EVENT_DONE = "done"

# The surfaces the web tier may hint (§3.2). ``chat`` is the default; the hint only tunes
# the planner's NL understanding — it never grants authority or changes the safety path.
Surface = Literal["chat", "strategy", "vault", "portfolio"]

# A single, non-leaking message for a mid-stream failure. It carries no internals and no
# sign path — the client shows an inert error and can retry (§3.2 UPSTREAM_UNAVAILABLE).
_STREAM_FAILURE_MESSAGE = (
    "The assistant hit a problem completing that turn. Nothing was signed or changed — "
    "please try again."
)


def _new_conversation_id() -> str:
    """A fresh conversation correlation id when the caller omitted one (§3.2)."""
    return f"cnv_{uuid.uuid4().hex}"


def _sse(event: str, data: dict[str, Any]) -> str:
    """Frame one SSE event: ``event: <name>`` + a single-line ``data:`` JSON payload.

    ``json.dumps`` escapes any embedded newline (e.g. inside a ``text`` block's markdown)
    to ``\\n``, so the ``data:`` value is always exactly one line — the SSE record stays
    well-formed. The blank line terminates the event.
    """
    payload = json.dumps(data, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


# ─────────────────────────────────────────────────────────────────────────────
# Request models (camelCase = the exact §3.2 wire shape).
# ─────────────────────────────────────────────────────────────────────────────


class ChatTurnContext(BaseModel):
    """§3.2 ``context`` — the UI ``surface`` hint (defaults to ``chat``)."""

    surface: Surface = "chat"


class ChatRequest(BaseModel):
    """§3.2 ``POST /chat`` body. ``conversationId`` is echoed back (or minted if omitted)."""

    message: str = Field(min_length=1)
    conversationId: str | None = None
    context: ChatTurnContext | None = None
    clientTime: str | None = None


class FeedbackRequest(BaseModel):
    """§3.2 ``POST /chat/feedback`` body — a thumbs signal on one streamed block."""

    conversationId: str
    blockId: str
    rating: Literal["up", "down"]


# ─────────────────────────────────────────────────────────────────────────────
# Injected seams (overridden in tests; wired to real reads/DB in prod).
# ─────────────────────────────────────────────────────────────────────────────


class ChatChainProvider(Protocol):
    """Builds the per-request :class:`ChainContext` (scoping + fresh chain reads).

    The headers scope reads only — never authority to move funds (§1.2). A production
    implementation resolves the deployed targets, fresh cap headroom, market data and a
    fresh swap simulation; the default here supplies scoping only (targets/caps empty),
    which fails CLOSED — no candidate can resolve a target, so nothing is surfaced as
    signable until the real reads are wired.
    """

    async def context(self, account: AccountContext, *, surface: str) -> ChainContext: ...


class FeedbackSink(Protocol):
    """Persists a thumbs signal (FR feedback). The default is a no-op until the DB is wired."""

    async def record(
        self, *, conversation_id: str, block_id: str, rating: str, account: AccountContext
    ) -> None: ...


class _ScopingOnlyChainProvider:
    """Default :class:`ChatChainProvider` — scoping only, fail-closed (no resolved targets).

    With no resolved targets the recommender's ``build_action`` cannot resolve a whitelisted
    address, so every proposal drops out and ``/chat`` surfaces only safe read/tip/text
    blocks. Later waves inject a provider that adds fresh targets/caps/market/sim so real
    (still policy-gated) recommendations can surface.
    """

    async def context(self, account: AccountContext, *, surface: str) -> ChainContext:
        return ChainContext(
            chain_id=account.chain_id,
            user_account=account.account,
            owner=account.owner,
        )


class _NoopFeedbackSink:
    """Default :class:`FeedbackSink` — accepts + drops the signal until persistence is wired."""

    async def record(
        self, *, conversation_id: str, block_id: str, rating: str, account: AccountContext
    ) -> None:
        return None


class _EmptyPortfolioProvider:
    """Default portfolio read — an empty (nothing-known) view, never a fabricated balance."""

    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView()


class _NoMandateProvider:
    """Default mandate read — ``None`` (not onboarded) until the DB is wired."""

    async def active(self, chain: ChainContext) -> MandateView | None:
        return None


# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────


def get_coordinator_dag() -> CoordinatorDag:
    """Build the deterministic advisory DAG from the process config (overridden in tests).

    The three agents share one async Claude client (NL understanding + rationale only —
    never the safety decision); the read providers default to fail-closed stubs the later
    waves replace. A missing credential surfaces as a clean pre-stream
    ``UPSTREAM_UNAVAILABLE`` (§1.6), never a half-built stream.
    """
    try:
        client = AsyncClaudeClient.from_env()
    except ClaudeAuthError as exc:
        raise ApiError(
            ErrorCode.UPSTREAM_UNAVAILABLE,
            "The assistant model is not configured; chat is temporarily unavailable.",
        ) from exc
    return CoordinatorDag(
        planner=Planner(llm=client),
        # The Obsidian citation retriever is wired when a real embedding backend is configured
        # (EMBEDDING_OPENAI_*); otherwise None → no corpus citations (fail-open, never fabricated).
        recommender=Recommender(llm=client, knowledge=default_citation_retriever()),
        literacy=Literacy(llm=client),
        portfolio_provider=_EmptyPortfolioProvider(),
        mandate_provider=_NoMandateProvider(),
        # The Obsidian GROUNDER — feeds corpus passages into the LEARN/OTHER prose answers so Sparky
        # answers FROM the second brain (with citations). Active only when EMBEDDING_OPENAI_* is
        # set; None ⇒ ungrounded prose. Passage text never reaches the policy/action path.
        knowledge=default_grounder(),
    )


def get_chain_provider() -> ChatChainProvider:
    """The per-request :class:`ChainContext` builder (overridden in tests)."""
    return _ScopingOnlyChainProvider()


def get_feedback_sink() -> FeedbackSink:
    """The thumbs-feedback persistence seam (overridden in tests)."""
    return _NoopFeedbackSink()


# ─────────────────────────────────────────────────────────────────────────────
# SSE stream
# ─────────────────────────────────────────────────────────────────────────────


async def _event_stream(
    dag: CoordinatorDag,
    message: str,
    chain: ChainContext,
    *,
    surface: str,
    conversation_id: str,
) -> AsyncIterator[str]:
    """Drive one ``run_chat`` turn and frame each §2.7 block as an SSE ``block`` event.

    Terminates with a ``done`` event carrying ``{conversationId, blockCount}``. Any
    unexpected error mid-stream (which the app exception handlers can no longer catch,
    the response having already started) degrades to a single inert ``error`` block so a
    traceback or partial output can never reach the wire — fail-closed, non-custody.
    """
    count = 0
    try:
        async for block in dag.run_chat(message, chain, surface=surface):
            count += 1
            yield _sse(_EVENT_BLOCK, block.to_wire())
    except Exception:
        # Fail-closed: degrade to an inert block, never leak internals (BaseException — e.g.
        # a cancelled request — deliberately propagates untouched).
        fallback: ChatBlock = ErrorBlock("UPSTREAM_UNAVAILABLE", _STREAM_FAILURE_MESSAGE)
        count += 1
        yield _sse(_EVENT_BLOCK, fallback.to_wire())
    yield _sse(_EVENT_DONE, {"conversationId": conversation_id, "blockCount": count})


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/chat")
async def chat(
    body: ChatRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    dag: Annotated[CoordinatorDag, Depends(get_coordinator_dag)],
    chain_provider: Annotated[ChatChainProvider, Depends(get_chain_provider)],
) -> StreamingResponse:
    """Primary conversational surface — stream §2.7 ChatBlocks as SSE (agent-service-api.md §3.2).

    Emits ``event: block`` records (``tool_step`` → ``text`` / ``recommendation`` / ``tip`` /
    ``citation`` / ``action`` / ``error``) then a terminal ``event: done``. NEVER returns a
    signable bundle: a ``recommendation`` / ``action`` block carries only a ``ProposedAction``
    + a policy ``stamp`` (signable iff ``policy.status == "approved"``, stamped by the
    LLM-free gate); the user must call ``/build-tx`` (§3.5) to materialize an ``IntentBundle``.
    """
    surface: str = body.context.surface if body.context is not None else "chat"
    conversation_id = body.conversationId or _new_conversation_id()
    # Built before streaming so a read failure surfaces as a clean pre-stream §1.5 envelope.
    chain = await chain_provider.context(account, surface=surface)
    stream = _event_stream(
        dag, body.message, chain, surface=surface, conversation_id=conversation_id
    )
    return StreamingResponse(
        stream,
        media_type=SSE_MEDIA_TYPE,
        # Keep proxies/browsers from buffering or caching the token-by-token stream.
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat/feedback", status_code=204)
async def chat_feedback(
    body: FeedbackRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    sink: Annotated[FeedbackSink, Depends(get_feedback_sink)],
) -> Response:
    """Record a thumbs signal on a streamed block (agent-service-api.md §3.2). Returns 204.

    A feedback signal is advisory telemetry only — it carries no authority and never
    mutates a proposal or its policy stamp.
    """
    await sink.record(
        conversation_id=body.conversationId,
        block_id=body.blockId,
        rating=body.rating,
        account=account,
    )
    return Response(status_code=204)
