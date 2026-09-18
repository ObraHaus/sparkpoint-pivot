# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""US4 (feature 007) — the agent proposes a custom-token swap PAIR for the web's inline swap card.

The swap stays a user-signed, non-custodial action OUTSIDE the fail-closed policy (no ``Asset``
enum or allowlist widening): the planner extracts an optional pasted receive-token address, and
``_swap_proposed_action`` emits a ``tokenIn``/``tokenOut``/``chainId`` wire the web resolves
on-chain (decimals authoritative; a non-recommended token is unverified).
"""

from __future__ import annotations

from sparkpoint_agent.agents.planner import Intent, IntentKind, _parse_intent
from sparkpoint_agent.coordinator.dag import _swap_proposed_action
from sparkpoint_agent.policy import SLIPPAGE, ActionType, Asset

_CUSTOM = "0x" + "ab" * 20  # a syntactically valid 20-byte address


def test_parse_intent_extracts_and_lowercases_a_custom_token_address() -> None:
    intent = _parse_intent(
        {
            "kind": "build_action",
            "actionType": "aerodrome_swap",
            "asset": "USDC",
            "amount": "100000000",
            "tokenOutAddress": "0x" + "Ab" * 20,
        }
    )
    assert intent.token_out_addr == _CUSTOM  # validated + lowercased for a stable wire value


def test_parse_intent_drops_a_malformed_or_missing_token_address() -> None:
    # A hallucinated / truncated / non-hex / non-string value must fail closed to None (the DAG
    # then falls back to the recommended pair rather than proposing a bogus token).
    for bad in ["0x123", "not-an-address", "0x" + "zz" * 20, None, 123, ""]:
        intent = _parse_intent({"kind": "build_action", "tokenOutAddress": bad})
        assert intent.token_out_addr is None


def test_swap_proposed_action_carries_a_custom_token_pair_and_chain() -> None:
    intent = Intent(
        kind=IntentKind.BUILD_ACTION,
        action_type=ActionType.AERODROME_SWAP,
        asset=Asset.USDC,
        amount=100_000_000,
        token_out_addr=_CUSTOM,
    )
    wire = _swap_proposed_action(intent, 84532)
    assert wire["type"] == "aerodrome_swap"
    assert wire["chainId"] == 84532
    assert wire["tokenIn"]["symbol"] == "USDC"  # swap FROM the named asset
    assert wire["tokenOut"]["address"] == _CUSTOM  # the pasted custom receive token
    assert "asset" in wire  # legacy single-asset field retained for schema compatibility


def test_swap_proposed_action_defaults_to_the_opposite_recommended_token() -> None:
    intent = Intent(
        kind=IntentKind.BUILD_ACTION,
        action_type=ActionType.AERODROME_SWAP,
        asset=Asset.ETH,
    )
    wire = _swap_proposed_action(intent, 84532)
    assert wire["tokenIn"]["symbol"] == "ETH"
    assert wire["tokenOut"]["symbol"] == "USDC"  # opposite recommended token
    assert wire["tokenOut"]["address"]  # a concrete address, not empty


# ─────────────────────────────────────────────────────────────────────────────
# R1 medium #1 — the assistant-proposed slippage must be clamped at SOURCE to the
# policy ceiling. The planner's _coerce_bps accepts any non-negative integer, and
# the chat-inline swap card feeds this value to amountOutMinimum, so an unclamped
# 9900bps would mean minOut ~= 0 (sandwichable) with the bound chosen by the MODEL.
# The wire schema also rejects out-of-range values now, which is why the agent must
# never emit one — otherwise a legitimate block fails validation.
# ─────────────────────────────────────────────────────────────────────────────


def test_swap_proposed_action_clamps_an_over_ceiling_slippage() -> None:
    intent = Intent(
        kind=IntentKind.BUILD_ACTION,
        action_type=ActionType.AERODROME_SWAP,
        asset=Asset.ETH,
        amount=10**18,
        max_slippage_bps=9900,  # a prompt-injected / hostile proposal
    )
    wire = _swap_proposed_action(intent, 84532)
    assert wire["params"]["maxSlippageBps"] == SLIPPAGE.absolute_ceiling_bps == 300


def test_swap_proposed_action_leaves_an_in_range_slippage_alone() -> None:
    for proposed in (0, 50, 300):
        intent = Intent(
            kind=IntentKind.BUILD_ACTION,
            action_type=ActionType.AERODROME_SWAP,
            asset=Asset.ETH,
            amount=10**18,
            max_slippage_bps=proposed,
        )
        assert _swap_proposed_action(intent, 84532)["params"]["maxSlippageBps"] == proposed


def test_swap_proposed_action_default_is_within_the_ceiling() -> None:
    """No stated slippage → the 50bps default, which must itself be in range."""
    intent = Intent(
        kind=IntentKind.BUILD_ACTION,
        action_type=ActionType.AERODROME_SWAP,
        asset=Asset.ETH,
        amount=10**18,
    )
    emitted = _swap_proposed_action(intent, 84532)["params"]["maxSlippageBps"]
    assert emitted == 50 <= SLIPPAGE.absolute_ceiling_bps


# ─────────────────────────────────────────────────────────────────────────────
# Pre-fill support (2026-09-18): the inline card seeds the amount for ANY input token, so the wire
# must carry real decimals + the chain-local stable symbol. A 6-dp USDG input mislabeled 18 (or
# named "USDC") would either mis-scale the pre-filled amount by 1e12 or label the token wrong.
# ─────────────────────────────────────────────────────────────────────────────


def test_swap_proposed_action_4663_carries_usdg_decimals_on_the_eth_to_stable_pair() -> None:
    intent = Intent(
        kind=IntentKind.BUILD_ACTION,
        action_type=ActionType.AERODROME_SWAP,
        asset=Asset.ETH,
        amount=10**15,  # 0.001 ETH in base units
    )
    wire = _swap_proposed_action(intent, 4663)
    assert wire["tokenIn"]["symbol"] == "ETH"
    assert wire["tokenIn"]["decimals"] == 18
    assert wire["decimals"] == 18  # legacy field now matches the FROM token, not a filler
    assert wire["tokenOut"]["symbol"] == "USDG"  # never "USDC" on 4663
    assert wire["tokenOut"]["decimals"] == 6
    assert wire["amount"] == str(10**15)  # base units of the FROM token


def test_swap_proposed_action_4663_stable_in_carries_6_decimals() -> None:
    intent = Intent(
        kind=IntentKind.BUILD_ACTION,
        action_type=ActionType.AERODROME_SWAP,
        asset=Asset.USDC,  # the generic stable slot = USDG on 4663
        amount=100_000_000,  # 100 USDG in base units
    )
    wire = _swap_proposed_action(intent, 4663)
    assert wire["tokenIn"]["symbol"] == "USDG"
    assert wire["tokenIn"]["decimals"] == 6
    assert wire["decimals"] == 6
    assert wire["tokenOut"]["symbol"] == "ETH"
    assert wire["tokenOut"]["decimals"] == 18


def test_swap_proposed_action_does_not_guess_decimals_for_a_pasted_token() -> None:
    intent = Intent(
        kind=IntentKind.BUILD_ACTION,
        action_type=ActionType.AERODROME_SWAP,
        asset=Asset.ETH,
        amount=10**18,
        token_out_addr=_CUSTOM,
    )
    wire = _swap_proposed_action(intent, 4663)
    assert wire["tokenOut"] == {"address": _CUSTOM}  # the web resolves it on-chain
