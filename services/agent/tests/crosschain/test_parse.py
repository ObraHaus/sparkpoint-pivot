# ruff: noqa: S101
"""068 — deterministic parser table tests (the four demo prompts + the negatives that matter)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from sparkpoint_agent.crosschain.config import config_from_dict, default_config
from sparkpoint_agent.crosschain.parse import (
    parse_cross_chain_clarification,
    parse_cross_chain_request,
    parse_named_recipient,
)


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


@pytest.mark.parametrize(
    "prompt",
    [
        f"Swap {'9' * 70} USDC into BTC",
        f"Swap {'9' * 30}k USDC into BTC",
    ],
)
def test_huge_or_over_long_amounts_are_rejected(prompt: str) -> None:
    assert parse_cross_chain_request(prompt, default_config()) is None


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


@pytest.mark.parametrize(
    ("prompt", "amount", "raw"),
    [
        ("Swap 1,000.50 USDC into BTC", "1000.5", 1_000_500_000),
        ("Swap 1k USDC into BTC", "1000", 1_000_000_000),
        ("Swap 2m USDC into BTC", "2000000", 2_000_000_000_000),
    ],
)
def test_comma_decimal_and_scale_amounts_are_exact(prompt: str, amount: str, raw: int) -> None:
    request = parse_cross_chain_request(prompt, default_config())
    assert request is not None
    assert request.amount_human == amount
    assert request.amount_raw == raw


@pytest.mark.parametrize(
    "prompt",
    [
        "swap 100 usdc to btc",
        "SWAP 100 USDC TO BTC",
        "SwAp 100 UsDc To BtC",
    ],
)
def test_verbs_symbols_and_chains_are_case_insensitive(prompt: str) -> None:
    request = parse_cross_chain_request(prompt, default_config())
    assert request is not None
    assert request.origin_key == "base:USDC"
    assert request.destination_key == "btc:BTC"
    assert request.amount_human == "100"


@pytest.mark.parametrize(
    "prompt",
    [
        "swap 100 DOGE to BTC",
        "swap 100 USDC to DOGE",
        "swap 100 USDC to XYZ chain",
    ],
)
def test_unknown_assets_or_chains_do_not_match(prompt: str) -> None:
    assert parse_cross_chain_request(prompt, default_config()) is None


@pytest.mark.parametrize(
    "prompt",
    [
        "swap 100 USDC to USDC on Base",
        "move 100 USDC from Base to Base",
        "swap 100 USDC into USDC",
    ],
)
def test_same_chain_same_asset_does_not_match(prompt: str) -> None:
    assert parse_cross_chain_request(prompt, default_config()) is None


def test_a_zero_amount_does_not_match() -> None:
    assert parse_cross_chain_request("swap 0 USDC to BTC", default_config()) is None


def test_a_very_large_amount_stays_exact() -> None:
    request = parse_cross_chain_request(
        "Swap 999999999999999999999 USDC into BTC", default_config()
    )
    assert request is not None
    assert request.amount == Decimal("999999999999999999999")
    assert request.amount_raw == int(Decimal("999999999999999999999").scaleb(6))


@pytest.mark.parametrize(
    "prompt",
    [
        "what is NEAR?",
        "earn yield on NEAR",
        "bridge to NEAR",
        "Is Base cheaper than Ethereum?",
        "tell me about Solana",
        "what is the price of BTC?",
    ],
)
def test_chain_mentions_without_a_swap_request_do_not_match(prompt: str) -> None:
    assert parse_cross_chain_request(prompt, default_config()) is None


@pytest.mark.parametrize(
    ("prompt", "origin", "destination", "amount"),
    [
        ("swap 50 USDC for SOL", "base:USDC", "sol:SOL", "50"),
        ("convert 50 USDC for SOL", "base:USDC", "sol:SOL", "50"),
        ("swap 50 USDC to SOL", "base:USDC", "sol:SOL", "50"),
        ("turn 50 USDC into SOL", "base:USDC", "sol:SOL", "50"),
    ],
)
def test_for_is_a_destination_preposition(
    prompt: str, origin: str, destination: str, amount: str
) -> None:
    request = parse_cross_chain_request(prompt, default_config())
    assert request is not None
    assert request.origin_key == origin
    assert request.destination_key == destination
    assert request.amount_human == amount


@pytest.mark.parametrize(
    ("prompt", "destination"),
    [
        ("swap USDC to SOL", "sol:SOL"),
        ("swap USDC for SOL", "sol:SOL"),
        ("convert USDC into SOL", "sol:SOL"),
        ("swap 50 USDC to BTC", "btc:BTC"),
    ],
)
def test_missing_amount_is_a_clarification_not_a_dead_end(prompt: str, destination: str) -> None:
    # The amount-bearing prompt above parses; the amount-less form must ask, not say "unavailable".
    if "50" in prompt:
        assert parse_cross_chain_request(prompt, default_config()) is not None
        return
    assert parse_cross_chain_request(prompt, default_config()) is None
    clarification = parse_cross_chain_clarification(prompt, default_config())
    assert clarification is not None
    assert clarification.destination_key == destination
    assert "How much" in clarification.message
    assert "signed or sent" in clarification.message


@pytest.mark.parametrize(
    "prompt",
    [
        "swap USDC",
        "bridge to NEAR",
        "swap for SOL",
        "what is the price of BTC?",
        "swap USDC to ETH",
        "swap USDC to USDC on Base",
    ],
)
def test_clarification_does_not_fire_without_a_real_route(prompt: str) -> None:
    assert parse_cross_chain_clarification(prompt, default_config()) is None


def test_named_near_recipient_is_parsed_from_the_prompt() -> None:
    request = parse_cross_chain_request(
        "swap 0.15 USDC from Base to NEAR, recipient sparkpoint2026.near",
        default_config(),
    )
    assert request is not None
    assert request.recipient == "sparkpoint2026.near"


def test_named_near_recipient_after_to() -> None:
    message = "swap 0.15 USDC to sparkpoint2026.near"
    assert parse_named_recipient(message, "near") == "sparkpoint2026.near"
    request = parse_cross_chain_request(message, default_config())
    if request is not None:
        assert request.recipient == "sparkpoint2026.near"


def test_chain_name_near_is_not_treated_as_an_account() -> None:
    assert parse_named_recipient("swap 0.15 USDC from Base to NEAR", "near") is None
    request = parse_cross_chain_request("swap 0.15 USDC from Base to NEAR", default_config())
    if request is not None:
        assert request.recipient is None


def test_named_evm_recipient_is_extracted_for_an_evm_destination() -> None:
    address = "0xBddA41D11014FdD9a656386e29Af1a1349f94f13"
    assert parse_named_recipient(f"send 0.15 USDC to {address} on Base", "evm") == address
    assert parse_named_recipient(f"send 0.15 USDC to {address} on Base", "near") is None
