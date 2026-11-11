"""The §3.4 recommendation endpoints — ranked strategies vs. the mandate (READ only).

agent-service-api.md §3.4 — ``GET /recommendations`` returns strategies ranked against the
user's risk mandate, and ``GET /recommendations/{recId}`` returns the "why this?" detail +
a comparison against neighboring ranks. Both are ADVISORY: each recommendation carries a
:class:`~sparkpoint_agent.policy.PolicyVerdict` STAMP and a ``proposedAction`` that is NOT
yet a signable bundle (materializing one is the single ``/build-tx`` chokepoint, §3.5); the
service returns no signature.

Only-cleared, whitelist-only surface (FR-016 / SC-006 — the crux)
----------------------------------------------------------------
The renderer shows nothing the policy layer has not cleared. This endpoint delegates to the
deterministic :meth:`CoordinatorDag.run_recommendations`, which enforces two independent
fail-closed layers before anything reaches the wire:

1. **Structural whitelist.** The candidate SET is CODE (the recommender's fixed yield set);
   the LLM only ranks + narrates it. An off-whitelist ``actionType`` the model emits is
   ignored, and an undeployed target resolves to ``None`` and is dropped — a non-whitelisted
   protocol is structurally unrepresentable.
2. **Deterministic policy gate.** EVERY candidate is stamped by ``policy.evaluate`` (via the
   guardrail); ``run_recommendations`` surfaces ONLY ``signable`` (approved) candidates. An
   over-cap / stale / mandate-exceeding proposal is stamped ``rejected`` and never surfaces.

So a recommendation on the wire is, by construction, both whitelisted AND policy-approved.

Persist-at-surface + degradation (US5 T010)
-------------------------------------------
Each cleared recommendation is persisted at surface time via the :class:`RecommendationStore`,
so the ``recId`` is a **durable UUID** that round-trips to ``/build-tx`` as
``proposedAction.recommendationId`` and links the acted-on advice to its on-chain outcome
(FR-002/FR-039). Persistence is **fail-open**: a store outage leaves the ephemeral strategy-keyed
id (``rec_<kind>``) and never 503s this advisory read (non-custody — an off-chain advice index,
never on the funds path). ``GET /recommendations/{recId}`` recomputes the cleared set, re-keys it
through the same idempotent store, and matches by id — so the durable UUID resolves while the live
"why this?" citations + neighbor comparison are preserved (a bare store read would drop them).
``NOT_FOUND`` maps a missing mandate to an onboarding prompt (§3.4) and an unknown/no-longer-cleared
id; ``REFUSAL`` maps a model refusal. A chain outage while reading the gate's cap headroom marks the
data ``stale`` — which fails the gate's freshness step closed, so nothing unverified is surfaced.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from ..agents.literacy import Literacy
from ..agents.planner import Planner
from ..agents.recommender import Recommender
from ..chain import VaultReader, VaultUnavailable
from ..chain.aave_rate import AavePoolReader
from ..chain.vault_reader import HttpxJsonRpcTransport
from ..config import AgentConfig
from ..coordinator import (
    ChainContext,
    CoordinatorDag,
    MandateProvider,
    MandateView,
    MarketData,
    PortfolioView,
    RecommendationBlock,
    RecommendationsResult,
)
from ..db import LimitsStore, RecommendationStore, get_database
from ..db.mandates import MandateStore
from ..db.recommendations import RecInsert
from ..knowledge import default_citation_retriever
from ..llm import AsyncClaudeClient, ClaudeError, LlmBusyError, status_code
from ..persona import get_persona
from ..policy import CAPS, GOVERNANCE, CapHeadroom, RiskProfile
from .errors import ApiError, ErrorCode, ErrorReason
from .mandate import get_mandate_store
from .quota import LimitDecision, get_limits_store, refund, require_within_quota
from .security import AccountContext
from .vault import get_account, get_vault_reader

router = APIRouter(tags=["recommendations"])

# The deploy-time vault address resolves the ``sparkpoint_vault`` TargetRef so the vault
# deposit candidate is representable; without it, that candidate is dropped (fail-closed)
# and only the bare Aave supply (a statically-known target) can surface.
_VAULT_TARGET_REF = "sparkpoint_vault"

# A generous ceiling for the detail recompute — there are only a couple of yield
# strategies, so this never truncates while finding a rec by id.
_DETAIL_LIMIT = 25

# HTTP statuses on a raised provider error that mean "the model is temporarily unavailable"
# (rate-limited or upstream 5xx) rather than a bug here — mapped to UPSTREAM_UNAVAILABLE (503).
_LLM_UNAVAILABLE_STATUS: frozenset[int] = frozenset({429, 500, 502, 503, 504, 529})

# The single, non-leaking message for a transient model outage on the recommend path.
_UPSTREAM_DOWN_MESSAGE = (
    "The assistant is temporarily unavailable, so fresh recommendations can't be produced "
    "right now. Nothing was changed — please try again shortly."
)


# ─────────────────────────────────────────────────────────────────────────────
# Response models (camelCase field names = the exact §3.4 wire shape).
# ─────────────────────────────────────────────────────────────────────────────


class RecommendationItem(BaseModel):
    """§3.4 recommendation — advisory, whitelist-only, policy-stamped (NOT yet signable)."""

    recId: str
    rank: int
    strategyKind: str
    title: str
    protocol: str  # ∈ aave_v3 | aerodrome (whitelist ONLY; FR-016)
    rationale: str
    proposedAction: dict[str, Any]
    policy: dict[str, Any]  # { status: "approved", checks: [...] } — from the LLM-free verdict
    citations: list[dict[str, Any]]
    grossApyBps: int | None = None
    projectedApyBps: int | None = None
    performanceFeeBps: int = GOVERNANCE.performance_fee.default_bps
    # 030 — the card's truthful metadata. `riskTier` is the STRATEGY's own 1..5 tier: before this
    # the wire carried nothing, so /strategies hardcoded tier 1 on every card. `feeStance` and
    # `managedBy` state the only real difference between the live strategies (both supply USDC to
    # Aave v3; the vault adds a fee and management, not risk), so the comparison the page promises
    # can be honest rather than invented.
    riskTier: int = 1
    feeStance: str = "unknown"
    managedBy: str = "unknown"
    asOf: str
    stale: bool


class RecommendationsResponse(BaseModel):
    """§3.4 ``GET /recommendations`` 200 body.

    ``stale`` is the top-level freshness signal (§3.4 ``DATA_STALE`` prefers 200+stale over
    an error): when the gate's fresh reads degraded, nothing clears and ``stale`` is true.
    """

    policyVersion: str
    mandateVersion: int
    stale: bool
    recommendations: list[RecommendationItem]


class ComparisonItem(BaseModel):
    """A neighboring-rank strategy the detail endpoint compares against (§3.4)."""

    recId: str
    rank: int
    strategyKind: str
    title: str
    protocol: str
    grossApyBps: int | None = None
    projectedApyBps: int | None = None


class RecommendationDetailResponse(BaseModel):
    """§3.4 ``GET /recommendations/{recId}`` 200 body — "why this?" + compare."""

    policyVersion: str
    mandateVersion: int
    recommendation: RecommendationItem
    whyThis: str
    citations: list[dict[str, Any]]
    comparison: list[ComparisonItem]


# ─────────────────────────────────────────────────────────────────────────────
# Injected providers (production wiring; overridden with fakes/mocks in tests).
# ─────────────────────────────────────────────────────────────────────────────


# data-model.md §5 ``risk_tier`` ("moderate") ↔ policy ``RiskProfile`` ("balanced"): the
# mandate persistence uses the data-model spelling, the policy layer the policy-schema one.
_RISK_TIER_TO_PROFILE: dict[str, RiskProfile] = {
    "conservative": RiskProfile.CONSERVATIVE,
    "moderate": RiskProfile.BALANCED,
    "growth": RiskProfile.GROWTH,
}


def _network_id(chain_id: int) -> str:  # noqa: ARG001 — both Base chains map to one mirror id
    """The ``networks`` mirror id for a chain (Base mainnet + Base Sepolia → ``base``)."""
    return "base"


@dataclass
class _StoreMandateProvider:
    """Adapts the §3.1 :class:`MandateStore` to the DAG's :class:`MandateProvider`.

    Reads the user's active (confirmed, highest-version) mandate — the SAME persistence the
    §3.1 ``/mandate`` endpoints write — and maps it to the risk ceiling the recommender ranks
    against + the gate's mandate step enforces. No mandate (or no owner) ⇒ ``None`` so
    ``GET /recommendations`` prompts onboarding (``NOT_FOUND``, §3.4). The mandate only
    NARROWS what policy already permits (VR-M5); it never widens the allowlist.
    """

    store: MandateStore

    async def active(self, chain: ChainContext) -> MandateView | None:
        if chain.owner is None:
            return None
        record = await self.store.get_active(
            owner_eoa=chain.owner, network_id=_network_id(chain.chain_id)
        )
        if record is None:
            return None
        return MandateView(
            version=record.version,
            risk_profile=_RISK_TIER_TO_PROFILE.get(record.risk_tier, RiskProfile.CONSERVATIVE),
            max_slippage_bps=record.max_slippage_bps,
        )


class _StaticPortfolio:
    """A trivial portfolio provider for the recommend gather stage.

    The gather stage's portfolio only supplies a notional suggested amount + a staleness
    flag; the authoritative cap headroom is read separately (into the ``ChainContext``). We
    leave ``idle_usdc`` unset (→ the recommender's small notional default, which the user
    overrides at ``/build-tx``) and echo the staleness observed while reading the gate inputs.
    """

    def __init__(self, *, stale: bool) -> None:
        self._stale = stale

    async def read(self, chain: ChainContext) -> PortfolioView:
        return PortfolioView(stale=self._stale)


def get_agent_config() -> AgentConfig:
    """Process config (chiefly the deploy-time vault address). Overridden in tests."""
    return AgentConfig.from_env()


def get_llm_client() -> AsyncClaudeClient:
    """The async Claude client for the advisory agents. Overridden with a fake in tests.

    The model shapes prose + ranking ONLY; the candidate set and the policy verdict are
    never the model's (non-custody). Built per request (mirrors the per-request reader).
    """
    return AsyncClaudeClient.from_env()


def get_mandate_provider(
    store: Annotated[MandateStore, Depends(get_mandate_store)],
) -> MandateProvider:
    """The active-mandate reader, over the shared §3.1 store. Overridden in tests."""
    return _StoreMandateProvider(store)


def get_rec_store() -> RecommendationStore:
    """The recommendation store for persist-at-surface (US5 T010). Overridden in tests.

    Resolution is lazy (the DB pool is already resolved for the mandate read on this route), and all
    writes are wrapped fail-open (:func:`_persist_recids`), so a store outage never 503s this
    advisory read — it degrades to the ephemeral id (an off-chain index, non-custody).
    """
    return RecommendationStore(get_database())


# ─────────────────────────────────────────────────────────────────────────────
# Gate-input reads + DAG assembly.
# ─────────────────────────────────────────────────────────────────────────────


async def _read_gate_inputs(
    reader: VaultReader, account: AccountContext
) -> tuple[CapHeadroom, int, bool]:
    """Read the fresh cap headroom + fee rate the policy gate needs, fail-closed to stale.

    Per-user / total / vault headroom is ``cap - current`` in raw USDC base units (the CAPS
    step checks ``amount <= headroom``). A :class:`VaultUnavailable` degrades to
    ``stale=True`` (which the gate's freshness step rejects on for inflows) — never a
    fabricated headroom that could let an unverified strategy surface.
    """
    # 1111 — a NEAR session has no EVM address. Reading ``balanceOf(<near id>)`` raised a
    # ValueError that escaped the ``VaultUnavailable`` handler and 500'd the whole chat turn.
    # Report stale (which fails closed on inflows) with full caps; no fabricated balance.
    if account.auth_chain != "evm":
        return (
            CapHeadroom(
                per_user=CAPS.per_user_tvl.amount,
                total=CAPS.total_protocol.amount,
                vault=CAPS.vault_deposit.amount,
            ),
            GOVERNANCE.performance_fee.default_bps,
            True,
        )
    try:
        shares = await reader.balance_of(account.account)
        user_assets = await reader.convert_to_assets(shares) if shares else 0
        total_assets = await reader.total_assets()
        fee_bps = await reader.performance_fee_bps()
    except VaultUnavailable:
        # Full caps are moot here — data_stale=True makes the gate reject inflows anyway.
        full = CapHeadroom(
            per_user=CAPS.per_user_tvl.amount,
            total=CAPS.total_protocol.amount,
            vault=CAPS.vault_deposit.amount,
        )
        return full, GOVERNANCE.performance_fee.default_bps, True

    caps = CapHeadroom(
        per_user=max(0, CAPS.per_user_tvl.amount - user_assets),
        total=max(0, CAPS.total_protocol.amount - total_assets),
        vault=max(0, CAPS.vault_deposit.amount - total_assets),
    )
    return caps, fee_bps, False


async def _read_aave_gross_bps(config: AgentConfig) -> int | None:
    """Live Aave USDC supply APY (bps), best-effort. Honest ``None`` when the RPC / Aave pool /
    reserve env is unconfigured or the read fails — never fabricated, never raises (a degraded
    APY must not 503 the recommendation). On testnet the rate is ~0 → returns ~0 bps (honest)."""
    if not (config.rpc_url and config.aave_pool_address and config.aave_reserve_usdc_address):
        return None
    try:
        reader = AavePoolReader(
            pool_address=config.aave_pool_address,
            transport=HttpxJsonRpcTransport(config.rpc_url),
        )
        return await reader.supply_apy_bps(config.aave_reserve_usdc_address)
    except VaultUnavailable:
        return None


def _build_chain_context(
    account: AccountContext,
    config: AgentConfig,
    caps: CapHeadroom,
    fee_bps: int,
    stale: bool,
    gross_bps: int | None = None,
) -> ChainContext:
    """Assemble the per-request ``ChainContext`` the gate reads (headers scope reads only, §1.2).

    ``gross_bps`` is the live Aave USDC supply APY (bps); default ``None`` keeps callers that don't
    read the rate (e.g. the chat context provider) unchanged and honest (no fabricated APY).
    """
    resolved_targets: dict[str, str] = {}
    # 1111 — only an EVM session can build an EVM vault action. A NEAR identity must NOT be handed
    # a vault target it cannot sign for (the gate would also reject it as stale).
    if config.vault_address and account.auth_chain == "evm":
        resolved_targets[_VAULT_TARGET_REF] = config.vault_address
    # NOTE (030): only the VAULT belongs here. Every other allowlisted target — the Aave pool
    # included — resolves from the static address book inside `resolve_target_ref`; this map is
    # for deploy-time-determined addresses the book cannot know. Overriding a book address from
    # env would let the two DIVERGE silently, and the book is what the on-chain PolicyModule
    # mirrors.
    # Net-of-perf-fee projection from the live gross Aave rate; None stays None (honest, no feed).
    projected = None if gross_bps is None else round(gross_bps * (10_000 - fee_bps) / 10_000)
    return ChainContext(
        chain_id=account.chain_id,
        user_account=account.account,
        owner=account.owner,
        auth_chain=account.auth_chain,
        resolved_targets=resolved_targets,
        caps=caps,
        data_stale=stale,
        # Live Aave USDC supply APY (gross) net-of-perf-fee (projected); both None when the feed is
        # unconfigured/unreadable (honest, never fabricated). Profit-only fee is read from chain.
        market=MarketData(
            gross_apy_bps=gross_bps,
            projected_apy_bps=projected,
            performance_fee_bps=fee_bps,
            # 060 — these are live reads made for THIS turn; the prose rationale can say when.
            as_of=datetime.now(UTC).isoformat(),
        ),
    )


def _build_dag(
    llm: AsyncClaudeClient, mandate_provider: MandateProvider, *, stale: bool
) -> CoordinatorDag:
    """Build the advisory DAG. The gate defaults to the deterministic ``policy.evaluate``.

    The recommender is wired with the Obsidian citation retriever when a real embedding backend
    is configured (``EMBEDDING_OPENAI_*``); otherwise ``default_citation_retriever()`` returns
    ``None`` and recommendations carry no corpus citations (fail-open, never fabricated).
    """
    return CoordinatorDag(
        planner=Planner(llm=llm),
        recommender=Recommender(llm=llm, knowledge=default_citation_retriever()),
        literacy=Literacy(llm=llm, persona_provider=get_persona),
        portfolio_provider=_StaticPortfolio(stale=stale),
        mandate_provider=mandate_provider,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Block → §3.4 wire mapping. recId is persisted at surface (US5 T010); the strategy-keyed
# id below is the FAIL-OPEN fallback used only when the store is unavailable.
# ─────────────────────────────────────────────────────────────────────────────


def _rec_id(strategy_kind: str) -> str:
    """The ephemeral strategy-keyed fallback rec id (used only when persist fails open)."""
    return f"rec_{strategy_kind}"


def _to_item(block: RecommendationBlock, chain: ChainContext, *, stale: bool) -> RecommendationItem:
    """Map a policy-cleared :class:`RecommendationBlock` to the §3.4 wire item.

    The APY/fee figures are the request-level READ market data on the ``ChainContext``
    (null + best-effort here — no live feed), never the model's. The ``recId`` starts as the
    strategy-keyed fallback and is upgraded to the durable persisted UUID by
    :func:`_persist_recids` (here and in ``proposedAction.recommendationId``, so it round-trips).
    """
    strategy_kind = str(block.proposed_action["type"])
    rec_id = _rec_id(strategy_kind)
    proposed_action = {**block.proposed_action, "recommendationId": rec_id}
    market = chain.market
    return RecommendationItem(
        recId=rec_id,
        rank=block.rank,
        strategyKind=strategy_kind,
        title=block.title,
        protocol=block.protocol.value,
        rationale=block.rationale,
        proposedAction=proposed_action,
        policy=block.policy.to_wire(),
        citations=[c.to_wire() for c in block.citations],
        grossApyBps=market.gross_apy_bps,
        projectedApyBps=market.projected_apy_bps,
        performanceFeeBps=market.performance_fee_bps,
        riskTier=int(block.risk_tier),
        feeStance=block.fee_stance,
        managedBy=block.managed_by,
        asOf=_now_iso(),
        stale=stale,
    )


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


async def _persist_recids(
    rec_store: RecommendationStore | None,
    account: AccountContext,
    result: RecommendationsResult,
    items: list[RecommendationItem],
) -> None:
    """Persist each surfaced recommendation and upgrade its ``recId`` to the durable UUID (T010).

    Upserts one snapshot per cleared rec (idempotent by content ``dedupe_key`` → re-surfacing the
    same advice keeps ONE row + the SAME id, FR-002), then rewrites the item's ``recId`` and
    ``proposedAction.recommendationId`` to that UUID so it round-trips to ``/build-tx`` (FR-039).
    The stored snapshot is the proposedAction WITHOUT the injected ``recommendationId`` (a self-
    referential key would be circular) — matching the ``/build-tx`` resolve-by-id path.

    FAIL-OPEN (non-custody — an off-chain advice index, never the funds path): no store, or a
    per-item store error, leaves that item's ephemeral strategy-keyed id. ``/recommendations`` must
    never 503 on an advisory-index outage.
    """
    if rec_store is None:
        return
    mandate_version = str(result.mandate_version) if result.mandate_version is not None else None
    for item in items:
        snapshot = {k: v for k, v in item.proposedAction.items() if k != "recommendationId"}
        try:
            rec_id = await rec_store.upsert(
                RecInsert(
                    wallet=account.account,
                    strategy_kind=item.strategyKind,
                    title=item.title,
                    proposed_action=snapshot,
                    policy_version=result.policy_version,
                    rationale=item.rationale,
                    rank=item.rank,
                    mandate_version=mandate_version,
                )
            )
        except Exception:  # noqa: BLE001, S112 — advisory index: ANY store error degrades fail-open
            continue
        rid = str(rec_id)
        item.recId = rid
        item.proposedAction = {**snapshot, "recommendationId": rid}


async def _compute(
    account: AccountContext,
    reader: VaultReader,
    config: AgentConfig,
    llm: AsyncClaudeClient,
    mandate_provider: MandateProvider,
    *,
    limit: int,
) -> tuple[RecommendationsResult, list[RecommendationItem]]:
    """Run the deterministic recommend DAG and map its cleared blocks to §3.4 items.

    A model outage (rate-limit exhaustion / 5xx / limiter saturation) is a TRANSIENT
    upstream condition, so it surfaces as ``UPSTREAM_UNAVAILABLE`` (503, retryable) — the
    same mapping ``/chat`` and ``get_coordinator_dag`` use — never a 500 ``INTERNAL`` that
    implies a bug in this service. Fail-closed: no fabricated ranking is ever returned; the
    caller simply retries when the assistant recovers (the frontend degrades to its inert
    strategy view meanwhile). Genuine (non-upstream) errors propagate unchanged → 500.
    """
    caps, fee_bps, stale = await _read_gate_inputs(reader, account)
    # best-effort live Aave rate; None when unconfigured
    gross_bps = await _read_aave_gross_bps(config)
    chain = _build_chain_context(account, config, caps, fee_bps, stale, gross_bps=gross_bps)
    dag = _build_dag(llm, mandate_provider, stale=stale)
    try:
        result = await dag.run_recommendations(chain, limit=limit)
    except (ClaudeError, LlmBusyError) as exc:
        # Domain LLM failures (auth / limiter saturation / unsupported) → temporarily down.
        raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, _UPSTREAM_DOWN_MESSAGE) from exc
    except Exception as exc:
        # After the resilience layer exhausts its retries it re-raises the raw provider error
        # (e.g. a 429 RateLimitError); classify it by HTTP status so a transient upstream
        # outage reads as 503, while a real internal bug (no upstream status) still 500s.
        if status_code(exc) in _LLM_UNAVAILABLE_STATUS:
            raise ApiError(ErrorCode.UPSTREAM_UNAVAILABLE, _UPSTREAM_DOWN_MESSAGE) from exc
        raise
    items = [_to_item(block, chain, stale=result.stale) for block in result.recommendations]
    return result, items


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/recommendations", response_model=RecommendationsResponse)
async def get_recommendations(
    account: Annotated[AccountContext, Depends(get_account)],
    quota: Annotated[LimitDecision, Depends(require_within_quota("recs"))],
    limits: Annotated[LimitsStore, Depends(get_limits_store)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    llm: Annotated[AsyncClaudeClient, Depends(get_llm_client)],
    mandate_provider: Annotated[MandateProvider, Depends(get_mandate_provider)],
    rec_store: Annotated[RecommendationStore, Depends(get_rec_store)],
    limit: Annotated[int, Query(ge=1, le=25)] = 5,
    refresh: Annotated[bool, Query()] = False,  # noqa: ARG001 — always recomputes (persist is idempotent)
) -> RecommendationsResponse:
    """Ranked strategies vs. the mandate — whitelist + policy-cleared ONLY (§3.4, FR-016).

    Delegates to the deterministic ``run_recommendations`` (structural whitelist + the
    LLM-free policy gate), so every surfaced recommendation is both whitelisted and
    policy-approved. No mandate → ``NOT_FOUND`` (prompt onboarding); a model refusal →
    ``REFUSAL``. A cleared-but-empty result (nothing passes the gate) is a valid ``200``
    with no recommendations (FR-016 — the renderer shows nothing uncleared). Each cleared
    rec is persisted (US5 T010) so its ``recId`` is a durable UUID (fail-open to the ephemeral id).
    """
    try:
        result, items = await _compute(
            account, reader, config, llm, mandate_provider, limit=limit
        )
    except ApiError as exc:
        # Only an upstream/LLM failure refunds the pre-charged turn; NOT_FOUND (no mandate),
        # REFUSAL, and user errors are legitimate outcomes and keep their quota cost.
        if exc.code == ErrorCode.UPSTREAM_UNAVAILABLE:
            await refund(limits, account.owner, quota)
        raise
    _raise_if_unavailable(result)
    await _persist_recids(rec_store, account, result, items)
    return RecommendationsResponse(
        policyVersion=result.policy_version,
        mandateVersion=_mandate_version(result),
        stale=result.stale,
        recommendations=items,
    )


@router.get("/recommendations/{rec_id}", response_model=RecommendationDetailResponse)
async def get_recommendation_detail(
    rec_id: str,
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    llm: Annotated[AsyncClaudeClient, Depends(get_llm_client)],
    mandate_provider: Annotated[MandateProvider, Depends(get_mandate_provider)],
    rec_store: Annotated[RecommendationStore, Depends(get_rec_store)],
) -> RecommendationDetailResponse:
    """ "Why this?" detail + a comparison against neighboring ranks (§3.4).

    Recompute-then-resolve (US5 T010): recompute the cleared set, re-key it through the same
    idempotent store (so the durable UUID ``recId`` resolves), and match by id — while keeping the
    live citations + neighbor comparison a bare store read would drop. An unknown id — or one no
    longer clearing the gate — is ``NOT_FOUND``. Only whitelisted + policy-cleared strategies are
    matchable (FR-016). A store outage degrades to the ephemeral strategy-keyed id (fail-open).
    """
    result, items = await _compute(
        account, reader, config, llm, mandate_provider, limit=_DETAIL_LIMIT
    )
    _raise_if_unavailable(result)
    await _persist_recids(rec_store, account, result, items)

    match = next((item for item in items if item.recId == rec_id), None)
    if match is None:
        raise ApiError(
            ErrorCode.NOT_FOUND,
            f"No recommendation {rec_id!r} (it may no longer clear your guardrails).",
            reasons=[ErrorReason("NOT_FOUND", "unknown or no-longer-cleared recId")],
        )
    comparison = [
        ComparisonItem(
            recId=item.recId,
            rank=item.rank,
            strategyKind=item.strategyKind,
            title=item.title,
            protocol=item.protocol,
            grossApyBps=item.grossApyBps,
            projectedApyBps=item.projectedApyBps,
        )
        for item in items
        if item.recId != rec_id
    ]
    return RecommendationDetailResponse(
        policyVersion=result.policy_version,
        mandateVersion=_mandate_version(result),
        recommendation=match,
        whyThis=match.rationale,
        citations=match.citations,
        comparison=comparison,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Shared error mapping.
# ─────────────────────────────────────────────────────────────────────────────


def _raise_if_unavailable(result: RecommendationsResult) -> None:
    """Map the §3.4 no-mandate / refusal outcomes to the canonical envelope."""
    if result.mandate_version is None:
        raise ApiError(
            ErrorCode.NOT_FOUND,
            "Complete onboarding to set a risk mandate before requesting recommendations.",
            reasons=[ErrorReason("NOT_FOUND", "no active mandate")],
        )
    if result.refused:
        raise ApiError(
            ErrorCode.REFUSAL,
            "I couldn't produce a safe recommendation for that.",
            reasons=[ErrorReason("REFUSAL", "recommender declined")],
        )


def _mandate_version(result: RecommendationsResult) -> int:
    """The active mandate version (guaranteed present past :func:`_raise_if_unavailable`)."""
    assert result.mandate_version is not None  # noqa: S101 — guarded by _raise_if_unavailable
    return result.mandate_version
