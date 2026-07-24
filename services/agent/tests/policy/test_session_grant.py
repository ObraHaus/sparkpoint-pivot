# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""Contract tests for the SessionScope grant validator (policy-schema.md §6, feature 022 US6, N4).

Assert the §6 grammar (rules 1–6): a valid scoped grant is APPROVED, and every out-of-grammar grant is
REJECTED with the right ReasonCode and yields NO signable scope (``scope is None``) — so an
out-of-policy session key can never be authorized. Mirrors the on-chain
``SparkPointAccount.authorizeSessionKey`` guards; these MUST pass.
"""

from __future__ import annotations

from sparkpoint_agent.policy import (
    PolicyContext,
    ReasonCode,
    SessionScope,
    SessionScopePair,
    evaluate_session_grant,
)

# Base Sepolia (84532): vault resolved via a deploy-time override; Aave pool pinned in the book.
CHAIN = 84532
VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"
AAVE_POOL = "0x8bAB6d1b75f19e9eD9fCe8b9BD338844fF79aE27"
USER = "0x2222222222222222222222222222222222222222"
SESSION_KEY = "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
ROGUE = "0x000000000000000000000000000000000000bEEF"

DEP_SEL = "0x6e553f65"  # vault deposit(uint256,address)
WITHDRAW_SEL = "0xb460af94"  # vault withdraw(uint256,address,address)
APPROVE_SEL = "0x095ea7b3"  # forbidden
SWAP_SEL = "0xcac88ea9"  # aerodrome swap (only resolvable on Base mainnet)

NOW = 1_800_000_000
DAY = 86_400
PER_TX = 500_000_000  # 500 USDC (the ceiling)
CUMULATIVE = 5_000_000_000  # 5,000 USDC (the ceiling)


def _ctx(chain: int = CHAIN, targets: dict[str, str] | None = None) -> PolicyContext:
    return PolicyContext(
        chain_id=chain,
        user_account=USER,
        resolved_targets=targets if targets is not None else {"sparkpoint_vault": VAULT},
    )


def _scope(**over: object) -> SessionScope:
    base: dict[str, object] = {
        "session_key": SESSION_KEY,
        "valid_after": 0,
        "valid_until": NOW + 7 * DAY,
        "per_tx_cap": PER_TX,
        "cumulative_cap": CUMULATIVE,
        "max_slippage_bps": 0,
        "allowlist": (
            SessionScopePair(VAULT, DEP_SEL),
            SessionScopePair(VAULT, WITHDRAW_SEL),
        ),
        "recipient_pin": "user_account",
        "spent": 0,
    }
    base.update(over)
    return SessionScope(**base)  # type: ignore[arg-type]


def test_valid_vault_grant_approved() -> None:
    res = evaluate_session_grant(_scope(), _ctx(), now_ts=NOW)
    assert res.verdict.approved
    assert res.scope is not None
    assert res.verdict.reasons == (ReasonCode.OK,)


def test_forbidden_selector_rejected() -> None:
    scope = _scope(allowlist=(SessionScopePair(VAULT, APPROVE_SEL),))
    res = evaluate_session_grant(scope, _ctx(), now_ts=NOW)
    assert not res.verdict.approved
    assert res.scope is None
    assert res.verdict.reasons == (ReasonCode.SELECTOR_NOT_ALLOWLISTED,)


def test_non_subset_target_rejected() -> None:
    scope = _scope(allowlist=(SessionScopePair(ROGUE, DEP_SEL),))
    res = evaluate_session_grant(scope, _ctx(), now_ts=NOW)
    assert not res.verdict.approved
    assert res.verdict.reasons == (ReasonCode.PROTOCOL_NOT_ALLOWLISTED,)


def test_known_target_wrong_selector_rejected() -> None:
    # The vault IS a known target, but the Aave-supply selector on it is not allowlisted there.
    scope = _scope(allowlist=(SessionScopePair(VAULT, "0x617ba037"),))
    res = evaluate_session_grant(scope, _ctx(), now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.SELECTOR_NOT_ALLOWLISTED,)


def test_valid_until_zero_rejected() -> None:
    res = evaluate_session_grant(_scope(valid_until=0), _ctx(), now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.SESSION_EXPIRED,)
    assert res.scope is None


def test_valid_until_in_past_rejected() -> None:
    res = evaluate_session_grant(_scope(valid_until=NOW - 1), _ctx(), now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.SESSION_EXPIRED,)


def test_session_too_long_rejected() -> None:
    res = evaluate_session_grant(_scope(valid_until=NOW + 31 * DAY), _ctx(), now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.SESSION_EXPIRED,)


def test_per_tx_cap_over_ceiling_rejected() -> None:
    res = evaluate_session_grant(_scope(per_tx_cap=PER_TX + 1), _ctx(), now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.CAP_PER_TX_EXCEEDED,)


def test_cumulative_cap_over_ceiling_rejected() -> None:
    res = evaluate_session_grant(
        _scope(cumulative_cap=CUMULATIVE + 1, per_tx_cap=PER_TX), _ctx(), now_ts=NOW
    )
    assert res.verdict.reasons == (ReasonCode.CAP_CUMULATIVE_EXCEEDED,)


def test_recipient_pin_must_be_user_account() -> None:
    res = evaluate_session_grant(_scope(recipient_pin="external"), _ctx(), now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.RECIPIENT_NOT_USER,)


def test_empty_allowlist_rejected() -> None:
    res = evaluate_session_grant(_scope(allowlist=()), _ctx(), now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.SCHEMA_INVALID,)


def test_per_tx_exceeds_cumulative_rejected() -> None:
    res = evaluate_session_grant(
        _scope(per_tx_cap=PER_TX, cumulative_cap=PER_TX - 1), _ctx(), now_ts=NOW
    )
    assert res.verdict.reasons == (ReasonCode.SCHEMA_INVALID,)


def test_swap_slippage_out_of_range_rejected() -> None:
    # Aerodrome resolves only on Base mainnet (8453); a swap pair with slippage above the ceiling
    # (300 bps) is rejected for slippage — proving rule 3 fires when a swap is in scope.
    ctx = _ctx(chain=8453, targets={})  # pinned aero router/factory come from the static book
    scope = _scope(
        allowlist=(SessionScopePair("0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", SWAP_SEL),),
        max_slippage_bps=500,
    )
    res = evaluate_session_grant(scope, ctx, now_ts=NOW)
    assert res.verdict.reasons == (ReasonCode.SLIPPAGE_EXCEEDED,)


def test_swap_slippage_in_range_approved() -> None:
    ctx = _ctx(chain=8453, targets={})
    scope = _scope(
        allowlist=(SessionScopePair("0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43", SWAP_SEL),),
        max_slippage_bps=50,
    )
    res = evaluate_session_grant(scope, ctx, now_ts=NOW)
    assert res.verdict.approved
