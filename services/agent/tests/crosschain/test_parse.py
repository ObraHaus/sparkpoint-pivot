# ruff: noqa: S101
"""068 — deterministic parser table tests (the four demo prompts + the negatives that matter)."""

from __future__ import annotations

import pytest

from sparkpoint_agent.crosschain.config import config_from_dict, default_config
from sparkpoint_agent.crosschain.parse import parse_cross_chain_request


@pytest.mark.parametrize(
    ("prompt", "origin", "destination", "amount", "raw"),
    [
        ("Swap 5,000 USDC into native BTC.", "base:USDC", "btc:BTC", "5000", 5_000_000_000),
        (
            "Move 10,000 USDC from Ethereum to Base.",
            "eth:USDC",
            "base:USDC",
            "10000",
            10_000_000_000,
        ),
        ("Turn 2,000 USDC into SOL on Solana.", "base:USDC", "sol:SOL", "2000", 2_000_000_000),
        ("Swap 500 USDG to USDC on Base", "hood:USDG", "base:USDC", "500", 500_000_000),
        (
            "Pay my supplier 3,000 USDT on Tron.",
            "eth:USDT",
            "tron:USDT",
            "3000",
            3_000_000_000,
        ),
    ],
)
def test_demo_prompts_parse(
    prompt: str, origin: str, destination: str, amount: str, raw: int
) -> None:
    request = parse_cross_chain_request(prompt, default_config())
    assert request is not None
    assert request.origin_key == origin
    assert request.destination_key == destination
    assert request.amount_human == amount
    assert request.amount_raw == raw


def test_compact_and_decimal_amounts_parse() -> None:
    config = default_config()
    five_k = parse_cross_chain_request("Swap 5k USDC into BTC", config)
    assert five_k is not None and five_k.amount_human == "5000"

    decimal = parse_cross_chain_request("Swap 5,000.50 USDC into BTC", config)
    assert decimal is not None
    assert decimal.amount_human == "5000.5"
    assert decimal.amount_raw == 5_000_500_000


@pytest.mark.parametrize(
    "prompt",
    [
        "swap 0.1 ETH to USDC",
        "swap 1 ETH to USDC",
        "what is bridging?",
        "How do I bridge to Sui?",
        "swap 5,000 USDC to USDC on Base",
        "convert 100 USDC to ETH",
        "what is the price of BTC?",
        "move 100 USDC",
        "send my supplier 50 USDT",
    ],
)
def test_negatives_do_not_match(prompt: str) -> None:
    assert parse_cross_chain_request(prompt, default_config()) is None


def test_too_many_decimals_for_origin_is_rejected() -> None:
    # USDC has 6 decimals; a seventh cannot be represented without rounding.
    assert parse_cross_chain_request("Swap 1.1234567 USDC into BTC", default_config()) is None


def test_disabled_route_still_parses_so_chat_can_explain_it() -> None:
    config = default_config()
    request = parse_cross_chain_request("Pay my supplier 3,000 USDT on Tron.", config)
    assert request is not None
    destination = config.asset(request.destination_key)
    assert destination is not None and destination.enabled is False


def test_unknown_asset_in_a_custom_config_is_ignored() -> None:
    config = config_from_dict(
        {
            "feature_enabled": True,
            "chain_aliases": {"base": "base", "bitcoin": "btc", "btc": "btc"},
            "default_origin": {"USDC": "base:USDC"},
            "assets": [
                {
                    "key": "base:USDC",
                    "chain": "base",
                    "chain_label": "Base",
                    "evm_chain_id": 8453,
                    "symbol": "USDC",
                    "asset_id": "nep141:base-usdc",
                    "decimals": 6,
                    "address_kind": "evm",
                },
                {
                    "key": "btc:BTC",
                    "chain": "btc",
                    "chain_label": "Bitcoin",
                    "evm_chain_id": None,
                    "symbol": "BTC",
                    "asset_id": "nep141:btc",
                    "decimals": 8,
                    "address_kind": "btc",
                },
            ],
        }
    )
    assert parse_cross_chain_request("Swap 10 USDC into BTC", config) is not None
