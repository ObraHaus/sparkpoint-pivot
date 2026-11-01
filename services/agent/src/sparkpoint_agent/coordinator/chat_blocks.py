"""ChatBlock wire models + the policy→wire mappers the Coordinator DAG emits.

Grounding: agent-service-api.md §2.7 (the ``ChatBlock`` discriminated union), §2.4
(PolicyVerdict), §2.5 (GuardrailCheck), §2.6 (Citation), §3.4 (recommendation shape).
These are the Python producers for the exact shapes the frontend validates with the
shared zod schemas (packages/shared/src/schemas/chat-block.ts). Each block's
``to_wire()`` emits the canonical camelCase JSON; optional fields are OMITTED (never
``null``) so the frontend's ``.strict()`` optionals accept them.

Signability rule (§2.7): a ``recommendation`` / ``action`` block is signable ONLY when
``policy.status == "approved"``. The stamp here is derived SOLELY from the deterministic
:class:`~sparkpoint_agent.policy.PolicyVerdict` (``policy.evaluate``) — never from the
LLM. A rejected verdict produces a ``rejected`` stamp with a human ``reason`` and no
signable path (the renderer shows no sign button).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

from ..policy import (
    Action,
    ActionType,
    Asset,
    CheckResult,
    PolicyVerdict,
    Protocol,
    ReasonCode,
    get_addresses,
)
from ..wire import Citation

BlockStatus = Literal["running", "done", "error"]
GuardrailStatus = Literal["pass", "fail", "warn"]
PolicyStatus = Literal["approved", "rejected"]
OutcomeStatus = Literal["open", "closed"]


# ─────────────────────────────────────────────────────────────────────────────
# Human-legible strings for the policy→wire mapping.
# ─────────────────────────────────────────────────────────────────────────────

# §2.5 — the confirmation-checklist row label per ordered §8 step.
_STEP_LABEL: dict[str, str] = {
    "SCHEMA": "Action is well-formed",
    "PROTOCOL": "Target is a whitelisted protocol",
    "ASSET": "Asset is allowlisted",
    "RECIPIENT": "Funds go to your own account only",
    "CAPS": "Within your deposit caps",
    "MANDATE": "Matches your risk mandate",
    "SLIPPAGE_SIM": "Simulated with acceptable slippage",
    "FRESHNESS": "Priced on fresh data",
    "KILL_SWITCH": "Deposits are not paused",
    "SESSION": "Session-key scope is valid",
}

# §1.5 / §2.4 — the user-facing message per rejection ReasonCode.
_REASON_MESSAGE: dict[ReasonCode, str] = {
    ReasonCode.OK: "All checks passed.",
    ReasonCode.SCHEMA_INVALID: "This action is malformed and cannot be built.",
    ReasonCode.PROTOCOL_NOT_ALLOWLISTED: "That protocol is not on the SparkPoint whitelist.",
    ReasonCode.SELECTOR_NOT_ALLOWLISTED: "That contract call is not on the SparkPoint whitelist.",
    ReasonCode.ASSET_NOT_ALLOWLISTED: "That asset is not supported for this action.",
    ReasonCode.RECIPIENT_NOT_USER: "Funds can only ever go to your own account.",
    ReasonCode.CAP_PER_USER_EXCEEDED: "This would exceed your per-user deposit cap.",
    ReasonCode.CAP_TOTAL_EXCEEDED: "This would exceed the protocol-wide deposit cap.",
    ReasonCode.CAP_VAULT_EXCEEDED: "This would exceed the vault deposit cap.",
    ReasonCode.CAP_PER_TX_EXCEEDED: "This exceeds the per-transaction session cap.",
    ReasonCode.CAP_CUMULATIVE_EXCEEDED: "This exceeds the cumulative session cap.",
    ReasonCode.MANDATE_RISK_EXCEEDED: "This is riskier than your current mandate allows.",
    ReasonCode.SLIPPAGE_EXCEEDED: "The simulated slippage exceeds your maximum.",
    ReasonCode.MIN_OUT_BELOW_FLOOR: "The swap has no valid minimum-output protection.",
    ReasonCode.SIM_REVERT: "The simulation predicts this transaction would revert.",
    ReasonCode.SIM_UNAVAILABLE: "A fresh simulation is unavailable, so this is blocked.",
    ReasonCode.DATA_STALE: "Required market data is stale; execution is blocked.",
    ReasonCode.KILL_SWITCH_PAUSED: "New deposits are paused by the kill-switch.",
    ReasonCode.SESSION_EXPIRED: "The session key has expired.",
    ReasonCode.SESSION_REVOKED: "The session key has been revoked.",
}

# §3.4 — the surfaced ``protocol`` for a recommendation. A vault deposit is surfaced by
# its underlying yield source (Aave v3) per the §3.4 example; a bare Aave supply is
# likewise aave_v3; an Aerodrome swap is aerodrome. (Whitelist only — FR-016.)
_RECOMMENDATION_PROTOCOL: dict[ActionType, Protocol] = {
    ActionType.VAULT_DEPOSIT: Protocol.AAVE_V3,
    ActionType.VAULT_WITHDRAW: Protocol.AAVE_V3,
    ActionType.VAULT_REDEEM: Protocol.AAVE_V3,
    ActionType.AAVE_SUPPLY: Protocol.AAVE_V3,
    ActionType.AAVE_WITHDRAW: Protocol.AAVE_V3,
    ActionType.AERODROME_SWAP: Protocol.AERODROME,
}


def recommendation_protocol(action_type: ActionType) -> Protocol:
    """The whitelisted ``protocol`` surfaced for a recommendation (§3.4, FR-016)."""
    return _RECOMMENDATION_PROTOCOL.get(action_type, Protocol.SPARKPOINT_VAULT)


def token_address(chain_id: int, asset: Asset) -> str:
    """Map a symbolic policy ``Asset`` to its on-chain token address for the wire.

    On the wire an action's ``asset`` is a 0x TOKEN ADDRESS (schemas/action.ts), not the
    symbolic ``Asset`` the policy layer reasons over. ETH is represented by WETH.
    """
    book = get_addresses(chain_id)
    return book.usdc if asset is Asset.USDC else book.weth


def token_decimals(chain_id: int, asset: Asset) -> int:
    """Decimals of the token behind a symbolic policy ``Asset`` on ``chain_id``.

    ETH/WETH is 18 everywhere. The generic stablecoin slot is 6 dp on Base mainnet / Base Sepolia /
    Robinhood Chain 4663 (USDG, verified on-chain) but 18 dp on Robinhood testnet 46630. Mirrors the
    web's per-chain table (`apps/web/src/lib/swap/tokens.ts`) — the inline swap card scales the
    assistant's base-unit amount with the resolved token's decimals, so a wrong number here would
    mis-scale a pre-filled swap by 1e12.
    """
    if asset is Asset.ETH:
        return 18
    return 18 if chain_id == 46630 else 6


# ─────────────────────────────────────────────────────────────────────────────
# Provenance + verdict wire pieces.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class GuardrailCheck:
    """§2.5 — one row of the confirmation checklist."""

    id: str
    label: str
    status: GuardrailStatus
    detail: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {"id": self.id, "label": self.label, "status": self.status}
        if self.detail is not None:
            wire["detail"] = self.detail
        return wire


def guardrail_check(check: CheckResult) -> GuardrailCheck:
    """Map one policy §8 :class:`CheckResult` to a §2.5 checklist row.

    A failed step is ``fail``; a not-applicable (skipped) step is ``pass`` (it never
    blocks — e.g. caps/kill-switch are skipped for an exit, N2); an applied+passed step
    is ``pass``. Only ``fail`` marks a blocking guardrail.
    """
    status: GuardrailStatus = "pass" if check.passed else "fail"
    label = _STEP_LABEL.get(check.step, check.step.replace("_", " ").title())
    return GuardrailCheck(id=check.step.lower(), label=label, status=status, detail=check.detail)


@dataclass(frozen=True)
class ChatPolicyStamp:
    """§2.7 — the policy stamp on a recommendation/action block.

    ``checks`` accompanies an approved stamp; ``reason`` accompanies a rejection. Built
    ONLY from the deterministic verdict (never the LLM).
    """

    status: PolicyStatus
    checks: tuple[GuardrailCheck, ...] | None = None
    reason: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {"status": self.status}
        if self.checks is not None:
            wire["checks"] = [c.to_wire() for c in self.checks]
        if self.reason is not None:
            wire["reason"] = self.reason
        return wire


def policy_stamp(verdict: PolicyVerdict) -> ChatPolicyStamp:
    """Derive the §2.7 ChatBlock stamp from a deterministic :class:`PolicyVerdict`.

    Approved → the full checklist (``checks``); rejected → a human ``reason`` from the
    first rejection code. The status mirrors ``verdict.status`` verbatim, so
    ``policy.status == "approved"`` is true iff ``verdict.is_signable`` semantics hold.
    """
    if verdict.approved:
        return ChatPolicyStamp(
            status="approved",
            checks=tuple(guardrail_check(c) for c in verdict.trace),
        )
    first = verdict.reasons[0] if verdict.reasons else ReasonCode.SCHEMA_INVALID
    return ChatPolicyStamp(status="rejected", reason=_REASON_MESSAGE.get(first, first.value))


def proposed_action_wire(
    action: Action,
    chain_id: int,
    *,
    recommendation_id: str | None = None,
) -> dict[str, Any]:
    """Map a policy :class:`Action` to the §2.7/§3.5 ``ProposedAction`` wire shape.

    Symbolic ``Asset`` → token address; ``int`` amount → base-unit string; ``params`` is
    present ONLY for swaps (``maxSlippageBps`` required for swaps, absent for custody ops
    per schemas/action.ts). This is NOT yet a signable bundle — materializing one is the
    single ``/build-tx`` chokepoint (§3.5).
    """
    wire: dict[str, Any] = {
        "type": action.action_type.value,
        "asset": token_address(chain_id, action.asset),
        "decimals": action.decimals,
        "amount": str(action.amount),
    }
    if action.max_slippage_bps is not None:
        wire["params"] = {"maxSlippageBps": action.max_slippage_bps}
    if recommendation_id is not None:
        wire["recommendationId"] = recommendation_id
    return wire


# ─────────────────────────────────────────────────────────────────────────────
# ChatBlock discriminated union (§2.7).
# ─────────────────────────────────────────────────────────────────────────────


class ChatBlock:
    """Base marker for the §2.7 streamed envelope union. Subclasses emit ``to_wire()``."""

    def to_wire(self) -> dict[str, Any]:  # pragma: no cover - overridden
        raise NotImplementedError


@dataclass(frozen=True)
class TextBlock(ChatBlock):
    """§2.7 ``text`` — streamed incrementally on the wire; a complete markdown chunk."""

    markdown: str

    def to_wire(self) -> dict[str, Any]:
        return {"type": "text", "markdown": self.markdown}


@dataclass(frozen=True)
class ProseDelta:
    """059 — an INCREMENTAL prose delta on the SSE surface (``event: text-delta``).

    Deliberately NOT a :class:`ChatBlock`: it is never persisted, never counted in ``blockCount``,
    and never validated as a card. It only paints text while the final ``text`` / ``tip`` block is
    still generating. The final block is authoritative and replaces whatever deltas preceded it
    (a guardrail rewrite, a clamp, a retry, or a fallback), which is what keeps the persisted
    transcript and the wire contract exactly as they were before streaming.

    ``target`` tells the renderer which slot the deltas belong to (``text`` for Sparky, ``tip``
    for a literacy card); ``stream_id`` changes when a retry starts, so the client resets the
    partial text instead of appending a second attempt to the first.
    """

    target: Literal["text", "tip"]
    delta: str
    stream_id: str


@dataclass(frozen=True)
class ToolStepBlock(ChatBlock):
    """§2.7 ``tool_step`` — the SUMMARIZED, code-authored reasoning trace (never raw CoT)."""

    label: str
    status: BlockStatus

    def to_wire(self) -> dict[str, Any]:
        return {"type": "tool_step", "label": self.label, "status": self.status}


@dataclass(frozen=True)
class RecommendationBlock(ChatBlock):
    """§2.7 ``recommendation`` — advisory, whitelist-only, policy-stamped (not signable)."""

    rec_id: str
    title: str
    rank: int
    rationale: str
    protocol: Protocol
    proposed_action: dict[str, Any]
    policy: ChatPolicyStamp
    citations: tuple[Citation, ...] = ()
    #: 030 — the card's truthful metadata. `risk_tier` is the STRATEGY's own 1..5 tier (the web
    #: hardcoded 1 on every card because the wire carried nothing); `fee_stance` and `managed_by`
    #: state the only real difference between the live strategies, so the comparison need not be
    #: invented. Defaults keep every pre-030 construction valid.
    risk_tier: int = 1
    fee_stance: str = "unknown"
    managed_by: str = "unknown"

    def to_wire(self) -> dict[str, Any]:
        return {
            "type": "recommendation",
            "recId": self.rec_id,
            "title": self.title,
            "rank": self.rank,
            "rationale": self.rationale,
            "protocol": self.protocol.value,
            "proposedAction": self.proposed_action,
            "policy": self.policy.to_wire(),
            "citations": [c.to_wire() for c in self.citations],
            "riskTier": self.risk_tier,
            "feeStance": self.fee_stance,
            "managedBy": self.managed_by,
        }


@dataclass(frozen=True)
class ActionBlock(ChatBlock):
    """§2.7 ``action`` — a directly-commanded action + its stamp (signable iff approved)."""

    proposed_action: dict[str, Any]
    policy: ChatPolicyStamp

    def to_wire(self) -> dict[str, Any]:
        return {
            "type": "action",
            "proposedAction": self.proposed_action,
            "policy": self.policy.to_wire(),
        }


@dataclass(frozen=True)
class PortfolioSnapshotBlock(ChatBlock):
    """§2.7 ``portfolio_snapshot`` — trimmed ``PositionLite`` rows (§2.7)."""

    positions: tuple[dict[str, Any], ...]

    def to_wire(self) -> dict[str, Any]:
        return {"type": "portfolio_snapshot", "positions": [dict(p) for p in self.positions]}


@dataclass(frozen=True)
class TipBlock(ChatBlock):
    """§2.7 ``tip`` — a literacy TipCard (FR-007). Inherently non-signable (no action)."""

    topic: str
    body: str

    def to_wire(self) -> dict[str, Any]:
        return {"type": "tip", "topic": self.topic, "body": self.body}


@dataclass(frozen=True)
class OutcomeBlock(ChatBlock):
    """§2.7 ``outcome`` — realized/unrealized PnL for a recommendation."""

    rec_id: str
    realized_pnl_usd: str
    status: OutcomeStatus

    def to_wire(self) -> dict[str, Any]:
        return {
            "type": "outcome",
            "recId": self.rec_id,
            "realizedPnlUsd": self.realized_pnl_usd,
            "status": self.status,
        }


@dataclass(frozen=True)
class CitationBlock(ChatBlock):
    """§2.7 ``citation`` — the provenance set for the turn."""

    sources: tuple[Citation, ...]

    def to_wire(self) -> dict[str, Any]:
        return {"type": "citation", "sources": [c.to_wire() for c in self.sources]}


@dataclass(frozen=True)
class ErrorBlock(ChatBlock):
    """§2.7 ``error`` — a typed, fail-closed error (e.g. REFUSAL). Never a sign request."""

    code: str
    message: str

    def to_wire(self) -> dict[str, Any]:
        return {"type": "error", "code": self.code, "message": self.message}


CrossChainState = Literal["preview", "unavailable"]


@dataclass(frozen=True)
class CrossChainQuoteBlock(ChatBlock):
    """068 ``crosschain_quote`` — a preview from the NEAR Intents 1Click API.

    Deliberately NOT signable: it carries no calldata and no signature. A confirm is a separate
    ``POST /crosschain/quote`` with ``dry=false``; the user sends the origin funds from their own
    wallet when 1Click returns a deposit address. ``state=unavailable`` is an ordinary answer
    (e.g. Tron payouts are paused), never an error block.
    """

    state: CrossChainState
    origin: dict[str, Any]
    destination: dict[str, Any]
    amount_out: str | None = None
    amount_out_usd: str | None = None
    amount_in_usd: str | None = None
    min_amount_out: str | None = None
    time_estimate_sec: int | None = None
    slippage_bps: int | None = None
    fee_note: str | None = None
    unavailable_reason: str | None = None
    quoted_at: str | None = None
    expires_hint: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "type": "crosschain_quote",
            "state": self.state,
            "origin": dict(self.origin),
            "destination": dict(self.destination),
        }
        for attr, key in (
            ("amount_out", "amountOut"),
            ("amount_out_usd", "amountOutUsd"),
            ("amount_in_usd", "amountInUsd"),
            ("min_amount_out", "minAmountOut"),
            ("time_estimate_sec", "timeEstimateSec"),
            ("slippage_bps", "slippageBps"),
            ("fee_note", "feeNote"),
            ("unavailable_reason", "unavailableReason"),
            ("quoted_at", "quotedAt"),
            ("expires_hint", "expiresHint"),
        ):
            value = getattr(self, attr)
            if value is not None:
                wire[key] = value
        return wire


@dataclass(frozen=True)
class PositionLite:
    """§2.7 ``PositionLite`` — the trimmed position echoed in a portfolio_snapshot."""

    venue: str
    asset: str
    value_usd: str
    shares: str | None = None
    underlying: str | None = None
    price_source: str | None = None
    cost_basis_usd: str | None = None
    unrealized_pnl_usd: str | None = None
    risk_tier: str | None = None

    def to_wire(self) -> dict[str, Any]:
        wire: dict[str, Any] = {
            "venue": self.venue,
            "asset": self.asset,
            "valueUsd": self.value_usd,
        }
        for attr, key in (
            ("shares", "shares"),
            ("underlying", "underlying"),
            ("price_source", "priceSource"),
            ("cost_basis_usd", "costBasisUsd"),
            ("unrealized_pnl_usd", "unrealizedPnlUsd"),
            ("risk_tier", "riskTier"),
        ):
            value = getattr(self, attr)
            if value is not None:
                wire[key] = value
        return wire
