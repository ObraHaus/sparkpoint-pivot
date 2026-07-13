"""Canonical policy enums + reason codes — the Python mirror.

MIRRORS packages/shared/src/policy/enums.ts EXACTLY (the single source of truth
for the deterministic guardrail schema). T098 asserts parity between this module
and the shared enums; keep them in lockstep — any drift is a CI failure.

Grounding: specs/001-sparkpoint-pivot-mvp/contracts/policy-schema.md §2
  (§2.1 Protocol, §2.2 Asset, §2.3 ActionType, §2.4 Direction, §2.5 RiskProfile,
   §2.6 Reason codes). Values are the EXACT wire strings so they round-trip
  through the shared zod wire schemas and JSON without transformation.

Style: `StrEnum` (Python 3.11+) so each member IS its wire string — named access,
JSON-serialisable, `Object.values`-equivalent iteration for the drift check.
"""

from __future__ import annotations

from enum import StrEnum


class Protocol(StrEnum):
    """policy-schema.md §2.1 — closed protocol whitelist (G5). Else unreachable."""

    AAVE_V3 = "aave_v3"
    AERODROME = "aerodrome"
    SPARKPOINT_VAULT = "sparkpoint_vault"


class Asset(StrEnum):
    """policy-schema.md §2.2 — launch asset set. Vault deposit asset == USDC only."""

    USDC = "USDC"
    ETH = "ETH"


class ActionType(StrEnum):
    """policy-schema.md §2.3 — action taxonomy (== agent-service-api.md §2.2)."""

    VAULT_DEPOSIT = "vault_deposit"
    VAULT_WITHDRAW = "vault_withdraw"
    VAULT_REDEEM = "vault_redeem"
    AAVE_SUPPLY = "aave_supply"
    AAVE_WITHDRAW = "aave_withdraw"
    AERODROME_SWAP = "aerodrome_swap"
    SESSION_KEY_GRANT = "session_key_grant"
    SESSION_KEY_REVOKE = "session_key_revoke"


class Direction(StrEnum):
    """policy-schema.md §2.4 — the three-value taxonomy that drives cap/pause gating.

    - ``INFLOW``  : deposit / supply / grant  — cap- AND pause-gated.
    - ``OUTFLOW`` : swap-out (aerodrome_swap) — cap- AND pause-gated, slippage-bounded.
    - ``EXIT``    : vault_withdraw / vault_redeem / aave_withdraw / session_key_revoke
                    — NEVER cap- or pause-gated (N2, withdraw-is-sacred).

    The three-value taxonomy is load-bearing: evaluate() (§8) and the caps table
    (§4) branch on ``direction == EXIT``. Collapsing to a binary enter|exit would
    conflate a cap/pause-gated swap (OUTFLOW) with an ungated withdraw (EXIT) and
    break N2.
    """

    INFLOW = "inflow"
    OUTFLOW = "outflow"
    EXIT = "exit"


class RiskProfile(StrEnum):
    """policy-schema.md §2.5 — risk profile. Launch is conservative-only.

    NOTE (mirrored from enums.ts): data-model.md §5 ``mandates.risk_tier`` uses
    ``moderate`` where this policy enum uses ``balanced``; policy-schema.md §2.5 is
    authoritative for the policy foundation, so the middle tier is ``balanced``.
    """

    CONSERVATIVE = "conservative"
    BALANCED = "balanced"
    GROWTH = "growth"


class ReasonCode(StrEnum):
    """policy-schema.md §2.6 — structured reason codes returned in ``reasons[]``.

    ``OK`` is the sole success code; every other value is a fail-closed rejection.
    Mirrors the canonical error codes in agent-service-api.md §1.6.
    """

    OK = "OK"
    SCHEMA_INVALID = "SCHEMA_INVALID"
    PROTOCOL_NOT_ALLOWLISTED = "PROTOCOL_NOT_ALLOWLISTED"
    SELECTOR_NOT_ALLOWLISTED = "SELECTOR_NOT_ALLOWLISTED"
    ASSET_NOT_ALLOWLISTED = "ASSET_NOT_ALLOWLISTED"
    RECIPIENT_NOT_USER = "RECIPIENT_NOT_USER"
    CAP_PER_USER_EXCEEDED = "CAP_PER_USER_EXCEEDED"
    CAP_TOTAL_EXCEEDED = "CAP_TOTAL_EXCEEDED"
    CAP_VAULT_EXCEEDED = "CAP_VAULT_EXCEEDED"
    CAP_PER_TX_EXCEEDED = "CAP_PER_TX_EXCEEDED"
    CAP_CUMULATIVE_EXCEEDED = "CAP_CUMULATIVE_EXCEEDED"
    MANDATE_RISK_EXCEEDED = "MANDATE_RISK_EXCEEDED"
    SLIPPAGE_EXCEEDED = "SLIPPAGE_EXCEEDED"
    MIN_OUT_BELOW_FLOOR = "MIN_OUT_BELOW_FLOOR"
    SIM_REVERT = "SIM_REVERT"
    SIM_UNAVAILABLE = "SIM_UNAVAILABLE"
    DATA_STALE = "DATA_STALE"
    KILL_SWITCH_PAUSED = "KILL_SWITCH_PAUSED"
    SESSION_EXPIRED = "SESSION_EXPIRED"
    SESSION_REVOKED = "SESSION_REVOKED"


# ─────────────────────────────────────────────────────────────────────────────
# Value tuples — kept in the SAME declaration order as enums.ts so a reviewer can
# eyeball parity with policy-schema.md §2, and T098 can assert 1:1 drift-free
# equality against the shared PROTOCOL_VALUES / … / REASON_CODE_VALUES.
# ─────────────────────────────────────────────────────────────────────────────

PROTOCOL_VALUES: tuple[Protocol, ...] = (
    Protocol.AAVE_V3,
    Protocol.AERODROME,
    Protocol.SPARKPOINT_VAULT,
)

ASSET_VALUES: tuple[Asset, ...] = (Asset.USDC, Asset.ETH)

ACTION_TYPE_VALUES: tuple[ActionType, ...] = (
    ActionType.VAULT_DEPOSIT,
    ActionType.VAULT_WITHDRAW,
    ActionType.VAULT_REDEEM,
    ActionType.AAVE_SUPPLY,
    ActionType.AAVE_WITHDRAW,
    ActionType.AERODROME_SWAP,
    ActionType.SESSION_KEY_GRANT,
    ActionType.SESSION_KEY_REVOKE,
)

DIRECTION_VALUES: tuple[Direction, ...] = (
    Direction.INFLOW,
    Direction.OUTFLOW,
    Direction.EXIT,
)

RISK_PROFILE_VALUES: tuple[RiskProfile, ...] = (
    RiskProfile.CONSERVATIVE,
    RiskProfile.BALANCED,
    RiskProfile.GROWTH,
)

REASON_CODE_VALUES: tuple[ReasonCode, ...] = (
    ReasonCode.OK,
    ReasonCode.SCHEMA_INVALID,
    ReasonCode.PROTOCOL_NOT_ALLOWLISTED,
    ReasonCode.SELECTOR_NOT_ALLOWLISTED,
    ReasonCode.ASSET_NOT_ALLOWLISTED,
    ReasonCode.RECIPIENT_NOT_USER,
    ReasonCode.CAP_PER_USER_EXCEEDED,
    ReasonCode.CAP_TOTAL_EXCEEDED,
    ReasonCode.CAP_VAULT_EXCEEDED,
    ReasonCode.CAP_PER_TX_EXCEEDED,
    ReasonCode.CAP_CUMULATIVE_EXCEEDED,
    ReasonCode.MANDATE_RISK_EXCEEDED,
    ReasonCode.SLIPPAGE_EXCEEDED,
    ReasonCode.MIN_OUT_BELOW_FLOOR,
    ReasonCode.SIM_REVERT,
    ReasonCode.SIM_UNAVAILABLE,
    ReasonCode.DATA_STALE,
    ReasonCode.KILL_SWITCH_PAUSED,
    ReasonCode.SESSION_EXPIRED,
    ReasonCode.SESSION_REVOKED,
)

# policy-schema.md §2.5 — total order for the mandate-conformance check (§8 step 5):
# action.riskClass ≤ mandate.maxRiskClass compares by this ascending rank.
RISK_PROFILE_RANK: dict[RiskProfile, int] = {
    RiskProfile.CONSERVATIVE: 0,
    RiskProfile.BALANCED: 1,
    RiskProfile.GROWTH: 2,
}
