# ruff: noqa: S101
"""1111 — a NEAR sign-in must never be handed to an EVM reader.

The 072 service used to pass the session owner verbatim to every source. For a NEAR account id
that meant ``balanceOf(sparkpoint2026.near)`` (RPC error) and a Morpho GraphQL lookup with an
invalid address. These tests pin the truthful NEAR read: EVM-only sections become ``not_linked``
with an explicit reason and are never called, while the existing NEAR/Burrow reader is used with
the NEAR account id.
"""

from __future__ import annotations

from dataclasses import replace
from typing import Any

import pytest

from sparkpoint_agent.coordinator import dag as _dag  # noqa: F401 - breaks the chat import cycle
from sparkpoint_agent.portfolio.chat import build_outcome
from sparkpoint_agent.portfolio.models import PortfolioRow, PortfolioSection
from sparkpoint_agent.portfolio.service import (
    NEAR_BALANCES_NOT_READ,
    NEAR_NO_EVM_WALLET,
    MultichainPortfolioService,
)
from sparkpoint_agent.portfolio.text import render_text

from .helpers import config

NEAR = "sparkpoint2026.near"


class _ExplodingEvmSource:
    """Fails the test if a NEAR owner ever reaches an EVM-only source."""

    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:
        raise AssertionError(f"EVM source must not be read for a NEAR owner: {wallet!r}")


class _Kamino:
    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:
        return PortfolioSection(
            key="kamino",
            label="Kamino",
            status="not_linked",
            reason="No linked Solana address.",
            source="solana_rpc",
        )


class _Swaps:
    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:
        return PortfolioSection(key="swaps", label="Cross-chain swaps", status="ok", source="db")


class _NearRhea:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:
        self.calls.append((wallet, auth_chain))
        return PortfolioSection(
            key="rhea",
            label="Rhea",
            status="ok",
            source="rhea_rpc",
            rows=(
                PortfolioRow(
                    chain="near",
                    chain_label="NEAR",
                    protocol="rhea",
                    kind="lending_position",
                    symbol="USDC",
                    amount="0.000000006442973054",
                    value_usd="0.00",
                    price_source="stablecoin_par",
                    extra={"apy": "10.43", "mca": NEAR},
                ),
            ),
        )


def _service(rhea: _NearRhea) -> MultichainPortfolioService:
    return MultichainPortfolioService(
        replace(config(), cache_ttl_s=0),
        balances=_ExplodingEvmSource(),  # type: ignore[arg-type]
        morpho=_ExplodingEvmSource(),  # type: ignore[arg-type]
        kamino=_Kamino(),  # type: ignore[arg-type]
        rhea=rhea,  # type: ignore[arg-type]
        swaps=_Swaps(),  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_near_read_skips_evm_sources_and_uses_the_near_rhea_reader() -> None:
    rhea = _NearRhea()
    overview = await _service(rhea).read(NEAR, auth_chain="near")

    by_key = {item.key: item for item in overview.sections}
    assert by_key["balances"].status == "not_linked"
    assert by_key["balances"].reason == NEAR_BALANCES_NOT_READ
    assert by_key["balances"].rows == ()
    assert by_key["morpho"].status == "not_linked"
    assert by_key["morpho"].reason == NEAR_NO_EVM_WALLET
    assert by_key["morpho"].rows == ()
    assert by_key["rhea"].status == "ok"
    assert by_key["rhea"].rows[0].chain == "near"
    assert rhea.calls == [(NEAR, "near")]
    assert all(item.as_of for item in overview.sections)


@pytest.mark.asyncio
async def test_near_text_is_truthful_never_an_rpc_or_invalid_address_error() -> None:
    overview = await _service(_NearRhea()).read(NEAR, auth_chain="near")
    text = render_text(overview, "all")

    assert "No EVM wallet is linked to this NEAR sign-in" in text
    assert "NEAR wallet balances are not read yet" in text
    assert "RPC error" not in text
    assert "invalid address" not in text
    assert "sparkpoint2026.near" not in text  # the account id is not handed to an EVM reader
    assert "USDC" in text and "NEAR" in text


@pytest.mark.asyncio
async def test_near_chat_portfolio_overview_reuses_the_truthful_read() -> None:
    overview = await _service(_NearRhea()).read(NEAR, auth_chain="near")
    outcome = build_outcome(overview, "all")
    wire = outcome.block.to_wire()

    sections = {section["key"]: section for section in wire["sections"]}
    assert sections["balances"]["status"] == "not_linked"
    assert sections["morpho"]["status"] == "not_linked"
    assert sections["rhea"]["status"] == "ok"
    assert sections["rhea"]["rows"][0]["chain"] == "near"
    assert "RPC error" not in outcome.text
    assert "invalid address" not in outcome.text


@pytest.mark.asyncio
async def test_evm_read_is_unchanged() -> None:
    class _EvmStub:
        def __init__(self, key: str) -> None:
            self.key = key
            self.calls: list[str] = []

        async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:
            self.calls.append(wallet)
            return PortfolioSection(key=self.key, label=self.key.title(), status="ok")  # type: ignore[arg-type]

    sources: dict[str, Any] = {
        "balances": _EvmStub("balances"),
        "morpho": _EvmStub("morpho"),
        "kamino": _EvmStub("kamino"),
        "rhea": _EvmStub("rhea"),
        "swaps": _EvmStub("swaps"),
    }
    service = MultichainPortfolioService(replace(config(), cache_ttl_s=0), **sources)
    owner = "0x2222222222222222222222222222222222222222"
    overview = await service.read(owner)

    assert {item.status for item in overview.sections} == {"ok"}
    assert all(source.calls == [owner] for source in sources.values())
