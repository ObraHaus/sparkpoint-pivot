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
import logging
import os
import uuid
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from typing import Annotated, Any, Literal, Protocol

from fastapi import APIRouter, Depends, Response
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..activity_fold import ActivityFolder, fold_activity
from ..agents.literacy import Literacy
from ..agents.planner import Planner
from ..agents.recommender import Recommender
from ..agents.sparky import Sparky
from ..chain import VaultReader, VaultUnavailable
from ..chain.faucet_probe import FaucetProbe
from ..config import (
    SPARKY_SINGLE_CALL_ENV,
    SPARKY_STREAMING_ENV,
    AgentConfig,
    env_flag,
)
from ..coordinator import (
    ChainContext,
    ChatBlock,
    CoordinatorDag,
    ErrorBlock,
    MandateProvider,
    PortfolioView,
    PositionLite,
    ProseDelta,
    TokenBalanceLite,
)
from ..coordinator.curated import CuratedContext, CuratedPick
from ..data.prices import get_price_service
from ..db import LimitsStore, get_database
from ..db.content_entries import ContentEntryStore
from ..db.conversations import ConversationStore
from ..db.curated_vaults import APPROVED, PgCurationStore
from ..db.executions import ExecutionStore
from ..db.swap_fees import PgSwapFeeEventStore
from ..db.user_memory import MemoryStore
from ..db.vault_flows import VaultFlowReader
from ..db.wrapper_whitelist import PgWhitelistStore
from ..knowledge import KnowledgeRetriever, default_citation_retriever
from ..llm import AsyncClaudeClient, ClaudeAuthError
from ..memory import derive_memory_lines
from ..persona import get_persona
from .curated_vaults import public_board
from .errors import ApiError, ErrorCode
from .portfolio import get_wrapper_store, read_wrapper_positions
from .quota import LimitDecision, get_limits_store, refund, require_within_quota
from .recommendations import (
    _build_chain_context,
    _network_id,
    _read_aave_gross_bps,
    _read_gate_inputs,
    get_agent_config,
    get_mandate_provider,
)
from .security import AccountContext
from .vault import get_account, get_vault_reader

router = APIRouter(tags=["chat"])

# The §3.2 SSE content type + the event names the frontend seam consumes.
SSE_MEDIA_TYPE = "text/event-stream"
_EVENT_BLOCK = "block"
_EVENT_DONE = "done"
#: 059/A2 — incremental prose deltas. ADDITIVE: the final ``block`` event still carries the whole
#: ``text`` / ``tip`` block for compatibility + persistence, so a client that ignores this event
#: (or a proxy that drops it) behaves exactly as before.
_EVENT_TEXT_DELTA = "text-delta"

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
        # 029/FR-006 — read the LIVE Aave gross rate here too. Chat previously omitted it, so
        # `chain.market.gross_apy_bps` was always None and "what's the current APY?" could only
        # ever answer "I can't read it right now" — while /recommendations, one call away, was
        # quoting 0.44%. Best-effort and non-raising by contract: an unreadable rate stays None
        # and the answer stays honest rather than fabricated.
        gross_bps = await _read_aave_gross_bps(self._config)
        return _build_chain_context(
            account, self._config, caps, fee_bps, stale, gross_bps=gross_bps
        )


class _NoopFeedbackSink:
    """Default :class:`FeedbackSink` — accepts + drops the signal until persistence is wired."""

    async def record(
        self, *, conversation_id: str, block_id: str, rating: str, account: AccountContext
    ) -> None:
        return None


def _fmt_units(raw: int, decimals: int) -> str:
    """Format raw base units as a **separator-free** fixed-2-decimal string (exact, integer-only,
    never a float). No thousands comma: the shared wire ``UsdStringSchema`` rejects grouping commas,
    so a ``valueUsd`` >= $1,000 formatted with a comma (e.g. ``10,000.00``) fails validation and
    renders the whole portfolio_snapshot card inert. The client adds grouping for display."""
    scale = 10**decimals
    whole, frac = divmod(max(0, raw), scale)
    cents = (frac * 100) // scale
    return f"{whole}.{cents:02d}"


class _VaultChatPortfolioProvider:
    """The REAL chat portfolio read — the owner's vault position (shares → underlying value) plus
    the idle USDC in their wallet, straight from chain via :class:`VaultReader`. Fail-closed: a
    :class:`VaultUnavailable` degrades to an empty ``stale`` view, never a fabricated balance."""

    def __init__(
        self,
        reader: VaultReader,
        config: AgentConfig,
        wrapper_store: PgWhitelistStore | None = None,
    ) -> None:
        self._reader = reader
        self._config = config
        self._wrapper_store = wrapper_store

    async def read(self, chain: ChainContext) -> PortfolioView:
        owner = chain.owner or chain.user_account
        # 053 — a chain WITHOUT the launch vault (the Robinhood Chain beta) still has a real
        # portfolio: the idle stable + every whitelisted curated wrapper the wallet holds. The
        # launch read there would degrade to an empty stale view and hide the user's funds from
        # the AI — exactly what "the AI can see it too" is for.
        if not self._config.vault_address:
            return await self._read_wrapper_portfolio(chain, owner)
        try:
            shares = await self._reader.balance_of(owner)
            vault_assets = await self._reader.convert_to_assets(shares) if shares else 0
            asset_addr = await self._reader.asset()
            idle = await self._reader.token_balance_of(asset_addr, owner)
        except VaultUnavailable:
            return PortfolioView(stale=True)
        # 029/FR-004 — the WALLET side of "what's in my wallet?". Read AFTER the vault reads and
        # each in its own try: a native or SRK read outage must degrade that one line to silence,
        # never blank out the position the user actually asked about. No USD valuation is applied
        # (no price feed for ETH or SRK), so these never touch net_worth_usd.
        native_wei: int | None = None
        try:
            native_wei = await self._reader.native_balance(owner)
        except VaultUnavailable:
            _warn_once("chat_native_balance_unavailable")
        tokens = await self._notable_tokens(chain, owner)
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
            positions=tuple(positions),
            net_worth_usd=net,
            idle_usdc=idle,
            stale=False,
            native_wei=native_wei,
            native_symbol=_native_symbol(chain.chain_id),
            tokens=tokens,
        )

    async def _read_wrapper_portfolio(self, chain: ChainContext, owner: str) -> PortfolioView:
        """053 — the beta portfolio: idle stable + held curated wrappers, read directly over RPC."""
        stable = self._config.stable_token_address
        idle = 0
        stale = False
        if stable:
            try:
                idle = await self._reader.token_balance_of(stable, owner)
            except VaultUnavailable:
                stale = True
        wrappers, wrappers_stale, _block = await read_wrapper_positions(
            self._reader, self._wrapper_store, chain.chain_id, owner, stable
        )
        symbol = _stable_symbol(chain.chain_id)
        positions: list[PositionLite] = []
        for w in wrappers:
            positions.append(
                PositionLite(
                    venue=w.label,
                    asset=symbol if w.par else w.asset_address,
                    value_usd=_fmt_units(w.underlying, 6) if w.par else "0.00",
                    shares=_fmt_units(w.shares, w.share_decimals),
                    underlying=symbol if w.par else w.asset_address,
                    price_source="ERC-4626 convertToAssets" if w.par else "unpriced",
                )
            )
        if idle > 0:
            positions.append(
                PositionLite(
                    venue="Wallet (idle)",
                    asset=symbol,
                    value_usd=_fmt_units(idle, 6),
                    underlying=symbol,
                    price_source="wallet balance",
                )
            )
        net = _fmt_units(idle + sum(w.underlying for w in wrappers if w.par), 6)
        native_wei: int | None = None
        try:
            native_wei = await self._reader.native_balance(owner)
        except VaultUnavailable:
            _warn_once("chat_native_balance_unavailable")
        tokens = await self._notable_tokens(chain, owner)
        return PortfolioView(
            positions=tuple(positions),
            net_worth_usd=net,
            idle_usdc=idle,
            stale=stale or wrappers_stale,
            native_wei=native_wei,
            native_symbol=_native_symbol(chain.chain_id),
            tokens=tokens,
        )

    async def _notable_tokens(
        self, chain: ChainContext, owner: str
    ) -> tuple[TokenBalanceLite, ...]:
        """Non-USDC ERC-20s worth naming in a wallet answer — today, SRK where it is deployed.

        Address comes from the same ``SRK_ADDRESS_<chainId>`` env the Premium verifier uses, so
        there is one source of truth for "where SRK lives". Unset env ⇒ no line (a chain without
        SRK is not an error). A balance read failure ⇒ no line, same reason.
        """
        srk = os.getenv(f"SRK_ADDRESS_{chain.chain_id}")
        if not srk:
            return ()
        try:
            raw = await self._reader.token_balance_of(srk, owner)
        except VaultUnavailable:
            _warn_once("chat_srk_balance_unavailable")
            return ()
        return (TokenBalanceLite(symbol="SRK", raw=raw, decimals=18),) if raw > 0 else ()


# ─────────────────────────────────────────────────────────────────────────────
# Dependencies
# ─────────────────────────────────────────────────────────────────────────────


async def _recent_changelog() -> list[dict[str, Any]]:
    """The newest published updates, newest first. Fail-open to empty — the assistant then says
    so honestly rather than failing the turn."""
    try:
        return await ContentEntryStore(get_database()).list_changelog(8)
    except Exception:  # noqa: BLE001 — a changelog read must never cost the user their answer
        _warn_once("chat_changelog_unavailable")
        return []


def _curated_number(pick: dict[str, Any], key: str) -> float | None:
    value = pick.get(key)
    return float(value) if isinstance(value, (int, float)) else None


async def _curated_context(chain_id: int) -> CuratedContext | None:
    """The curated record for a chain — the SAME composition the public ``/vaults/curated`` route
    serves (approved vaults + the latest PUBLISHED recommendation + the admin pin).

    Fail-open to ``None`` on any read failure, which the "best vault" route renders as an honest
    error. It never fabricates a pick: a store outage must not become a remembered vault. Advisory
    display only — the result ends in a ``text`` block and never reaches propose/build/policy.
    """
    try:
        store = PgCurationStore(get_database())
        vaults = await store.list_vaults(chain_id, statuses=(APPROVED,))
        state = await store.get_state(chain_id)
        rec = await store.latest_recommendation(chain_id, published_only=True)
        board = public_board(chain_id, vaults, rec, state)
    except Exception:  # noqa: BLE001 — a curated read must never cost the user their answer
        _warn_once("chat_curated_unavailable")
        return None

    # 053 — the LIST answer enumerates the board, so the context carries every displayed vault,
    # not just the pick. Both are built by the same mapper (one shape, one source of truth).
    raw_vaults = board.get("vaults")
    listed: tuple[CuratedPick, ...] = ()
    if isinstance(raw_vaults, list):
        listed = tuple(
            pick
            for pick in (_curated_pick_from(raw) for raw in raw_vaults if isinstance(raw, dict))
            if pick is not None
        )

    raw_pick = board.get("pick")
    if not isinstance(raw_pick, dict):
        return CuratedContext(vault_count=len(vaults), vaults=listed)
    return CuratedContext(
        vault_count=len(vaults),
        pick=_curated_pick_from(raw_pick),
        vaults=listed,
    )


def _curated_pick_from(raw: dict[str, object]) -> CuratedPick | None:
    """One board row → the chat-shaped pick. ``None`` when the row has no usable address/label."""
    address = str(raw.get("address") or "")
    label = str(raw.get("label") or "this vault")
    if not address:
        return None
    net_apy = _curated_number(raw, "netApyBps")
    curator = raw.get("curator")
    as_of = raw.get("asOf")
    return CuratedPick(
        address=address,
        label=label,
        net_apy_bps=int(net_apy) if net_apy is not None else None,
        tvl_usd=_curated_number(raw, "tvlUsd"),
        curator=str(curator) if curator else None,
        curator_verified=bool(raw.get("curatorVerified")),
        reason=str(raw.get("reason") or "it scored best in the latest screening."),
        as_of=str(as_of) if as_of else None,
        wrapped=bool(raw.get("wrapped")),
    )


def _safe_citation_retriever() -> KnowledgeRetriever | None:
    """The corpus retriever, or ``None`` — degrading to no-RAG on a misconfigured embedder.

    ``openai_embedder`` fails OPEN when ``EMBEDDING_OPENAI_*`` is unset (returns ``None``) but fails
    CLOSED (raises ``ValueError``) when ``EMBEDDING_OPENAI_MODEL`` doesn't match the pinned model —
    a deliberate guard on the INGEST path so nothing writes into a mismatched vector space. On the
    chat READ path, though, a misconfigured/typo'd model env must NOT take chat down: reads can't
    corrupt the space, and 500-ing every turn over a citation feed is the worse failure. So here we
    degrade to ungrounded prose (no citations) and log the misconfig loudly instead of raising.
    """
    try:
        return default_citation_retriever()
    except ValueError:
        _logger.warning(
            "embedding backend misconfigured (EMBEDDING_OPENAI_MODEL != pinned); "
            "chat degrades to no-RAG (ungrounded, no citations) instead of failing",
            exc_info=True,
        )
        return None


def get_coordinator_dag(
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    mandate_provider: Annotated[MandateProvider, Depends(get_mandate_provider)],
    wrapper_store: Annotated[PgWhitelistStore | None, Depends(get_wrapper_store)],
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
    # The Obsidian retriever is wired when a real embedding backend is configured
    # (EMBEDDING_OPENAI_*); otherwise None → no corpus citations/grounding (fail-open, never
    # fabricated). A MISCONFIGURED embedding model degrades to None here too (see
    # _safe_citation_retriever) rather than 500-ing chat. The retriever satisfies both the citation
    # and grounder interfaces, so one instance serves the recommender's citations AND the grounder.
    retriever = _safe_citation_retriever()
    return CoordinatorDag(
        planner=Planner(llm=client),
        recommender=Recommender(llm=client, knowledge=retriever),
        # Sparky's persona (get_persona) shapes the literacy prose voice — trusted SYSTEM content,
        # process-stable + memoised, never on the policy/action path.
        literacy=Literacy(llm=client, persona_provider=get_persona),
        # …and the GENERAL/identity branch, so "who are you?" answers as Sparky instead of the
        # static help line. Same trusted-persona composition, same prose-only boundary: its output
        # is wrapped in a `text` block, which cannot carry an action or a policy stamp.
        sparky=Sparky(llm=client, persona_provider=get_persona),
        # 031 — "what's new?" is a RECENCY question and cosine similarity has no clock. Indexing
        # the changelog let the assistant QUOTE a release note, but the nearest chunks are not the
        # newest ones, so it answered "there aren't any other updates listed there yet" with forty
        # published. Read the newest directly instead; fail-open to None, which simply restores
        # the retrieval-only behaviour.
        changelog=_recent_changelog,
        # 048 — "what's the best vault?" reads the CURATED RECORD (the same row /vault renders).
        # Fail-open to an honest error; never a remembered vault or a model-supplied APY.
        curated=_curated_context,
        # 060 — keyless USD reference prices for the deterministic price route. Display-only:
        # the service is cached/bounded and never reaches propose/build/policy.
        prices=get_price_service(),
        portfolio_provider=_VaultChatPortfolioProvider(reader, config, wrapper_store),
        mandate_provider=mandate_provider,
        # The Obsidian GROUNDER — feeds corpus passages into the LEARN/OTHER prose answers so Sparky
        # answers FROM the second brain (with citations). Same instance as the citation retriever;
        # None ⇒ ungrounded prose. Passage text never reaches the policy/action path.
        knowledge=retriever,
        # 059 — latency switches, default ON for the beta. Both are ADVISORY only: streaming can
        # never create a sign path (deltas are plain text, the final block is still the only
        # persisted answer), and the fast pre-classifier can only route read-only intents that
        # were already answered without an action. Set to 0 to restore the exact pre-059 path.
        streaming=env_flag(SPARKY_STREAMING_ENV, default=True),
        single_call=env_flag(SPARKY_SINGLE_CALL_ENV, default=True),
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


_logger = logging.getLogger(__name__)

#: Once-per-process guard for the sink's append-failure warning (mirrors the pre-0028 column
#: warning in db/conversations.py). Fail-open persistence needs at least one loud line per
#: failure mode, or a systematic drop (e.g. the SQL_ASCII/JSONB encoding failure this 025 hotfix
#: fixed) is indistinguishable from "nothing happened".
_warned_append_failure = False


def _warn_append_failure(exc: Exception) -> None:
    global _warned_append_failure
    if not _warned_append_failure:
        _warned_append_failure = True
        _logger.warning(
            "conversation_turn_append_failed: chat history is NOT being recorded (%s: %s). "
            "Fail-open — chat keeps serving, but replay/history silently degrade until this "
            "is fixed. Logged once per process.",
            type(exc).__name__,
            exc,
        )


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

    async def record(
        self,
        conversation_id: str,
        role: str,
        content: str,
        blocks: Sequence[Mapping[str, Any]] | None = None,
    ) -> None:
        # 025: persist when EITHER the text summary or the structured cards carry something. The
        # pre-025 guard was `not content`, which silently dropped a turn whose blocks all
        # summarize to "" (e.g. a citation-only turn) — those are now replayable.
        if not content and not blocks:
            return
        try:
            await self._store.append_turn(_uuid(conversation_id), role, content, blocks)
        except Exception as exc:
            # Fail-open stays (persistence must never break a chat turn) — but no longer BLIND.
            # A silent `except: return` here hid a 100%-reproducible encoding failure in
            # production (SQL_ASCII vs \u-escaped JSONB, 025 hotfix): every assistant turn was
            # dropped and nothing said so. One warning per process names the exception class so
            # the NEXT systematic failure is visible in the logs without flooding them.
            _warn_append_failure(exc)
            return


class _NoopConversationSink(_ConversationSink):
    """Default in tests — no persistence, no history (chat behaves exactly as before B1)."""

    def __init__(self) -> None:  # noqa: D401 — deliberately skips the store
        pass

    async def resolve(self, owner_eoa: str, conversation_id: str | None, first_message: str) -> str:
        return conversation_id or _new_conversation_id()

    async def history(self, conversation_id: str) -> list[tuple[str, str]]:
        return []

    async def record(
        self,
        conversation_id: str,
        role: str,
        content: str,
        blocks: Sequence[Mapping[str, Any]] | None = None,
    ) -> None:
        return None


def _uuid(value: str) -> Any:
    from uuid import UUID

    return UUID(value)


def get_conversation_sink() -> _ConversationSink:
    """The per-wallet conversation-history sink (fail-open Pg-backed; overridden in tests)."""
    return _ConversationSink(ConversationStore(get_database()))


#: Once-per-process guard for the memory sink's write-failure warning (same reasoning as
#: ``_warn_append_failure``: fail-open persistence needs one loud line per failure mode, or
#: "nothing is ever remembered" is indistinguishable from "this user has done nothing").
_warned_memory_failure = False


#: 029 — degraded WALLET reads that must not be logged on every turn. A missing native or SRK
#: balance costs one prose clause, not the answer, so it is a warning once per process.
_warned_reads: set[str] = set()


def _warn_once(key: str) -> None:
    """Warn the first time a named optional read degrades, then stay silent for the process."""
    if key not in _warned_reads:
        _warned_reads.add(key)
        _logger.warning(
            "%s: an optional wallet read is unavailable; the chat answer omits that line and "
            "keeps serving. Logged once per process.",
            key,
        )


#: Native coin symbol per chain — Base + Base Sepolia are ETH; Robinhood testnet 46630 is ETH too.
#: A chain not listed falls back to "ETH" rather than inventing a ticker.
_NATIVE_SYMBOLS: dict[int, str] = {8453: "ETH", 84532: "ETH", 46630: "ETH", 4663: "ETH"}


def _stable_symbol(chain_id: int) -> str:
    """The chain's stable display symbol (4663 USDG, elsewhere USDC) — display only."""
    return "USDG" if chain_id == 4663 else "USDC"


def _native_symbol(chain_id: int) -> str:
    return _NATIVE_SYMBOLS.get(chain_id, "ETH")


def _warn_memory_failure(exc: Exception) -> None:
    global _warned_memory_failure
    if not _warned_memory_failure:
        _warned_memory_failure = True
        _logger.warning(
            "user_memory_write_failed: cross-conversation memory is NOT being recorded (%s: %s). "
            "Fail-open — chat keeps serving and simply starts each conversation blank. Logged "
            "once per process.",
            type(exc).__name__,
            exc,
        )


#: Once-per-process guard for the 028 activity-fold failure warning (same discipline).
_warned_fold_failure = False


def _warn_fold_failure(exc: BaseException) -> None:
    global _warned_fold_failure
    if not _warned_fold_failure:
        _warned_fold_failure = True
        _logger.warning(
            "user_memory_fold_failed: platform activity is NOT being folded into memory "
            "(%s: %s). Fail-open — chat and chat-derived memory keep working; activity lines "
            "are simply missing until this is fixed. Logged once per process.",
            type(exc).__name__,
            exc,
        )


class _MemorySink:
    """FAIL-OPEN cross-conversation memory persistence (027) + the 028 activity fold. Mirrors
    :class:`_ConversationSink`: a database outage, or an agent running ahead of migration
    0030/0031, degrades to "no memory"/"no activity" — never a broken chat turn.

    The BOUNDARY lives with the caller, not here: what this returns is passed only to the
    classifier and to Sparky's prose turn (see ``CoordinatorDag.run_chat``), never to propose,
    the policy gate, or ``/build-tx``."""

    def __init__(
        self,
        store: MemoryStore,
        folder_factory: Callable[[int], ActivityFolder | None] | None = None,
    ) -> None:
        self._store = store
        self._folder_factory = folder_factory

    async def fold_platform_activity(self, *, owner: str, account: str, chain_id: int) -> None:
        """The 028 lazy fold — run once per turn BEFORE the digest read, so this very turn
        already knows about fresh platform activity. Fail-open + warned once per process."""
        if self._folder_factory is None:
            return
        try:
            folder = self._folder_factory(chain_id)
            if folder is None:
                return
            result = await fold_activity(folder, owner=owner, account=account)
            if result.error is not None:
                _warn_fold_failure(result.error)
        except Exception as exc:
            _warn_fold_failure(exc)

    async def lines(self, owner_eoa: str) -> list[str]:
        """This wallet's remembered lines, oldest first — ``[]`` on any failure."""
        try:
            return list((await self._store.get(owner_eoa)).lines)
        except Exception:
            return []

    async def remember(self, owner_eoa: str, lines: Sequence[str]) -> None:
        """Fold this turn's derived lines into the digest (fail-open, warned once per process)."""
        if not lines:
            return
        try:
            await self._store.append(owner_eoa, lines)
        except Exception as exc:
            _warn_memory_failure(exc)


class _NoopMemorySink(_MemorySink):
    """Default in tests — no memory read, no memory write (chat behaves exactly as pre-027)."""

    def __init__(self) -> None:  # noqa: D401 — deliberately skips the store
        pass

    async def lines(self, owner_eoa: str) -> list[str]:
        return []

    async def remember(self, owner_eoa: str, lines: Sequence[str]) -> None:
        return None

    async def fold_platform_activity(self, *, owner: str, account: str, chain_id: int) -> None:
        return None


def _activity_folder(chain_id: int) -> ActivityFolder | None:
    """The 028 fold sources for one chain — vault flows, app-signed executions, attributed
    swaps, and the SRK faucet probe. Every source is optional and independently fail-open."""
    config = get_agent_config().for_chain(chain_id)
    db = get_database()
    net = _network_id(chain_id)
    targets: tuple[tuple[str, str], ...] = ()
    if config.vault_address:
        targets = ((net, config.vault_address),)
    usdc = {net: config.aave_reserve_usdc_address} if config.aave_reserve_usdc_address else None
    # The faucet is a Base Sepolia (84532) testnet convenience; both env vars optional —
    # unset simply disables the source (read like PREMIUM_*, outside the keyless AgentConfig).
    probe: FaucetProbe | None = None
    faucet_addr = os.getenv("SRK_FAUCET_ADDRESS")
    faucet_rpc = os.getenv("BASE_SEPOLIA_RPC_URL")
    if chain_id == 84532 and faucet_addr and faucet_rpc:
        probe = FaucetProbe(rpc_url=faucet_rpc, faucet_address=faucet_addr)
    return ActivityFolder(
        memory=MemoryStore(db),
        flows=VaultFlowReader(db) if targets else None,
        flow_targets=targets,
        executions=ExecutionStore(db),
        swaps=PgSwapFeeEventStore(db),
        swap_networks=(net,),
        usdc_by_network=usdc,
        faucet_probe=probe,
    )


def get_memory_sink() -> _MemorySink:
    """The per-wallet cross-conversation memory sink (fail-open Pg-backed; overridden in tests)."""
    return _MemorySink(MemoryStore(get_database()), folder_factory=_activity_folder)


# ─────────────────────────────────────────────────────────────────────────────
# SSE stream
# ─────────────────────────────────────────────────────────────────────────────


# 025 — the block types worth REPLAYING when a conversation is reopened. Everything here is
# durable CONTENT the user saw; the two exclusions are deliberate:
#
#   * ``tool_step`` — transient thinking-state. Each step is emitted TWICE (running → done) and the
#     renderer keeps every row, so replaying them would resurrect a wall of progress spinners
#     frozen mid-"running" forever. The brief excludes them and the renderer proves why.
#   * ``error`` — the mid-stream ``UPSTREAM_UNAVAILABLE`` fallback is a one-off infrastructure
#     blip. Persisting it would etch a transient gateway hiccup permanently into the thread.
#
# Both stay in the LIVE stream (the user sees them in the moment); they just aren't history.
_PERSISTED_BLOCK_TYPES = frozenset(
    {"text", "tip", "recommendation", "action", "portfolio_snapshot", "outcome", "citation"}
)

# Blocks that represent CONTENT the model actually produced for the user (scaffolding such as
# ``tool_step`` / ``citation`` excluded). Used by the 054 refund path to distinguish a degraded
# turn that ended in ``UPSTREAM_UNAVAILABLE`` from one that already answered before failing.
_ANSWER_BLOCK_TYPES = frozenset(
    {"text", "tip", "recommendation", "action", "portfolio_snapshot", "outcome"}
)


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
    memory: _MemorySink,
    memory_lines: list[str],
    quota: LimitDecision | None = None,
    limits: LimitsStore | None = None,
) -> AsyncIterator[str]:
    """Drive one ``run_chat`` turn and frame each §2.7 block as an SSE ``block`` event.

    Terminates with a ``done`` event carrying ``{conversationId, blockCount}``. Any
    unexpected error mid-stream (which the app exception handlers can no longer catch,
    the response having already started) degrades to a single inert ``error`` block so a
    traceback or partial output can never reach the wire — fail-closed, non-custody. The user
    turn + a compact assistant summary are persisted (fail-open) for multi-turn history, and
    1–2 deterministic memory lines are folded into the wallet's CROSS-conversation digest (027)
    from the blocks this turn actually streamed — no second LLM call.
    """
    # Persist the user's turn up front (fail-open) so history survives even a mid-stream failure.
    await sink.record(conversation_id, "user", message)
    count = 0
    summary_parts: list[str] = []
    block_wires: list[dict[str, Any]] = []
    answered = False
    refunded = False

    async def refund_once() -> None:
        """Return the pre-charged unit at most once per turn (054)."""
        nonlocal refunded
        if refunded:
            return
        refunded = True
        if quota is not None and limits is not None:
            await refund(limits, owner_eoa, quota)

    try:
        async for block in dag.run_chat(
            message, chain, surface=surface, history=history, memory_lines=memory_lines
        ):
            if isinstance(block, ProseDelta):
                # Transport-only paint: NOT counted, NOT persisted, NOT summarized. The final
                # text/tip block that follows is authoritative and replaces whatever was painted.
                yield _sse(
                    _EVENT_TEXT_DELTA,
                    {"target": block.target, "delta": block.delta, "streamId": block.stream_id},
                )
                continue
            count += 1
            wire = block.to_wire()
            block_type = wire.get("type")
            # 054: the DAG degrades INTERNALLY in its prose branches — Sparky/literacy swallow
            # the upstream error and return ``fell_back=True``, and the curated-store outage
            # path returns normally — emitting ``ErrorBlock("UPSTREAM_UNAVAILABLE")`` instead of
            # raising. The ``except`` below therefore never fires for those turns. Catch the
            # emitted error at this single choke point and refund once, but only when no real
            # answer block preceded it. The flag makes a turn refundable exactly once even if
            # the stream later raises; a client disconnect stays a BaseException and is never
            # refunded.
            if block_type == "error" and wire.get("code") == "UPSTREAM_UNAVAILABLE":
                if not answered:
                    await refund_once()
            elif block_type in _ANSWER_BLOCK_TYPES:
                answered = True
            frag = _assistant_summary(wire)
            if frag:
                summary_parts.append(frag)
            # 025: keep the card's own wire JSON alongside the lossy summary, so reopening the
            # conversation replays the CARD instead of "[proposed action: aerodrome_swap]".
            if block_type in _PERSISTED_BLOCK_TYPES:
                block_wires.append(wire)
            yield _sse(_EVENT_BLOCK, wire)
    except Exception:
        # Fail-closed: degrade to an inert block, never leak internals (BaseException — e.g.
        # a cancelled request — deliberately propagates untouched).
        # The turn failed upstream after the quota dependency charged it, so return that unit to
        # the SAME window. Kept broader than ``/recommendations`` (which refunds only its typed
        # ``UPSTREAM_UNAVAILABLE`` ApiError) because an unexpected mid-stream raise here is by
        # definition a failed turn with no answer — narrowing it would risk leaving a charged
        # unit on an unanticipated upstream error shape. ``refund_once`` prevents a second
        # refund if an error block was already streamed. Fail-safe: ``refund`` swallows its own
        # errors. A client disconnect is a BaseException (not caught here) and is never refunded.
        await refund_once()
        fallback: ChatBlock = ErrorBlock("UPSTREAM_UNAVAILABLE", _STREAM_FAILURE_MESSAGE)
        count += 1
        yield _sse(_EVENT_BLOCK, fallback.to_wire())
    await sink.record(conversation_id, "assistant", " ".join(summary_parts).strip(), block_wires)
    # 027: the same terminal persist also feeds the CROSS-conversation digest. Derivation is
    # deterministic (``derive_memory_lines`` reads the block wires this turn already produced), so
    # memory costs no extra model call and no extra latency. Fail-open like the sink above — a
    # memory write can never break a chat turn, and a systematic failure is warned once.
    await memory.remember(owner_eoa, derive_memory_lines(message, block_wires))
    yield _sse(_EVENT_DONE, {"conversationId": conversation_id, "blockCount": count})


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/chat")
async def chat(
    body: ChatRequest,
    account: Annotated[AccountContext, Depends(get_account)],
    quota: Annotated[LimitDecision, Depends(require_within_quota("chat"))],
    limits: Annotated[LimitsStore, Depends(get_limits_store)],
    dag: Annotated[CoordinatorDag, Depends(get_coordinator_dag)],
    chain_provider: Annotated[ChatChainProvider, Depends(get_chain_provider)],
    sink: Annotated[_ConversationSink, Depends(get_conversation_sink)],
    memory: Annotated[_MemorySink, Depends(get_memory_sink)],
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
    # 028: lazily fold NEW platform activity (vault flows; US2/US3 add executions/swaps/faucet)
    # into the digest FIRST, so this very turn already knows about a deposit made an hour ago on
    # the vault page. Fail-open + once-per-process warning; exactly-once via the activity cursor.
    await memory.fold_platform_activity(
        owner=account.owner, account=account.account, chain_id=account.chain_id
    )
    # 027: the wallet's CROSS-conversation digest — read once per turn, keyed to the SIWE-verified
    # owner (never the conversation), which is exactly why a brand-new chat is no longer blank.
    # Fail-open to [] (no row, no migration 0030, no database), which reproduces pre-027 behaviour.
    memory_lines = await memory.lines(account.owner)
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
        memory=memory,
        memory_lines=memory_lines,
        quota=quota,
        limits=limits,
    )
    return StreamingResponse(
        stream,
        media_type=SSE_MEDIA_TYPE,
        # Keep proxies/browsers from buffering or caching the token-by-token stream.
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
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
