"""Recommender — rank whitelist-only strategies vs. the mandate + write the rationale.

Grounding: agent-service-api.md §3.4 (ranked recommendations), plan.md Coordinator DAG
stage ``propose``; research.md §6 (the recommender is the judgment-heavy agent, effort
HIGH). Boundary echoes ``agents.strategy_recommender.SPEC`` (READ-only; holds no
build/sim tool) — this module is that spec's runtime.

Non-custody design (the crux of "a rogue LLM cannot move funds"):
  - The candidate SET is CODE, not the model. :func:`build_action` only ever produces an
    :class:`~sparkpoint_agent.policy.Action` for an allowlisted ``(action_type, asset)``
    resolved from ``policy.get_policy_constants`` — an off-whitelist protocol is
    unrepresentable, and an undeployed target (``resolve_target_ref -> None``) is dropped.
  - The ``recipient`` is ALWAYS pinned to the user's own account in code (N1) — the model
    has no field that can redirect funds.
  - The model supplies ONLY prose (title/rationale) + rank ordering. Any actionType it
    returns that is not in the code-built set is ignored.
  - Amounts flow from the user's intent (or a notional default), never fabricated by the
    ranker. Whatever amount/params reach the Action are still independently checked by
    ``policy.evaluate`` in the DAG's gate — an over-cap / over-slippage proposal is
    stamped ``rejected`` and is non-signable.

Fail-closed: a model refusal returns no candidates (``refused=True``); unparseable
ranking degrades to a deterministic code ordering with template rationales built from the
INJECTED market data (never a fabricated APY).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field, replace

from ..knowledge import CitationRetriever  # T125 — recommender MAY import knowledge (advisory)
from ..llm import AsyncClaudeClient, Effort
from ..policy import (
    Action,
    ActionType,
    Asset,
    RiskProfile,
    get_policy_constants,
    resolve_target_ref,
)
from ..wire import Citation
from .planner import Intent, IntentKind

_logger = logging.getLogger(__name__)

#: 029/FR-009 — risk language that cannot honestly appear on a conservative, whitelist-only
#: candidate. Matched against the MODEL's rationale only; the deterministic template replaces it.
#: Deliberately narrow: "higher yield" is a fine thing to say about a lending rate, whereas
#: "aggressive", "high-risk" and "speculative" describe a strategy this product does not offer.
#: 030 — widened. 029's pattern used ``\bleverage[d]?\b``, which cannot match "leveraging"
#: (there is no word boundary before "ing"), and the live rationale on alpha read:
#:
#:     "…aligns with your growth mandate by leveraging vault aggregation to seek higher returns
#:      than passive lending."
#:
#: …on a strategy that IS passive lending. The deeper cause was that the model was asked to
#: differentiate two candidates when only one existed (see 030/R1–R3); the guard should still
#: have caught it. "aggregation" is included because it describes a strategy shape this product
#: does not have — the constitution defers multi-strategy and cross-vault routing entirely.
_AGGRESSIVE_RE = re.compile(
    r"\baggressive(?:ly)?\b|\bhigh(?:er)?[- ]risk\b|\bspeculative\b|\bhigh[- ]octane\b|"
    r"\brisk(?:y|ier)\b|\bleverag(?:e|ed|es|ing)\b|\bvolatil(?:e|ity)\b|"
    r"\bmaximis(?:e|ing)\b|\bmaximiz(?:e|ing)\b|\baggregation\b|\boutperform\w*\b",
    re.IGNORECASE,
)

# research.md §6 — the recommender is judgment-heavy.
EFFORT: Effort = "high"

# A notional suggested amount when the user named none (they set the real amount at
# /build-tx). 100 USDC (6dp) — small, well within caps, positive (a zero amount fails the
# policy schema step). Kept low so a placeholder can never itself breach a cap.
DEFAULT_SUGGEST_AMOUNT = 100_000_000

_ASSET_DECIMALS: dict[Asset, int] = {Asset.USDC: 6, Asset.ETH: 18}

# The code-fixed yield candidate set for a RECOMMEND turn (whitelist only; FR-016). The
# vault is the flagship; a bare Aave supply is the raw alternative. Swaps are proposed
# only on an explicit build command (they need a live price simulation to be signable).
#
# 030 — each entry now carries the strategy's OWN intrinsic risk class, which is a different
# thing from the user's mandate profile. Before this, ``build_action`` was handed the mandate
# profile and stamped it onto the candidate as ``risk_class``; policy step 5 then evaluated
# ``action.risk_class > mandate.max_risk_class`` with both sides derived from the same value.
# ``X > X`` is never true, so the mandate check COULD NOT REJECT on the recommendation path —
# the mandate's only real authority has been a no-op since it was written. It also left the UI
# with nothing truthful to render a per-strategy risk badge from, which is why the web hardcoded
# tier 1 on every card.
#
# Both entries below are genuinely CONSERVATIVE — supplying USDC to Aave v3, directly or through
# a vault that does exactly that. So every current verdict is unchanged and the mechanism becomes
# real for the first strategy that isn't. This is a tightening: an action can now be rejected
# where it could not be, and none can be approved that previously was not.
_YIELD_STRATEGIES: tuple[tuple[ActionType, Asset, RiskProfile], ...] = (
    (ActionType.VAULT_DEPOSIT, Asset.USDC, RiskProfile.CONSERVATIVE),
    (ActionType.AAVE_SUPPLY, Asset.USDC, RiskProfile.CONSERVATIVE),
)

#: 030 — what a strategy COSTS and who carries it. This is the only real difference between the
#: two live strategies: both supply USDC to Aave v3, and the vault adds a fee and management
#: rather than risk or return. Stating it plainly is what lets the comparison be honest instead
#: of invented — the live rationale before 030 sold "leveraging vault aggregation … rather than
#: passive lending" for a strategy that IS passive lending, because the model was asked to
#: differentiate two things when only one existed.
#:
#: Derived in code from the constitutionally FIXED allowlist. Not configuration, not a curation
#: surface (Principle VII).
STRATEGY_COST: dict[ActionType, tuple[str, str]] = {
    # (feeStance, managedBy)
    ActionType.VAULT_DEPOSIT: ("managed_fee", "sparkpoint"),
    ActionType.AAVE_SUPPLY: ("no_platform_fee", "self"),
}

#: RiskProfile → the 1..5 tier the UI renders. Mirrors the web's mapping so one number means one
#: thing on both sides (030/R6). Before this, every card hardcoded tier 1 because the wire carried
#: nothing truthful to render.
RISK_TIER: dict[RiskProfile, int] = {
    RiskProfile.CONSERVATIVE: 1,
    RiskProfile.BALANCED: 3,
    RiskProfile.GROWTH: 4,
}


def strategy_meta(action_type: ActionType, risk_class: RiskProfile) -> tuple[int, str, str]:
    """``(riskTier, feeStance, managedBy)`` for a candidate — the card's truthful metadata.

    An unlisted action type reports its honest risk tier with an unknown cost stance rather than
    guessing, so a future strategy cannot silently inherit the vault's fee copy.
    """
    fee_stance, managed_by = STRATEGY_COST.get(action_type, ("unknown", "unknown"))
    return RISK_TIER.get(risk_class, 1), fee_stance, managed_by


#: The intrinsic risk class of an action type, for the explicit-build path (which does not go
#: through ``_YIELD_STRATEGIES``). Anything unlisted falls back to the user's mandate profile —
#: the pre-030 behaviour — so no path becomes MORE permissive by omission.
_STRATEGY_RISK_CLASS: dict[ActionType, RiskProfile] = {
    ActionType.VAULT_DEPOSIT: RiskProfile.CONSERVATIVE,
    ActionType.AAVE_SUPPLY: RiskProfile.CONSERVATIVE,
}

_DEFAULT_TITLE: dict[ActionType, str] = {
    ActionType.VAULT_DEPOSIT: "Deposit USDC into the profit-only Aave Yield Vault",
    ActionType.AAVE_SUPPLY: "Supply USDC directly to Aave v3",
    ActionType.AERODROME_SWAP: "Swap on Aerodrome",
}

RANK_SYSTEM = (
    "You are SparkPoint's strategy recommender. You are given a fixed, pre-vetted set of "
    "whitelisted strategies and the user's risk mandate. RANK them best-first for this "
    "user and write a one-sentence plain-language rationale + a short title for each. You "
    "may NOT invent new strategies, protocols, amounts, or APY figures — use only what is "
    "provided. Respond with a SINGLE JSON object and nothing else:\n"
    '  {"recommendations": [ {"actionType": "<one of the given>", "rank": <int>=1>, '
    '"title": "<short>", "rationale": "<one sentence>"} ]}\n'
    "Output JSON only."
)


# ─────────────────────────────────────────────────────────────────────────────
# Candidate + proposal context.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class ProposalContext:
    """The deterministic inputs the recommender proposes against (assembled by the DAG).

    Market figures (``gross_apy_bps`` / ``projected_apy_bps`` / ``performance_fee_bps``)
    and ``citations`` are READ data supplied by the caller — never invented by the model.
    ``resolved_targets`` carries the deploy-time vault address so the allowlist resolves.
    """

    chain_id: int
    user_account: str
    resolved_targets: dict[str, str] = field(default_factory=dict)
    risk_profile: RiskProfile = RiskProfile.CONSERVATIVE
    default_max_slippage_bps: int = 50
    gross_apy_bps: int | None = None
    projected_apy_bps: int | None = None
    performance_fee_bps: int = 1000
    citations: tuple[Citation, ...] = ()
    suggested_amount: int | None = None


@dataclass(frozen=True)
class Candidate:
    """A proposed, whitelist-only strategy: the policy Action + advisory metadata.

    ``action`` is the canonical policy-layer action the DAG hands to ``policy.evaluate``.
    ``explicit`` marks a directly-commanded action (rendered as an ``action`` block) vs. a
    ranked suggestion (rendered as a ``recommendation`` block).
    """

    action: Action
    action_type: ActionType
    rank: int = 1
    title: str = ""
    rationale: str = ""
    citations: tuple[Citation, ...] = ()
    gross_apy_bps: int | None = None
    projected_apy_bps: int | None = None
    performance_fee_bps: int | None = None
    explicit: bool = False


@dataclass(frozen=True)
class RecommendationResult:
    """The recommender's output. ``refused`` ⇒ surface a REFUSAL; ``degraded`` ⇒ the
    deterministic fallback ranking was used (model output was unusable)."""

    candidates: tuple[Candidate, ...]
    refused: bool = False
    degraded: bool = False


# ─────────────────────────────────────────────────────────────────────────────
# Whitelist-bound action builder — the code that pins protocol/target/recipient.
# ─────────────────────────────────────────────────────────────────────────────


def build_action(
    *,
    chain_id: int,
    action_type: ActionType,
    asset: Asset,
    amount: int,
    user_account: str,
    resolved_targets: dict[str, str],
    risk_profile: RiskProfile,
    risk_class: RiskProfile | None = None,
    max_slippage_bps: int | None = None,
) -> Action | None:
    """Build the canonical policy :class:`Action` for an allowlisted strategy, or ``None``.

    ``None`` when the ``(action_type, asset)`` pair is not on the resolved allowlist or its
    target is undeployed on this chain (fail-closed — an unrepresentable candidate is never
    surfaced). ``recipient`` is pinned to ``user_account`` (N1); ``selector`` / ``target`` /
    ``route_factory`` come straight from the policy constants the gate will re-check.

    ``risk_class`` (030) is the STRATEGY's own risk, which the policy gate compares against the
    mandate. It is deliberately separate from ``risk_profile`` — the USER's mandate — because
    passing the same value for both made the mandate check ``X > X`` and therefore unable ever to
    reject. When omitted it falls back to the strategy map, and finally to ``risk_profile``, which
    reproduces the pre-030 behaviour exactly rather than becoming more permissive by omission.
    """
    constants = get_policy_constants(chain_id)
    matched = None
    for candidate in constants.allowlist:
        if candidate.action is action_type and asset in candidate.assets:
            matched = candidate
            break
    if matched is None:
        return None
    target = resolve_target_ref(chain_id, matched.target_ref, resolved_targets)
    if target is None:
        return None
    route_factory: str | None = None
    if matched.route_factory_must_be is not None:
        route_factory = resolve_target_ref(
            chain_id, matched.route_factory_must_be, resolved_targets
        )
    slippage = max_slippage_bps if matched.slippage_bound else None
    return Action(
        action_type=action_type,
        target=target,
        selector=matched.selector,
        asset=asset,
        amount=amount,
        decimals=_ASSET_DECIMALS[asset],
        recipient=user_account,  # pinned in code — the model can never redirect funds (N1)
        risk_class=risk_class or _STRATEGY_RISK_CLASS.get(action_type, risk_profile),
        max_slippage_bps=slippage,
        route_factory=route_factory,
    )


# ─────────────────────────────────────────────────────────────────────────────
# LLM ranking parse (fail-closed).
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Rank:
    rank: int
    title: str
    rationale: str


def _parse_ranking(payload: object) -> dict[ActionType, _Rank]:
    """Validate the ranker's JSON into ``{action_type: _Rank}`` (raises if unusable)."""
    if not isinstance(payload, dict):
        raise TypeError("ranking payload must be a JSON object")
    items = payload.get("recommendations")
    if not isinstance(items, list):
        raise TypeError("recommendations must be a list")
    out: dict[ActionType, _Rank] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        try:
            action_type = ActionType(str(item.get("actionType")))
        except ValueError:
            continue  # off-whitelist actionType from the model — ignored (non-custody)
        rank = item.get("rank")
        title = item.get("title")
        rationale = item.get("rationale")
        if not isinstance(rank, int) or isinstance(rank, bool) or rank < 1:
            continue
        if not isinstance(title, str) or not isinstance(rationale, str):
            continue
        out.setdefault(action_type, _Rank(rank=rank, title=title.strip(),
                                          rationale=rationale.strip()))
    if not out:
        raise ValueError("no usable ranking entries")
    return out


# ─────────────────────────────────────────────────────────────────────────────
# Recommender
# ─────────────────────────────────────────────────────────────────────────────


@dataclass
class Recommender:
    """The ``propose`` stage runner. HIGH effort; produces advisory candidates only.

    ``knowledge`` (T125) is an OPTIONAL advisory retriever: when wired, the recommender
    attaches Obsidian-tier :class:`Citation`s to each candidate's provenance. It is
    fail-closed and non-authoritative — knowledge enriches the rationale but NEVER makes a
    block signable (that is the deterministic policy layer's ``approved`` status alone).
    """

    llm: AsyncClaudeClient
    effort: Effort = EFFORT
    knowledge: CitationRetriever | None = None

    async def propose(
        self, intent: Intent, ctx: ProposalContext, *, user: str | None = None
    ) -> RecommendationResult:
        """Produce ranked, whitelist-only :class:`Candidate`s for ``intent`` — fail-closed.

        A BUILD_ACTION turn yields the single commanded action (no ranking LLM call). A
        RECOMMEND turn builds the code-fixed yield set, then asks the model to rank + narrate
        it; a refusal returns no candidates, malformed output degrades to a deterministic
        ranking. The candidates are NOT yet policy-gated — the DAG stamps each one. ``user`` is
        the verified wallet (LiteLLM per-user budget/attribution key) — identity only, never
        authority; the whitelist + policy gate bind what can actually be built.
        """
        if intent.kind is IntentKind.BUILD_ACTION:
            explicit = self._build_explicit(intent, ctx)
            built_explicit: tuple[Candidate, ...] = (
                (explicit,) if explicit is not None else ()
            )
            built_explicit = await self._attach_knowledge(built_explicit, intent, ctx)
            return RecommendationResult(built_explicit)

        built = self._build_yield_candidates(intent, ctx)
        if not built:
            return RecommendationResult(())

        result = await self.llm.structured(
            system=RANK_SYSTEM,
            messages=[{"role": "user", "content": self._rank_prompt(built, ctx)}],
            parse=_parse_ranking,
            effort=self.effort,
            user=user,
        )
        if result.refused:
            return RecommendationResult((), refused=True)
        ranking = result.value if result.ok else None
        candidates = self._assemble(built, ranking, ctx)
        candidates = await self._attach_knowledge(candidates, intent, ctx)
        return RecommendationResult(candidates, degraded=ranking is None)

    # -- advisory knowledge citations (T125) ----------------------------------

    async def _attach_knowledge(
        self,
        candidates: tuple[Candidate, ...],
        intent: Intent,
        ctx: ProposalContext,
    ) -> tuple[Candidate, ...]:
        """Merge Obsidian-tier citations into each candidate (advisory, fail-closed)."""
        if self.knowledge is None or not candidates:
            return candidates
        extra = await self.knowledge.retrieve_citations(self._knowledge_query(intent, ctx))
        if not extra:
            return candidates
        return tuple(self._merge_citations(c, extra) for c in candidates)

    @staticmethod
    def _merge_citations(
        candidate: Candidate, extra: tuple[Citation, ...]
    ) -> Candidate:
        seen = {(c.provider, c.field, c.value) for c in candidate.citations}
        merged = list(candidate.citations)
        for citation in extra:
            key = (citation.provider, citation.field, citation.value)
            if key not in seen:
                seen.add(key)
                merged.append(citation)
        return replace(candidate, citations=tuple(merged))

    def _knowledge_query(self, intent: Intent, ctx: ProposalContext) -> str:
        parts: list[str] = []
        if intent.topic:
            parts.append(intent.topic)
        parts.append(f"{ctx.risk_profile.value} risk USDC yield vault Aave")
        return " ".join(parts)

    # -- explicit (directly-commanded) action ---------------------------------

    def _build_explicit(self, intent: Intent, ctx: ProposalContext) -> Candidate | None:
        """Build the single action the user commanded, or ``None`` if under-specified.

        Returns ``None`` when action/asset/amount are not all present — the DAG then asks a
        clarifying question rather than acting on a fabricated amount (non-custody).
        """
        if intent.action_type is None or intent.asset is None or intent.amount is None:
            return None
        slippage = (
            intent.max_slippage_bps
            if intent.max_slippage_bps is not None
            else ctx.default_max_slippage_bps
        )
        action = build_action(
            chain_id=ctx.chain_id,
            action_type=intent.action_type,
            asset=intent.asset,
            amount=intent.amount,
            user_account=ctx.user_account,
            resolved_targets=ctx.resolved_targets,
            risk_profile=ctx.risk_profile,
            max_slippage_bps=slippage,
        )
        if action is None:
            return None
        return Candidate(
            action=action,
            action_type=intent.action_type,
            explicit=True,
            gross_apy_bps=ctx.gross_apy_bps,
            projected_apy_bps=ctx.projected_apy_bps,
            performance_fee_bps=ctx.performance_fee_bps,
            citations=ctx.citations,
        )

    # -- ranked recommendations -----------------------------------------------

    def _build_yield_candidates(
        self, intent: Intent, ctx: ProposalContext
    ) -> list[tuple[ActionType, Action]]:
        amount = intent.amount or ctx.suggested_amount or DEFAULT_SUGGEST_AMOUNT
        built: list[tuple[ActionType, Action]] = []
        for action_type, asset, risk_class in _YIELD_STRATEGIES:
            action = build_action(
                chain_id=ctx.chain_id,
                action_type=action_type,
                asset=asset,
                amount=amount,
                user_account=ctx.user_account,
                resolved_targets=ctx.resolved_targets,
                risk_profile=ctx.risk_profile,
                risk_class=risk_class,
                max_slippage_bps=ctx.default_max_slippage_bps,
            )
            if action is not None:
                built.append((action_type, action))
        return built

    def _assemble(
        self,
        built: list[tuple[ActionType, Action]],
        ranking: dict[ActionType, _Rank] | None,
        ctx: ProposalContext,
    ) -> tuple[Candidate, ...]:
        candidates: list[Candidate] = []
        for index, (action_type, action) in enumerate(built):
            rank_info = ranking.get(action_type) if ranking is not None else None
            if rank_info is not None:
                rank, title = rank_info.rank, rank_info.title
                rationale = self._consistent_rationale(rank_info.rationale, action_type, ctx)
            else:
                rank = index + 1
                title = _DEFAULT_TITLE.get(action_type, action_type.value)
                rationale = self._template_rationale(action_type, ctx)
            candidates.append(
                Candidate(
                    action=action,
                    action_type=action_type,
                    rank=rank,
                    title=title or _DEFAULT_TITLE.get(action_type, action_type.value),
                    rationale=rationale or self._template_rationale(action_type, ctx),
                    citations=ctx.citations,
                    gross_apy_bps=ctx.gross_apy_bps,
                    projected_apy_bps=ctx.projected_apy_bps,
                    performance_fee_bps=ctx.performance_fee_bps,
                )
            )
        # Sort best-first, then re-normalize to dense positive ranks (§2.7 rank ≥ 1).
        candidates.sort(key=lambda c: (c.rank, c.action_type.value))
        return tuple(replace(c, rank=i + 1) for i, c in enumerate(candidates))

    def _consistent_rationale(
        self, rationale: str, action_type: ActionType, ctx: ProposalContext
    ) -> str:
        """The model's rationale, unless its RISK language contradicts the card it sits on.

        029/FR-009. The Aug-3 battery caught a card whose risk chip read "Lower · 1/5" while its
        own rationale sold "higher returns … more aggressive yield generation tactics". Both were
        on screen at once, so one of them was visibly lying — and a user cannot tell which. The
        candidate SET here is whitelist-only and conservative by construction (USDC lending), so
        the chip is the true statement and the prose is the drifting one. A rationale that reaches
        for aggressive-risk language is therefore replaced by the deterministic template, which is
        built only from injected data and cannot contradict anything.
        """
        if rationale and _AGGRESSIVE_RE.search(rationale):
            _logger.info(
                "rationale_risk_conflict: replaced a rationale whose risk language contradicted "
                "the conservative candidate set (action=%s)",
                action_type.value,
            )
            return self._template_rationale(action_type, ctx)
        return rationale

    def _template_rationale(self, action_type: ActionType, ctx: ProposalContext) -> str:
        """A safe, non-fabricated fallback rationale built only from injected data."""
        profile = ctx.risk_profile.value
        if ctx.gross_apy_bps is not None:
            gross = f"{ctx.gross_apy_bps / 100:.2f}% gross APY"
            if action_type is ActionType.VAULT_DEPOSIT and ctx.projected_apy_bps is not None:
                net = f"~{ctx.projected_apy_bps / 100:.2f}% net of the profit-only fee"
                return (
                    f"Matches your {profile}, capital-preservation mandate; {gross}, {net} "
                    "(0% on principal)."
                )
            return f"Matches your {profile} mandate; USDC yield at {gross}."
        return (
            f"Matches your {profile} mandate; USDC yield via the 0-management, profit-only "
            "vault."
        )

    def _rank_prompt(
        self, built: list[tuple[ActionType, Action]], ctx: ProposalContext
    ) -> str:
        lines = [
            f"risk_profile={ctx.risk_profile.value}",
            f"grossApyBps={ctx.gross_apy_bps}",
            f"projectedApyBps={ctx.projected_apy_bps}",
            f"performanceFeeBps={ctx.performance_fee_bps}",
            "strategies:",
        ]
        for action_type, action in built:
            lines.append(
                f"  - actionType={action_type.value} asset={action.asset.value} "
                f"amount={action.amount}"
            )
        return "\n".join(lines)
