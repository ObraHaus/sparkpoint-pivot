"""Typed models for the deterministic policy layer — inputs and the verdict.

These are plain frozen dataclasses (no pydantic, no network) so ``policy/`` stays
PURE and LLM-FREE: evaluate()'s ONLY inputs are the ``Action``, a ``PolicyContext``
of fresh chain reads + a fresh simulation, and the mirrored constants
(policy-schema.md §0 rule 6). The verdict is a ``PolicyVerdict`` mirroring the
shared ``PolicyVerdict`` wire schema (policy-schema.md §8 verdict shape /
agent-service-api.md §2.4).

Grounding: policy-schema.md §8 (evaluate inputs/outputs), §4 (caps), §5 (slippage),
§6 (session scope), §2 (enums).
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .enums import ActionType, Asset, ReasonCode, RiskProfile

# ─────────────────────────────────────────────────────────────────────────────
# Action — the proposed, NOT-yet-signable action under evaluation.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class Action:
    """A single proposed action (policy-schema.md §8 ``action``).

    Fields are the decoded, canonical form the policy layer reasons over. ``target``
    / ``selector`` are the on-chain ``(target, selector)`` pair matched against the
    allowlist (§3); ``asset`` is the SYMBOLIC ``Asset`` (not the wire token address)
    the ASSET step checks against ``entry.assets`` (§2.2); ``recipient`` is the
    decoded recipient field the RECIPIENT pin forces to the user's account (§3b).
    """

    action_type: ActionType
    target: str
    selector: str
    asset: Asset
    amount: int
    decimals: int
    recipient: str
    # conservative at launch (the on-chain allowlist already precludes higher tiers).
    risk_class: RiskProfile = RiskProfile.CONSERVATIVE
    # Swaps only: the user's chosen max slippage (overridable DOWN only). None ⇒ use
    # the mandate/constants default. Custody ops have no slippage dependency.
    max_slippage_bps: int | None = None
    # Swaps only: the Aerodrome ``Route[].factory`` — must equal the whitelisted
    # factory (§3). None for non-swaps.
    route_factory: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# PolicyContext — fresh chain reads + a fresh simulation. NEVER LLM/memory/cache.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CapHeadroom:
    """policy-schema.md §4 — remaining cap headroom, read fresh from chain.

    Each value is ``cap - current`` in raw base units, so the CAPS step (§8 step 4)
    checks ``action.amount <= headroom`` (i.e. the projected post-action state fits).
    ``None`` ⇒ the cap does not apply to this action (e.g. the vault TVL caps do not
    apply to a bare Aave supply; session caps do not apply off the session path) and
    is skipped. Checked ONLY for inflow/outflow — exits skip caps entirely (N2).
    """

    per_user: int | None = None
    total: int | None = None
    vault: int | None = None
    session_per_tx: int | None = None
    session_cumulative: int | None = None


@dataclass(frozen=True)
class MandateContext:
    """policy-schema.md §7 — the user's risk mandate the action must conform to."""

    max_risk_class: RiskProfile = RiskProfile.CONSERVATIVE


@dataclass(frozen=True)
class SimulationInput:
    """policy-schema.md §5/§8 step 6 — a FRESH simulation preview attached to ctx.

    ``None`` for the whole ctx.simulation slot means "no sim available" (swaps then
    fail-closed → SIM_UNAVAILABLE; exits are never blocked on availability, N2).
    ``provider`` mirrors the shared SimulationProvider (anvil_fork primary;
    viem_eth_call is the oracle-free custody dry-run fallback).
    """

    provider: str
    will_revert: bool
    revert_reason: str | None = None
    # Swaps only: simulated realized slippage (bps) and the embedded amountOutMin.
    slippage_bps: int | None = None
    min_out: int | None = None
    quote_out: int | None = None
    as_of_block: int | None = None


@dataclass(frozen=True)
class SessionState:
    """policy-schema.md §6 — the on-chain session-key state (fresh read).

    Only consulted when ``is_session_path`` (an automated, session-key-signed action).
    ``now_ts`` / ``valid_after`` / ``valid_until`` are unix seconds (uint48 on-chain).
    """

    is_session_path: bool = False
    revoked: bool = False
    now_ts: int | None = None
    valid_after: int | None = None
    valid_until: int | None = None


@dataclass(frozen=True)
class PolicyContext:
    """The deterministic inputs to evaluate() — fresh chain reads + fresh sim only.

    NEVER fed by an LLM, embeddings, memory, or cache (policy-schema.md §0 rule 6).
    """

    chain_id: int
    # The user's own SparkPointAccount + owner EOA — the ONLY permissible recipients
    # (N1). RECIPIENT pin asserts ``action.recipient`` ∈ {account, owner}.
    user_account: str
    owner: str | None = None
    # Deploy-time-determined target addresses (the vault) resolved from fresh chain
    # reads; passed to ``resolve_target_ref`` as overrides so the allowlist can match
    # the deployed vault the static address book leaves ``None``.
    resolved_targets: dict[str, str] = field(default_factory=dict)
    caps: CapHeadroom = field(default_factory=CapHeadroom)
    mandate: MandateContext = field(default_factory=MandateContext)
    simulation: SimulationInput | None = None
    # policy-schema.md §8 step 6b — True if any required input citation is older than
    # tolerance (fresh-read staleness). Gates non-exit actions only.
    data_stale: bool = False
    # policy-schema.md §8 step 7 — the kill-switch / pause state (fresh read).
    kill_switch_paused: bool = False
    session: SessionState = field(default_factory=SessionState)


# ─────────────────────────────────────────────────────────────────────────────
# PolicyVerdict — the LLM-free verdict + per-check trace.
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class CheckResult:
    """One step of the ordered §8 machine — the per-check audit trace entry."""

    step: str
    passed: bool
    # OK when the step passed or was skipped; the rejection code when it failed.
    reason: ReasonCode = ReasonCode.OK
    # True when the step did not apply to this action (e.g. caps for an exit).
    skipped: bool = False
    detail: str | None = None


@dataclass(frozen=True)
class PolicyVerdict:
    """policy-schema.md §8 verdict shape (mirrors the shared PolicyVerdict).

    ``status`` is ``approved`` iff every applicable step passed. A REJECTED verdict
    carries ``normalized_action = None`` — there is NO signable artifact for an
    out-of-policy action (§8; N-non-custody). ``policy_version`` is stamped on every
    verdict for the audit log + Trust Center (§1, N5).
    """

    status: str  # "approved" | "rejected"
    reasons: tuple[ReasonCode, ...]
    policy_version: str
    trace: tuple[CheckResult, ...]
    # Canonical action echoed back ONLY when approved; None when rejected (§8).
    normalized_action: Action | None = None

    @property
    def approved(self) -> bool:
        """True iff the verdict is ``approved`` (mirror of the wire ``approved`` bool)."""
        return self.status == "approved"

    @property
    def is_signable(self) -> bool:
        """A verdict yields a signable artifact ONLY when approved (non-custody)."""
        return self.approved and self.normalized_action is not None
