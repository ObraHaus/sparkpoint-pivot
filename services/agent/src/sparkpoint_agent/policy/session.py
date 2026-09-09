"""SessionScope grammar validation (policy-schema.md §6, N4) — the deterministic grant gate.

The off-chain counterpart to ``SparkPointAccount.authorizeSessionKey``: given a proposed session-key
grant (a ``SessionScope``), it enforces the §6 grammar rules (1–6) BEFORE the user is ever shown a
signable grant UserOp, so on-chain == displayed (FR-029) and an out-of-policy grant can never be
signed. PURE + LLM-FREE, like ``evaluate()``: the only inputs are the ``SessionScope``, a
``PolicyContext`` of fresh chain reads, the reference timestamp, and the mirrored constants.

``session_key_revoke`` is NOT validated here — it is a sacred exit approved unconditionally in
``evaluate()`` (§6 rule 7, N2). This module governs ONLY the ``session_key_grant`` path.

Reuses the parity-locked ``ReasonCode`` set (enums.py); it introduces NO new codes.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .constants import (
    CAPS,
    POLICY_VERSION,
    SESSION_BOUNDS,
    SLIPPAGE,
    AllowlistEntry,
    get_policy_constants,
    resolve_target_ref,
)
from .enums import ReasonCode
from .models import CheckResult, PolicyContext, PolicyVerdict

# Aerodrome swap selector — the only session action whose slippage floor is load-bearing (§5).
_SWAP_SELECTOR = "0xcac88ea9"
_SECONDS_PER_DAY = 86_400


@dataclass(frozen=True)
class SessionScopePair:
    """One ``(target, selector)`` the session key may call — a subset of the global §3 set."""

    target: str
    selector: str


@dataclass(frozen=True)
class SessionScope:
    """policy-schema.md §6 — the structure a user signs to authorize opt-in automation (N4).

    Maps 1:1 to the on-chain ``Policy`` + its allowlist snapshot. Amounts are raw USDC base units;
    ``valid_after``/``valid_until`` are unix seconds (uint48; ``valid_after == 0`` ⇒ active
    immediately). ``session_key`` is the PUBLIC key only.
    """

    session_key: str
    valid_after: int
    valid_until: int
    per_tx_cap: int
    cumulative_cap: int
    max_slippage_bps: int
    allowlist: tuple[SessionScopePair, ...]
    recipient_pin: str = "user_account"
    spent: int = 0


@dataclass(frozen=True)
class SessionGrantVerdict:
    """The grant decision + the validated scope echoed back (verbatim) when approved."""

    verdict: PolicyVerdict
    scope: SessionScope | None  # normalized scope for the grant UserOp; None if rejected


def _addr_eq(a: str, b: str) -> bool:
    return a.lower() == b.lower()


def _reject(
    trace: list[CheckResult], step: str, code: ReasonCode, detail: str
) -> SessionGrantVerdict:
    trace.append(CheckResult(step=step, passed=False, reason=code, detail=detail))
    return SessionGrantVerdict(
        verdict=PolicyVerdict(
            status="rejected",
            reasons=(code,),
            policy_version=POLICY_VERSION,
            trace=tuple(trace),
            normalized_action=None,
        ),
        scope=None,
    )


def _passed(trace: list[CheckResult], step: str, detail: str | None = None) -> None:
    trace.append(CheckResult(step=step, passed=True, reason=ReasonCode.OK, detail=detail))


def _pair_in_global(
    pair: SessionScopePair, ctx: PolicyContext, allowlist: tuple[AllowlistEntry, ...]
) -> ReasonCode | None:
    """None if the resolved ``(target, selector)`` is a member of the global §3 allowlist, else the
    distinguishing reason (unknown target ⇒ PROTOCOL; known target, wrong selector ⇒ SELECTOR)."""
    target_seen = False
    for entry in allowlist:
        resolved = resolve_target_ref(ctx.chain_id, entry.target_ref, ctx.resolved_targets)
        if resolved is None or not _addr_eq(resolved, pair.target):
            continue
        target_seen = True
        if _addr_eq(entry.selector, pair.selector):
            return None
    if target_seen:
        return ReasonCode.SELECTOR_NOT_ALLOWLISTED
    return ReasonCode.PROTOCOL_NOT_ALLOWLISTED


def evaluate_session_grant(
    scope: SessionScope, ctx: PolicyContext, *, now_ts: int
) -> SessionGrantVerdict:
    """Validate a ``session_key_grant`` against the §6 grammar (rules 1–6). Fail-closed, pure.

    Ordered so the FIRST failing rule rejects with its reason and no further processing:
      SCHEMA → ALLOWLIST_SUBSET (rule 1 + rule 6 forbidden) → EXPIRY (rule 2) →
      SLIPPAGE (rule 3) → CAPS (rule 4) → RECIPIENT (rule 5).
    """
    trace: list[CheckResult] = []
    consts = get_policy_constants(ctx.chain_id)  # raises on unsupported chain (fail-closed)

    # ── SCHEMA — well-formed fields ──────────────────────────────────────────
    if not scope.session_key or scope.session_key == "0x" + "0" * 40:
        return _reject(trace, "SCHEMA", ReasonCode.SCHEMA_INVALID, "missing/zero session key")
    if not scope.allowlist:
        return _reject(trace, "SCHEMA", ReasonCode.SCHEMA_INVALID, "empty session allowlist")
    if scope.per_tx_cap <= 0 or scope.cumulative_cap <= 0:
        return _reject(trace, "SCHEMA", ReasonCode.SCHEMA_INVALID, "caps must be positive")
    if scope.per_tx_cap > scope.cumulative_cap:
        return _reject(
            trace, "SCHEMA", ReasonCode.SCHEMA_INVALID, "per-tx cap exceeds cumulative cap"
        )
    _passed(trace, "SCHEMA")

    # ── RULE 1 (+ RULE 6) — allowlist ⊆ global §3, and no forbidden selector ──
    for pair in scope.allowlist:
        if pair.selector.lower() in SESSION_BOUNDS.forbidden_selectors:
            return _reject(
                trace, "ALLOWLIST_SUBSET", ReasonCode.SELECTOR_NOT_ALLOWLISTED,
                f"forbidden selector {pair.selector} can never be seeded",
            )
        miss = _pair_in_global(pair, ctx, consts.allowlist)
        if miss is not None:
            return _reject(
                trace, "ALLOWLIST_SUBSET", miss,
                f"{pair.target}:{pair.selector} not in the global allowlist (narrow-only, §6.1)",
            )
    _passed(trace, "ALLOWLIST_SUBSET", detail=f"{len(scope.allowlist)} pair(s) ⊆ global")

    # ── RULE 2 — validUntil required, future, within maxSessionDuration (no infinite session) ─
    if scope.valid_until <= 0:
        return _reject(
            trace, "EXPIRY", ReasonCode.SESSION_EXPIRED, "validUntil required (no infinite session)"
        )
    if scope.valid_until <= now_ts:
        return _reject(
            trace, "EXPIRY", ReasonCode.SESSION_EXPIRED, "validUntil must be in the future"
        )
    if scope.valid_after and scope.valid_after >= scope.valid_until:
        return _reject(
            trace, "EXPIRY", ReasonCode.SESSION_EXPIRED, "validAfter must precede validUntil"
        )
    span_start = scope.valid_after if scope.valid_after > 0 else now_ts
    max_span = SESSION_BOUNDS.max_session_duration_days * _SECONDS_PER_DAY
    if scope.valid_until - span_start > max_span:
        return _reject(
            trace, "EXPIRY", ReasonCode.SESSION_EXPIRED,
            f"duration > maxSessionDurationDays ({SESSION_BOUNDS.max_session_duration_days}d)",
        )
    _passed(trace, "EXPIRY")

    # ── RULE 3 — maxSlippageBps ∈ [floor, ceiling] (only when a swap is in scope) ─
    has_swap = any(_addr_eq(p.selector, _SWAP_SELECTOR) for p in scope.allowlist)
    if has_swap:
        lo, hi = SLIPPAGE.protocol_floor_bps, SLIPPAGE.absolute_ceiling_bps
        if not lo <= scope.max_slippage_bps <= hi:
            return _reject(
                trace, "SLIPPAGE", ReasonCode.SLIPPAGE_EXCEEDED,
                f"maxSlippageBps {scope.max_slippage_bps} outside "
                f"[{SLIPPAGE.protocol_floor_bps}, {SLIPPAGE.absolute_ceiling_bps}]",
            )
        _passed(trace, "SLIPPAGE")
    else:
        _passed(trace, "SLIPPAGE", detail="no swap in scope; slippage n/a")

    # ── RULE 4 — per-tx / cumulative caps ≤ the global session ceilings ──────
    if scope.per_tx_cap > CAPS.session_per_tx.amount:
        return _reject(
            trace, "CAPS", ReasonCode.CAP_PER_TX_EXCEEDED,
            f"per-tx cap {scope.per_tx_cap} > ceiling {CAPS.session_per_tx.amount}",
        )
    if scope.cumulative_cap > CAPS.session_cumulative.amount:
        return _reject(
            trace, "CAPS", ReasonCode.CAP_CUMULATIVE_EXCEEDED,
            f"cumulative cap {scope.cumulative_cap} > ceiling {CAPS.session_cumulative.amount}",
        )
    _passed(trace, "CAPS")

    # ── RULE 5 — recipient pin is non-negotiable ─────────────────────────────
    if scope.recipient_pin != "user_account":
        return _reject(
            trace, "RECIPIENT", ReasonCode.RECIPIENT_NOT_USER,
            f"recipientPin must be 'user_account', got '{scope.recipient_pin}'",
        )
    _passed(trace, "RECIPIENT")

    return SessionGrantVerdict(
        verdict=PolicyVerdict(
            status="approved",
            reasons=(ReasonCode.OK,),
            policy_version=POLICY_VERSION,
            trace=tuple(trace),
            normalized_action=None,
        ),
        scope=scope,
    )


__all__: Sequence[str] = (
    "SessionScope",
    "SessionScopePair",
    "SessionGrantVerdict",
    "evaluate_session_grant",
)
