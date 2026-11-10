# ruff: noqa: S101
"""069 — the deterministic earn parser: positives, negatives, and no stolen flows."""

from __future__ import annotations

from decimal import Decimal

import pytest

from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.parse import parse_earn_request


@pytest.mark.parametrize(
    ("prompt", "kind", "chain", "asset"),
    [
        ("Show Morpho vaults on Base", "list", "base", None),
        ("List Morpho vaults on Ethereum for USDC", "list", "eth", "USDC"),
        ("What's the best Morpho vault on Base?", "list", "base", None),
        ("show me morpho vaults", "list", None, None),
    ],
)
def test_list_positives(prompt: str, kind: str, chain: str | None, asset: str | None) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == kind
    assert request.chain == chain
    assert request.asset == asset
    if "best" in prompt.lower():
        assert request.sort == "apy"


@pytest.mark.parametrize(
    ("prompt", "chain", "asset"),
    [
        ("earn on USDC with Morpho", None, "USDC"),
        ("earn yield on SOL with Kamino", "sol", "SOL"),
    ],
)
def test_amount_less_protocol_earn_is_a_list(
    prompt: str, chain: str | None, asset: str | None
) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == "list"
    assert request.amount is None
    assert request.chain == chain
    assert request.asset == asset
    assert request.protocol == ("kamino" if "Kamino" in prompt else "morpho")


def test_generic_earn_options_lists_every_protocol() -> None:
    request = parse_earn_request("What earn options do I have?", default_config())
    assert request is not None
    assert request.kind == "list"
    assert request.protocol is None
    assert request.chain is None
    assert request.asset is None


@pytest.mark.parametrize(
    ("prompt", "protocol"),
    [
        ("Show Rhea options", "rhea"),
        ("Show Morpho options", "morpho"),
        ("Show Kamino options", "kamino"),
    ],
)
def test_protocol_options_lists_that_protocol(prompt: str, protocol: str) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == "list"
    assert request.protocol == protocol


@pytest.mark.parametrize(
    "prompt",
    [
        "should I put my USDC in Morpho or Aave?",
        "where should I lend USDC — Morpho or Aave?",
        "Kamino vs Rhea for SOL yield?",
        "compare Morpho and Kamino to earn on USDC",
        "Should I deposit USDC with Morpho vs Aave?",
        "earn on USDC with Morpho or Aave",
    ],
)
def test_comparative_earn_turns_stay_out_of_the_amount_less_list(prompt: str) -> None:
    # Pre-#342 every amount-less Morpho/Kamino turn returned None, so comparative turns reached
    # the planner's comparison flow instead of being hijacked into a vault list.
    assert parse_earn_request(prompt, default_config()) is None


@pytest.mark.parametrize(
    "prompt",
    [
        "should I put my USDC in Rhea or Aave?",
        "lend USDC on Rhea or Burrow?",
        "should I use SparkPoint or Aave for yield on NEAR?",
    ],
)
def test_comparative_rhea_turns_stay_out_of_the_rhea_list(prompt: str) -> None:
    # Both Rhea paths (_parse_rhea and _parse_near_yield) apply the bare-"or" guard too, so an
    # "A or B" question reaches the planner's comparison flow instead of a Rhea vault list.
    assert parse_earn_request(prompt, default_config()) is None


@pytest.mark.parametrize("prompt", ["lend USDC on Rhea", "earn on Rhea"])
def test_non_comparative_rhea_turns_still_list(prompt: str) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.protocol == "rhea"
    assert request.kind == "list"


def test_amount_bearing_earn_stays_a_deposit_preview() -> None:
    request = parse_earn_request("Earn 1,000 USDC with Morpho on Base", default_config())
    assert request is not None
    assert request.kind == "deposit"
    assert request.amount == Decimal("1000")
    assert parse_earn_request("Deposit 1.1234567 USDC into Morpho", default_config()) is None


def test_amount_bearing_vault_phrase_is_unchanged_by_the_comparative_guard() -> None:
    request = parse_earn_request("deposit 20 USDC into a Morpho vault on Base", default_config())
    assert request is not None
    assert request.kind == "deposit"
    assert request.amount == Decimal("20")
    assert request.chain == "base"


@pytest.mark.parametrize(
    ("prompt", "amount", "chain", "query"),
    [
        (
            "Deposit 100 USDC into Morpho Gauntlet USDC Prime",
            Decimal("100"),
            None,
            "Gauntlet USDC Prime",
        ),
        ("Put 500 USDC in Morpho on Base", Decimal("500"), "base", None),
        (
            "Stake 50 USDC into the Moonwell Flagship USDC vault",
            Decimal("50"),
            None,
            "Moonwell Flagship USDC",
        ),
        ("Earn 1,000 USDC with Morpho on Base", Decimal("1000"), "base", None),
        ("Deposit 100 USDC into Morpho", Decimal("100"), None, None),
        (
            "Deposit 100 USDC from Ethereum into Morpho Gauntlet USDC Prime",
            Decimal("100"),
            None,
            "Gauntlet USDC Prime",
        ),
    ],
)
def test_deposit_positives(
    prompt: str, amount: Decimal, chain: str | None, query: str | None
) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == "deposit"
    assert request.amount == amount
    assert request.chain == chain
    assert request.vault_query == query


@pytest.mark.parametrize(
    "prompt",
    [
        "deposit 100 USDC into the vault",
        "Deposit 500 USDC into the safest vault",
        "Compare Aave and Morpho, then deposit 500 USDC into the safer one.",
        "Is Morpho safer than Aave?",
        "What vaults are available right now?",
        "Where can I deposit my USDC?",
    ],
)
def test_negatives_keep_existing_flows(prompt: str) -> None:
    assert parse_earn_request(prompt, default_config()) is None


def test_over_precise_and_non_positive_amounts_are_rejected() -> None:
    assert parse_earn_request("Deposit 1.1234567 USDC into Morpho", default_config()) is None
    assert parse_earn_request("Deposit 0 USDC into Morpho", default_config()) is None


@pytest.mark.parametrize(
    "prompt",
    [
        f"Deposit {'9' * 70} USDC into Morpho",
        f"Deposit {'9' * 30}k USDC into Morpho",
    ],
)
def test_huge_or_over_long_amounts_are_rejected(prompt: str) -> None:
    assert parse_earn_request(prompt, default_config()) is None


@pytest.mark.parametrize(
    ("prompt", "chain", "sort"),
    [
        ("Show Kamino vaults", "sol", "tvl"),
        ("Show Kamino vaults on Solana", "sol", "tvl"),
        ("What's the best Kamino vault?", "sol", "apy"),
        ("Best Kamino SOL vault", "sol", "apy"),
        ("List Kamino vaults for USDC", "sol", "tvl"),
    ],
)
def test_kamino_list_positives(prompt: str, chain: str, sort: str) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == "list"
    assert request.protocol == "kamino"
    assert request.chain == chain
    assert request.sort == sort


@pytest.mark.parametrize(
    ("prompt", "amount", "chain", "query"),
    [
        ("Deposit 100 USDC into Kamino SOL vault", Decimal("100"), "sol", "SOL"),
        ("Put 1 SOL into Kamino on Solana", Decimal("1"), "sol", None),
        ("Deposit 1 SOL into Kamino vault", Decimal("1"), "sol", None),
        ("Stake 5 USDC into SOL Balanced", Decimal("5"), "sol", "SOL Balanced"),
        ("Deposit 2 SOL into Kamino kV-gtSOLb", Decimal("2"), "sol", "kV-gtSOLb"),
    ],
)
def test_kamino_deposit_positives(
    prompt: str, amount: Decimal, chain: str, query: str | None
) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == "deposit"
    assert request.protocol == "kamino"
    assert request.amount == amount
    assert request.chain == chain
    assert request.vault_query == query


@pytest.mark.parametrize(
    "prompt",
    [
        "Compare Aave and Kamino, then deposit 500 USDC into the safer one.",
        "Is Kamino safer than Aave?",
        "Deposit 100 USDC into Kamino the safer one",
        "Swap 100 USDC to SOL on Solana",
        "Bridge 100 USDC to Solana then deposit into Kamino",
    ],
)
def test_kamino_negatives_keep_existing_flows(prompt: str) -> None:
    assert parse_earn_request(prompt, default_config()) is None


@pytest.mark.parametrize(
    ("prompt", "protocol", "chain", "asset", "amount"),
    [
        ("withdraw 0.5 USDC from Morpho on Base", "morpho", "base", "USDC", "0.5"),
        ("withdraw 0.5 USDC from Morpho", "morpho", "base", "USDC", "0.5"),
        ("withdraw 0.01 SOL from Kamino on Solana", "kamino", "sol", "SOL", "0.01"),
        ("withdraw 0.01 SOL from Kamino", "kamino", "sol", "SOL", "0.01"),
        ("withdraw everything from Kamino", "kamino", "sol", None, None),
    ],
)
def test_explicit_withdraw_honours_protocol_and_chain(
    prompt: str, protocol: str, chain: str, asset: str | None, amount: str | None
) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == "withdraw"
    assert request.protocol == protocol
    assert request.chain == chain
    assert request.asset == asset
    assert request.amount == (Decimal(amount) if amount is not None else None)


@pytest.mark.parametrize(
    "prompt",
    [
        "How do withdrawals work on Morpho?",
        "Are withdrawals instant on Morpho?",
        "How do withdrawals work on Kamino?",
        "Are withdrawals instant on Kamino?",
    ],
)
def test_withdrawal_nouns_do_not_hijack_informational_asks(prompt: str) -> None:
    # "withdrawal"/"withdrawals" is a NOUN, not an exit command: these must fall through to the
    # existing informational path instead of opening the withdraw card.
    assert parse_earn_request(prompt, default_config()) is None


@pytest.mark.parametrize(
    "prompt",
    [
        "withdraw 0.5 USDC from Morpho",
        "withdrawing 0.5 USDC from Morpho",
        "take out 0.5 USDC from Morpho",
        "pull out 0.5 USDC from Morpho",
    ],
)
def test_withdraw_verb_forms_still_parse(prompt: str) -> None:
    request = parse_earn_request(prompt, default_config())
    assert request is not None
    assert request.kind == "withdraw"


def test_kamino_deposit_in_sol_keeps_the_sol_asset_and_chain() -> None:
    request = parse_earn_request("deposit 0.015 SOL into Kamino", default_config())
    assert request is not None
    assert request.kind == "deposit"
    assert request.protocol == "kamino"
    assert request.chain == "sol"
    assert request.asset == "SOL"
    assert request.amount == Decimal("0.015")
