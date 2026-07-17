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
from ..chain import VaultReader, VaultUnavailable
from ..config import AgentConfig
from ..coordinator import (
    ChainContext,
    ChatBlock,
    CoordinatorDag,
    ErrorBlock,
    MandateProvider,
    PortfolioView,
    PositionLite,
)
from ..db import get_database
from ..db.conversations import ConversationStore
from ..knowledge import default_citation_retriever, default_grounder
from ..llm import AsyncClaudeClient, ClaudeAuthError
from .errors import ApiError, ErrorCode
from .recommendations import (
    _build_chain_context,
    _read_gate_inputs,
    get_agent_config,
    get_mandate_provider,
)
from .security import AccountContext
from .vault import get_account, get_vault_reader

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


class _VaultChatChainProvider:
    """The REAL :class:`ChatChainProvider` — reads fresh cap headroom + fee and resolves the
    deployed vault target, so a whitelisted action (e.g. a first deposit on 84532) can build and
    be policy-gated in chat (identical assembly to ``/recommendations``: ``_read_gate_inputs`` +
    ``_build_chain_context``). Fail-closed: a :class:`VaultUnavailable` degrades to ``data_stale``,
    never a fabricated headroom. The headers scope reads only — never authority to move funds."""

    def __init__(self, reader: VaultReader, config: AgentConfig) -> None:
        self._reader = reader
        self._config = config

    async def context(self, account: AccountContext, *, surface: str) -> ChainContext:
        caps, fee_bps, stale = await _read_gate_inputs(self._reader, account)
        return _build_chain_context(account, self._config, caps, fee_bps, stale)


class _NoopFeedbackSink:
    """Default :class:`FeedbackSink` — accepts + drops the signal until persistence is wired."""

    async def record(
        self, *, conversation_id: str, block_id: str, rating: str, account: AccountContext
    ) -> None:
        return None


def _fmt_units(raw: int, decimals: int) -> str:
    """Format raw base units as a fixed-2-decimal string (exact, integer-only — never a float)."""
    scale = 10**decimals
    whole, frac = divmod(max(0, raw), scale)
    cents = (frac * 100) // scale
    return f"{whole:,}.{cents:02d}"


class _VaultChatPortfolioProvider:
    """The REAL chat portfolio read — the owner's vault position (shares → underlying value) plus
    the idle USDC in their wallet, straight from chain via :class:`VaultReader`. Fail-closed: a
    :class:`VaultUnavailable` degrades to an empty ``stale`` view, never a fabricated balance."""

    def __init__(self, reader: VaultReader, config: AgentConfig) -> None:
        self._reader = reader
        self._config = config

    async def read(self, chain: ChainContext) -> PortfolioView:
        owner = chain.owner or chain.user_account
        try:
            shares = await self._reader.balance_of(owner)
            vault_assets = await self._reader.convert_to_assets(shares) if shares else 0
            asset_addr = await self._reader.asset()
            idle = await self._reader.token_balance_of(asset_addr, owner)
        except VaultUnavailable:
            return PortfolioView(stale=True)
        positions: list[PositionLite] = []
        if shares > 0:
            positions.append(
                PositionLite(
                    venue="SparkPoint Vault",
                    asset="USDC",
                    value_usd=_fmt_units(vault_assets, 6),
                    # The vault's share token is 6-dp (ERC-4626 share decimals == the USDC asset's).
                    shares=_fmt_units(shares, 6),
                    underlying="USDC",
                    price_source="ERC-4626 convertToAssets",
                    risk_tier="conservative",
                )
            )
        # Idle wallet USDC is a real, spendable holding — surface it as its own row so the
        # portfolio_snapshot card matches the "you also have $X idle USDC" summary line (the card
        # previously showed only the vault position, which read as "where's my idle balance?").
        if idle > 0:
            positions.append(
                PositionLite(
                    venue="Wallet (idle)",
                    asset="USDC",
                    value_usd=_fmt_units(idle, 6),
                    underlying="USDC",
                    price_source="wallet balance",
                )
            )
        # net worth = vault value + idle wallet USDC (both 6dp USDC); ETH excluded (no USD feed).
        net = _fmt_units(vault_assets + idle, 6)
        return PortfolioView(
            positions=tuple(positions), net_worth_usd=net, idle_usdc=idle, stale=False
        )


# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────


def get_coordinator_dag(
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    mandate_provider: Annotated[MandateProvider, Depends(get_mandate_provider)],
) -> CoordinatorDag:
    """Build the deterministic advisory DAG from the process config (overridden in tests).

    The three agents share one async Claude client (NL understanding + rationale only — never the
    safety decision). The read providers are now REAL: the portfolio reads the owner's vault
    position + idle USDC from chain; the mandate reads the DB-backed active mandate (same store the
    §3.1 endpoints write). A missing credential surfaces as a clean pre-stream
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
        portfolio_provider=_VaultChatPortfolioProvider(reader, config),
        mandate_provider=mandate_provider,
        # The Obsidian GROUNDER — feeds corpus passages into the LEARN/OTHER prose answers so Sparky
        # answers FROM the second brain (with citations). Active only when EMBEDDING_OPENAI_* is
        # set; None ⇒ ungrounded prose. Passage text never reaches the policy/action path.
        knowledge=default_grounder(),
    )


def get_chain_provider(
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
) -> ChatChainProvider:
    """The per-request :class:`ChainContext` builder — REAL (resolves the deployed vault target +
    fresh caps/fee) so whitelisted actions can build in chat. Overridden in tests."""
    return _VaultChatChainProvider(reader, config)


def get_feedback_sink() -> FeedbackSink:
    """The thumbs-feedback persistence seam (overridden in tests)."""
    return _NoopFeedbackSink()


class _ConversationSink:
    """FAIL-OPEN per-wallet conversation persistence (B1). Every method swallows DB errors so a
    persistence outage (or a test with no DB) degrades to no history — it NEVER breaks a chat turn
    or sits on the response path (non-custody). Overridden with a no-op in the chat tests."""

    def __init__(self, store: ConversationStore) -> None:
        self._store = store

    async def resolve(self, owner_eoa: str, conversation_id: str | None, first_message: str) -> str:
        try:
            cid = await self._store.ensure_conversation(
                owner_eoa=owner_eoa, conversation_id=conversation_id, first_message=first_message
            )
            return str(cid)
        except Exception:
            return conversation_id or _new_conversation_id()

    async def history(self, conversation_id: str) -> list[tuple[str, str]]:
        try:
            return await self._store.recent_history(_uuid(conversation_id))
        except Exception:
            return []

    async def record(self, conversation_id: str, role: str, content: str) -> None:
        if not content:
            return
        try:
            await self._store.append_turn(_uuid(conversation_id), role, content)
        except Exception:
            return


class _NoopConversationSink(_ConversationSink):
    """Default in tests — no persistence, no history (chat behaves exactly as before B1)."""

    def __init__(self) -> None:  # noqa: D401 — deliberately skips the store
        pass

    async def resolve(self, owner_eoa: str, conversation_id: str | None, first_message: str) -> str:
        return conversation_id or _new_conversation_id()

    async def history(self, conversation_id: str) -> list[tuple[str, str]]:
        return []

    async def record(self, conversation_id: str, role: str, content: str) -> None:
        return None


def _uuid(value: str) -> Any:
    from uuid import UUID

    return UUID(value)


def get_conversation_sink() -> _ConversationSink:
    """The per-wallet conversation-history sink (fail-open Pg-backed; overridden in tests)."""
    return _ConversationSink(ConversationStore(get_database()))


# ─────────────────────────────────────────────────────────────────────────────
# SSE stream
# ─────────────────────────────────────────────────────────────────────────────


def _assistant_summary(block_wire: dict[str, Any]) -> str:
    """A compact, content-only text fragment for a streamed block — the assistant-turn memory
    (never raw CoT / never a re-serialized card). Empty for tool-step/citation/error scaffolding."""
    t = block_wire.get("type")
    if t in ("text", "tip"):
        return str(
            block_wire.get("markdown") or block_wire.get("body") or block_wire.get("text") or ""
        )
    if t == "recommendation":
        return f"[recommended: {block_wire.get('title', 'a strategy')}]"
    if t == "action":
        pa = block_wire.get("proposedAction") or {}
        return f"[proposed action: {pa.get('type', 'action')}]"
    if t == "portfolio_snapshot":
        return "[showed your portfolio]"
    return ""


async def _event_stream(
    dag: CoordinatorDag,
    message: str,
    chain: ChainContext,
    *,
    surface: str,
    conversation_id: str,
    history: list[tuple[str, str]],
    sink: _ConversationSink,
    owner_eoa: str,
) -> AsyncIterator[str]:
    """Drive one ``run_chat`` turn and frame each §2.7 block as an SSE ``block`` event.

    Terminates with a ``done`` event carrying ``{conversationId, blockCount}``. Any
    unexpected error mid-stream (which the app exception handlers can no longer catch,
    the response having already started) degrades to a single inert ``error`` block so a
    traceback or partial output can never reach the wire — fail-closed, non-custody. The user
    turn + a compact assistant summary are persisted (fail-open) for multi-turn history.
    """
    # Persist the user's turn up front (fail-open) so history survives even a mid-stream failure.
    await sink.record(conversation_id, "user", message)
    count = 0
    summary_parts: list[str] = []
    try:
        async for block in dag.run_chat(message, chain, surface=surface, history=history):
            count += 1
            wire = block.to_wire()
            frag = _assistant_summary(wire)
            if frag:
                summary_parts.append(frag)
            yield _sse(_EVENT_BLOCK, wire)
    except Exception:
        # Fail-closed: degrade to an inert block, never leak internals (BaseException — e.g.
        # a cancelled request — deliberately propagates untouched).
        fallback: ChatBlock = ErrorBlock("UPSTREAM_UNAVAILABLE", _STREAM_FAILURE_MESSAGE)
        count += 1
        yield _sse(_EVENT_BLOCK, fallback.to_wire())
    await sink.record(conversation_id, "assistant", " ".join(summary_parts).strip())
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
    sink: Annotated[_ConversationSink, Depends(get_conversation_sink)],
) -> StreamingResponse:
    """Primary conversational surface — stream §2.7 ChatBlocks as SSE (agent-service-api.md §3.2).

    Emits ``event: block`` records (``tool_step`` → ``text`` / ``recommendation`` / ``tip`` /
    ``citation`` / ``action`` / ``error``) then a terminal ``event: done``. NEVER returns a
    signable bundle: a ``recommendation`` / ``action`` block carries only a ``ProposedAction``
    + a policy ``stamp`` (signable iff ``policy.status == "approved"``, stamped by the
    LLM-free gate); the user must call ``/build-tx`` (§3.5) to materialize an ``IntentBundle``.
    """
    surface: str = body.context.surface if body.context is not None else "chat"
    # Resolve (or create) the caller's conversation + fetch bounded prior turns for multi-turn
    # context — both fail-open (persistence never blocks a chat turn). Ownership is enforced in the
    # sink: a mismatched/foreign conversationId yields a fresh conversation, never an append into
    # someone else's thread.
    conversation_id = await sink.resolve(account.owner, body.conversationId, body.message)
    history = await sink.history(conversation_id)
    # Built before streaming so a read failure surfaces as a clean pre-stream §1.5 envelope.
    chain = await chain_provider.context(account, surface=surface)
    stream = _event_stream(
        dag,
        body.message,
        chain,
        surface=surface,
        conversation_id=conversation_id,
        history=history,
        sink=sink,
        owner_eoa=account.owner,
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
