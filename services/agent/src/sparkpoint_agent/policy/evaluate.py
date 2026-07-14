"""The deterministic, fail-closed ``evaluate()`` — THE custody-critical safety spine.

PURE + LLM-FREE. This module imports NO llm/, NO knowledge/, NO memory/, and does
NO network I/O at decision time. Its ONLY inputs are the ``Action``, a
``PolicyContext`` of fresh chain reads + a fresh simulation, and the mirrored
constants (policy-schema.md §0 rule 6). A rejected action yields a verdict with
``normalized_action = None`` — NO signable artifact is ever produced for an
out-of-policy action (non-custody).

Implements policy-schema.md §8's ORDERED step machine EXACTLY, fail-closed — the
FIRST failing step rejects with its reason code and NO further processing:

    1.  SCHEMA          → SCHEMA_INVALID
    2.  PROTOCOL        → PROTOCOL_NOT_ALLOWLISTED / SELECTOR_NOT_ALLOWLISTED
    3.  ASSET           → ASSET_NOT_ALLOWLISTED
    3b. RECIPIENT       → RECIPIENT_NOT_USER
    4.  CAPS            → CAP_*_EXCEEDED            (exit → SKIP, N2)
    5.  MANDATE         → MANDATE_RISK_EXCEEDED     (exit → SKIP, N2)
    6.  SLIPPAGE/SIM    → SIM_REVERT / SLIPPAGE_EXCEEDED / MIN_OUT_BELOW_FLOOR / SIM_UNAVAILABLE
    6b. FRESHNESS       → DATA_STALE                (exit → SKIP)
    7.  KILL-SWITCH     → KILL_SWITCH_PAUSED        (exit → SKIP, N2)
    8.  SESSION         → SESSION_REVOKED / SESSION_EXPIRED

Every verdict is stamped with ``POLICY_VERSION`` (§1, N5) and carries a per-step
trace for the append-only audit log.
"""

from __future__ import annotations

import re

from .constants import (
    POLICY_VERSION,
    SLIPPAGE,
    AllowlistEntry,
    get_policy_constants,
    resolve_target_ref,
)
from .enums import RISK_PROFILE_RANK, ActionType, Direction, ReasonCode
from .models import Action, CheckResult, PolicyContext, PolicyVerdict

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_SELECTOR_RE = re.compile(r"^0x[0-9a-fA-F]{8}$")

# Account-level ops (authorizeSessionKey / revokeSessionKey on SparkPointAccount).
# NOT (target,selector) protocol entrypoints, so they bypass PROTOCOL/ASSET/RECIPIENT.
_SESSION_OPS = frozenset({ActionType.SESSION_KEY_GRANT, ActionType.SESSION_KEY_REVOKE})


def _addr_eq(a: str, b: str) -> bool:
    """Checksum-agnostic address equality (compare lower-cased)."""
    return a.lower() == b.lower()


def _reject(
    trace: list[CheckResult],
    step: str,
    code: ReasonCode,
    detail: str | None = None,
) -> PolicyVerdict:
    """Append the failing step and return a REJECTED verdict — no signable artifact."""
    trace.append(CheckResult(step=step, passed=False, reason=code, detail=detail))
    return PolicyVerdict(
        status="rejected",
        reasons=(code,),
        policy_version=POLICY_VERSION,
        trace=tuple(trace),
        normalized_action=None,
    )


def _passed(trace: list[CheckResult], step: str, detail: str | None = None) -> None:
    trace.append(CheckResult(step=step, passed=True, reason=ReasonCode.OK, detail=detail))


def _skipped(trace: list[CheckResult], step: str, detail: str | None = None) -> None:
    trace.append(
        CheckResult(step=step, passed=True, reason=ReasonCode.OK, skipped=True, detail=detail)
    )


def evaluate(action: Action, ctx: PolicyContext) -> PolicyVerdict:
    """Run the ordered, fail-closed §8 decision procedure and return a ``PolicyVerdict``.

    Deterministic and side-effect-free: the same ``(action, ctx)`` always yields the
    same verdict. The audit write is a SEPARATE side-channel (see ``audit.py``) so
    this function stays pure.
    """
    trace: list[CheckResult] = []

    # ── STEP 1 · SCHEMA ──────────────────────────────────────────────────────
    schema_err = _check_schema(action, ctx)
    if schema_err is not None:
        return _reject(trace, "SCHEMA", ReasonCode.SCHEMA_INVALID, schema_err)
    _passed(trace, "SCHEMA")

    # Session-key grant/revoke are account-level, not (target,selector) calls —
    # handled on their own fail-closed branch (§6). Everything else runs the
    # full protocol machine below.
    if action.action_type in _SESSION_OPS:
        return _evaluate_session_op(action, ctx, trace)

    constants = get_policy_constants(ctx.chain_id)  # chain support validated in SCHEMA

    # ── STEP 2 · PROTOCOL — (target,selector) ∈ allowlist (address-level, §3) ──
    matched, proto_reason = _match_allowlist(action, ctx, constants.allowlist)
    if matched is None:
        assert proto_reason is not None  # noqa: S101 — set whenever no match
        return _reject(trace, "PROTOCOL", proto_reason)
    _passed(trace, "PROTOCOL", detail=f"{matched.protocol}:{matched.selector}")
    direction = matched.direction

    # ── STEP 3 · ASSET — token ∈ entry.assets (vault asset == USDC via the entry) ─
    if action.asset not in matched.assets:
        return _reject(
            trace,
            "ASSET",
            ReasonCode.ASSET_NOT_ALLOWLISTED,
            detail=f"{action.asset} not in {[a.value for a in matched.assets]}",
        )
    _passed(trace, "ASSET")

    # ── STEP 3b · RECIPIENT — pinned to the user's own account/owner (N1, §3b) ──
    allowed_recipients = {ctx.user_account.lower()}
    if ctx.owner is not None:
        allowed_recipients.add(ctx.owner.lower())
    if action.recipient.lower() not in allowed_recipients:
        return _reject(
            trace, "RECIPIENT", ReasonCode.RECIPIENT_NOT_USER, detail="recipient != user_account"
        )
    _passed(trace, "RECIPIENT")

    # ── STEP 4 · CAPS — projected post-action state ≤ caps (exit → SKIP, N2) ────
    if direction is Direction.EXIT:
        _skipped(trace, "CAPS", detail="exit is never cap-gated (N2)")
    elif not matched.cap_gated:
        _skipped(trace, "CAPS", detail="entry not cap-gated")
    else:
        cap_reason = _check_caps(action, ctx)
        if cap_reason is not None:
            return _reject(trace, "CAPS", cap_reason)
        _passed(trace, "CAPS")

    # ── STEP 5 · MANDATE — action.riskClass ≤ mandate.maxRiskClass (exit → SKIP, N2) ─
    if direction is Direction.EXIT:
        _skipped(trace, "MANDATE", detail="exit is never mandate-gated (N2)")
    elif RISK_PROFILE_RANK[action.risk_class] > RISK_PROFILE_RANK[ctx.mandate.max_risk_class]:
        return _reject(
            trace,
            "MANDATE",
            ReasonCode.MANDATE_RISK_EXCEEDED,
            detail=f"{action.risk_class} > {ctx.mandate.max_risk_class}",
        )
    else:
        _passed(trace, "MANDATE")

    # ── STEP 6 · SLIPPAGE / SIM — fresh sim, no revert, slippage & min-out bounded ─
    sim_reason = _check_slippage_sim(action, ctx, matched, direction)
    if sim_reason is not None:
        return _reject(trace, "SLIPPAGE_SIM", sim_reason)
    _passed(trace, "SLIPPAGE_SIM")

    # ── STEP 6b · FRESHNESS — inputs within tolerance (exit unaffected) ─────────
    if direction is Direction.EXIT:
        _skipped(trace, "FRESHNESS", detail="custody/withdraw unaffected by staleness")
    elif ctx.data_stale:
        return _reject(trace, "FRESHNESS", ReasonCode.DATA_STALE)
    else:
        _passed(trace, "FRESHNESS")

    # ── STEP 7 · KILL-SWITCH — pause blocks inflow/outflow only (exit → SKIP, N2) ─
    if direction is Direction.EXIT:
        _skipped(trace, "KILL_SWITCH", detail="exit is never pause-gated (N2)")
    elif ctx.kill_switch_paused:
        return _reject(trace, "KILL_SWITCH", ReasonCode.KILL_SWITCH_PAUSED)
    else:
        _passed(trace, "KILL_SWITCH")

    # ── STEP 8 · SESSION — session-path grant not revoked & within validity ────
    session_reason = _check_session(ctx)
    if session_reason is not None:
        return _reject(trace, "SESSION", session_reason)
    if ctx.session.is_session_path:
        _passed(trace, "SESSION")
    else:
        _skipped(trace, "SESSION", detail="not a session-key path")

    # ── APPROVED — every applicable step passed; emit the signable normalized action ─
    return PolicyVerdict(
        status="approved",
        reasons=(ReasonCode.OK,),
        policy_version=POLICY_VERSION,
        trace=tuple(trace),
        normalized_action=action,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Step helpers — each returns a ReasonCode on failure, else None.
# ─────────────────────────────────────────────────────────────────────────────


def _check_schema(action: Action, ctx: PolicyContext) -> str | None:
    """STEP 1 — well-typed / well-formed fields, else a SCHEMA_INVALID detail string."""
    from .constants import SUPPORTED_CHAIN_IDS

    if ctx.chain_id not in SUPPORTED_CHAIN_IDS:
        return f"unsupported chainId {ctx.chain_id}"
    if not isinstance(action.action_type, ActionType):
        return "unknown action_type"
    if action.amount < 0:
        return "amount must be non-negative"
    if action.decimals < 0:
        return "decimals must be non-negative"
    if not _ADDRESS_RE.match(ctx.user_account):
        return "user_account is not a 20-byte address"

    # Account-level session ops carry no (target,selector)/asset/recipient — their
    # scope is validated on the §6 branch; skip the protocol-shape checks here.
    if action.action_type in _SESSION_OPS:
        return None

    if action.amount == 0:
        return "amount must be positive for a fund-moving action"
    if not _ADDRESS_RE.match(action.target):
        return "target is not a 20-byte address"
    if not _SELECTOR_RE.match(action.selector):
        return "selector is not a 4-byte selector"
    if not _ADDRESS_RE.match(action.recipient):
        return "recipient is not a 20-byte address"
    return None


def _match_allowlist(
    action: Action,
    ctx: PolicyContext,
    allowlist: tuple[AllowlistEntry, ...],
) -> tuple[AllowlistEntry | None, ReasonCode | None]:
    """STEP 2 — match ``(target, selector)`` against the resolved allowlist (§3).

    Returns the matched entry, or ``(None, reason)`` where reason distinguishes an
    unknown target (PROTOCOL_NOT_ALLOWLISTED) from a known target with a
    non-allowlisted selector / mismatched action / bad route factory
    (SELECTOR_NOT_ALLOWLISTED / PROTOCOL_NOT_ALLOWLISTED).
    """
    target_seen = False
    for entry in allowlist:
        resolved = resolve_target_ref(ctx.chain_id, entry.target_ref, ctx.resolved_targets)
        if resolved is None:
            continue  # unresolved target (e.g. vault pre-deploy) — fail-closed skip
        if not _addr_eq(resolved, action.target):
            continue
        target_seen = True
        if not _addr_eq(entry.selector, action.selector):
            continue
        # (target,selector) matched. The declared action_type must agree with the
        # selector's real action (a mismatched pair is not a real allowlist match).
        if entry.action is not action.action_type:
            return None, ReasonCode.SELECTOR_NOT_ALLOWLISTED
        # Aerodrome swaps: the Route[].factory must be the whitelisted factory (§3).
        if entry.route_factory_must_be is not None:
            want = resolve_target_ref(
                ctx.chain_id, entry.route_factory_must_be, ctx.resolved_targets
            )
            if want is None or action.route_factory is None or not _addr_eq(
                action.route_factory, want
            ):
                return None, ReasonCode.PROTOCOL_NOT_ALLOWLISTED
        return entry, None
    if target_seen:
        return None, ReasonCode.SELECTOR_NOT_ALLOWLISTED
    return None, ReasonCode.PROTOCOL_NOT_ALLOWLISTED


def _check_caps(action: Action, ctx: PolicyContext) -> ReasonCode | None:
    """STEP 4 — projected post-action state must fit each APPLICABLE cap (§4).

    ``headroom`` is ``cap - current`` (fresh read); a ``None`` headroom means the cap
    does not apply to this action and is skipped. Checked in the §8 order:
    per-user → total → vault → per-tx → cumulative.
    """
    caps = ctx.caps
    checks: tuple[tuple[int | None, ReasonCode], ...] = (
        (caps.per_user, ReasonCode.CAP_PER_USER_EXCEEDED),
        (caps.total, ReasonCode.CAP_TOTAL_EXCEEDED),
        (caps.vault, ReasonCode.CAP_VAULT_EXCEEDED),
        (caps.session_per_tx, ReasonCode.CAP_PER_TX_EXCEEDED),
        (caps.session_cumulative, ReasonCode.CAP_CUMULATIVE_EXCEEDED),
    )
    for headroom, code in checks:
        if headroom is not None and action.amount > headroom:
            return code
    return None


def _check_slippage_sim(
    action: Action,
    ctx: PolicyContext,
    entry: AllowlistEntry,
    direction: Direction,
) -> ReasonCode | None:
    """STEP 6 — fresh sim: no revert; for swaps, slippage ≤ userMax and min-out ≥ floor.

    Swaps fail-closed when the sim is unavailable (SIM_UNAVAILABLE). Oracle-free
    custody ops (vault/Aave deposit·supply·withdraw·redeem) may fall back to a local
    dry-run: an inflow with NO sim result at all still fails closed, but an EXIT is
    never blocked on sim availability (N2 — a withdraw must always be constructible).
    """
    sim = ctx.simulation

    if entry.slippage_bound:  # aerodrome_swap — oracle/price-dependent
        if sim is None:
            return ReasonCode.SIM_UNAVAILABLE  # swaps fail-closed
        if sim.will_revert:
            return ReasonCode.SIM_REVERT
        # slippage ≤ effective user max (mandate default, overridable DOWN; clamped
        # to the absolute ceiling).
        effective_max = action.max_slippage_bps
        if effective_max is None:
            effective_max = SLIPPAGE.user_max_bps
        effective_max = min(effective_max, SLIPPAGE.absolute_ceiling_bps)
        if sim.slippage_bps is None or sim.slippage_bps > effective_max:
            return ReasonCode.SLIPPAGE_EXCEEDED
        # amountOutMin must be present and > 0 (an unprotected min-out is below floor).
        if sim.min_out is None or sim.min_out <= 0:
            return ReasonCode.MIN_OUT_BELOW_FLOOR
        return None

    # Oracle-free custody op.
    if sim is not None:
        if sim.will_revert:
            return ReasonCode.SIM_REVERT
        return None
    # No sim available.
    if direction is Direction.EXIT:
        return None  # N2 — never block a withdraw on sim availability (dry-run assumed)
    return ReasonCode.SIM_UNAVAILABLE  # inflow with no sim/dry-run → fail-closed


def _check_session(ctx: PolicyContext) -> ReasonCode | None:
    """STEP 8 — the session-key grant is not revoked and is within its validity window."""
    s = ctx.session
    if not s.is_session_path:
        return None
    if s.revoked:
        return ReasonCode.SESSION_REVOKED
    if s.valid_until is None:
        return ReasonCode.SESSION_EXPIRED  # a session with no hard expiry is invalid (N4)
    if s.now_ts is not None:
        if s.now_ts > s.valid_until:
            return ReasonCode.SESSION_EXPIRED
        if s.valid_after is not None and s.now_ts < s.valid_after:
            return ReasonCode.SESSION_EXPIRED
    return None


def _evaluate_session_op(
    action: Action,
    ctx: PolicyContext,
    trace: list[CheckResult],
) -> PolicyVerdict:
    """§6 branch for account-level session ops.

    ``session_key_revoke`` is ``direction: exit`` — owner-only, instant, unilateral,
    and NEVER cap-/pause-gated (N2, §6 rule 7): it is approved (the sacred revoke
    path must never be blocked by the off-chain layer).

    ``session_key_grant`` requires a full ``SessionScope`` validation (§6 grammar) —
    the subset-of-global allowlist, hard expiry, cap/slippage bounds, forbidden
    selectors — which is NOT expressible on a bare ``Action``. Fail-closed: a grant
    is rejected here (SCHEMA_INVALID) pending the dedicated SessionScope entrypoint,
    rather than silently approved. (See RETURN notes — spec-ambiguity resolution.)
    """
    if action.action_type is ActionType.SESSION_KEY_REVOKE:
        for step in ("PROTOCOL", "ASSET", "RECIPIENT", "CAPS", "MANDATE", "SLIPPAGE_SIM",
                     "FRESHNESS", "KILL_SWITCH"):
            _skipped(trace, step, detail="session_key_revoke is a sacred exit (N2, §6.7)")
        _skipped(trace, "SESSION", detail="revoke does not depend on session validity (§6.7)")
        return PolicyVerdict(
            status="approved",
            reasons=(ReasonCode.OK,),
            policy_version=POLICY_VERSION,
            trace=tuple(trace),
            normalized_action=action,
        )
    return _reject(
        trace,
        "SESSION",
        ReasonCode.SCHEMA_INVALID,
        detail="session_key_grant requires SessionScope validation (§6), not a bare Action",
    )
