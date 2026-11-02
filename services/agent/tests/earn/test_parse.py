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
