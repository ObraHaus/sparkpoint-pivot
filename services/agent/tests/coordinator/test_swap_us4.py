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
from sparkpoint_agent.policy import ActionType, Asset

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
