# ruff: noqa: S101
"""072 — section degradation, per-source timeouts, totals and short caches."""

from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from sparkpoint_agent.portfolio.models import PortfolioOverview, PortfolioRow, PortfolioSection
from sparkpoint_agent.portfolio.service import MultichainPortfolioService
from sparkpoint_agent.portfolio.text import render_text

from .helpers import config, row, section

OWNER = "0x2222222222222222222222222222222222222222"


class _Stub:
    def __init__(
        self,
        result: PortfolioSection | None = None,
        *,
        raises: bool = False,
        delay: float = 0.0,
    ) -> None:
        self.result = result
        self.raises = raises
        self.delay = delay
        self.calls = 0

    async def collect(self, wallet: str) -> PortfolioSection:
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.raises:
            raise RuntimeError("boom")
        assert self.result is not None
        return self.result


def _service(**sources: object) -> MultichainPortfolioService:
    cfg = replace(config(), timeout_s=0.01, cache_ttl_s=0)
    return MultichainPortfolioService(
        cfg,
        balances=sources.get("balances", _Stub(section("balances"))),  # type: ignore[arg-type]
        morpho=sources.get("morpho", _Stub(section("morpho"))),  # type: ignore[arg-type]
        kamino=sources.get("kamino", _Stub(section("kamino", status="not_linked"))),  # type: ignore[arg-type]
        rhea=sources.get("rhea", _Stub(section("rhea"))),  # type: ignore[arg-type]
        swaps=sources.get("swaps", _Stub(section("swaps"))),  # type: ignore[arg-type]
    )


@pytest.mark.asyncio
async def test_one_bad_source_never_fails_the_read_and_totals_only_ok_sections() -> None:
    service = _service(
        balances=_Stub(section("balances", rows=(row(value="100.50"),))),
        morpho=_Stub(raises=True),
        kamino=_Stub(delay=0.5),  # exceeds the 0.01s section timeout
    )
    overview = await service.read(OWNER)
    by_key = {item.key: item for item in overview.sections}
    assert by_key["balances"].status == "ok"
    assert by_key["morpho"].status == "unavailable"
    assert by_key["kamino"].status == "unavailable"
    assert by_key["kamino"].reason == "The read timed out."
    assert by_key["rhea"].status == "ok"
    assert by_key["swaps"].status == "ok"
    totals = overview.totals()
    assert totals["totalUsd"] == "100.50"
    assert totals["byProtocol"] == [{"protocol": "wallet", "valueUsd": "100.50"}]
    assert overview.state() == "ready"
    assert overview.as_of
    assert all(item.as_of for item in overview.sections)


@pytest.mark.asyncio
async def test_all_unreadable_sections_are_unavailable() -> None:
    service = _service(
        balances=_Stub(raises=True),
        morpho=_Stub(raises=True),
        kamino=_Stub(raises=True),
        rhea=_Stub(raises=True),
        swaps=_Stub(raises=True),
    )
    overview = await service.read(OWNER)
    assert overview.state() == "unavailable"
    assert overview.totals()["totalUsd"] is None


@pytest.mark.asyncio
async def test_ok_sections_are_cached_but_unavailable_sections_are_retried() -> None:
    cfg = replace(config(), timeout_s=0.5, cache_ttl_s=60)
    balances = _Stub(section("balances", rows=(row(),)))
    morpho = _Stub(raises=True)
    service = MultichainPortfolioService(
        cfg,
        balances=balances,
        morpho=morpho,
        kamino=_Stub(section("kamino", status="not_linked")),
        rhea=_Stub(section("rhea")),
        swaps=_Stub(section("swaps")),
    )
    await service.read(OWNER)
    await service.read(OWNER)
    assert balances.calls == 1
    assert morpho.calls == 2


@pytest.mark.asyncio
async def test_negative_swap_value_is_never_added_to_totals() -> None:
    swaps = _Stub(section("swaps", rows=(row(protocol="swap", value=None),)))
    service = _service(swaps=swaps)
    overview = await service.read(OWNER)
    assert overview.totals()["totalUsd"] is None


# ── 1112 — totals count each priced dollar once; optional wire fields never become null ──


@pytest.mark.asyncio
async def test_priced_eth_and_rhea_are_each_counted_once() -> None:
    """The live beta numbers: 0.61 USDC + 0.44 ETH on Base + 0.40 Rhea on NEAR = 1.45.

    ETH is part of the 072 priced sum (the Portfolio Net worth card excludes it by design), and
    the same Rhea row is never also rolled into the Base bucket.
    """
    native_eth = PortfolioRow(
        chain="base",
        chain_label="Base",
        protocol="wallet",
        kind="native",
        symbol="ETH",
        amount="0.000213927837960603",
        value_usd="0.44",
        price_source="CoinGecko",
    )
    base_usdc = row(symbol="USDC", amount="0.614711", value="0.61")
    rhea = row(
        chain="near",
        label="NEAR",
        protocol="rhea",
        symbol="USDC",
        amount="0.399983623927626587",
        value="0.40",
    )
    service = _service(
        balances=_Stub(section("balances", rows=(native_eth, base_usdc))),
        rhea=_Stub(section("rhea", rows=(rhea,))),
    )
    totals = (await service.read(OWNER)).totals()

    assert totals["totalUsd"] == "1.45"
    assert totals["byChain"] == [
        {"chain": "base", "label": "Base", "valueUsd": "1.05"},
        {"chain": "near", "label": "NEAR", "valueUsd": "0.40"},
    ]
    assert totals["byProtocol"] == [
        {"protocol": "wallet", "valueUsd": "1.05"},
        {"protocol": "rhea", "valueUsd": "0.40"},
    ]


def test_row_and_section_wire_omit_absent_optionals_instead_of_null() -> None:
    """A missing APY/status must be ABSENT, because the strict TS schema rejects null."""
    wire = PortfolioRow(
        chain="near",
        chain_label="NEAR",
        protocol="rhea",
        kind="lending_position",
        symbol="USDC",
        amount="0.4",
        value_usd="0.40",
        extra={"apy": None, "mca": "rhea001598.multica.near"},
    ).to_wire()
    assert "apy" not in wire
    assert wire["mca"] == "rhea001598.multica.near"

    section_wire = PortfolioSection(
        key="rhea",
        label="Rhea",
        status="ok",
        rows=(),
        meta={"mca": None, "appUrl": "https://app.rhea.finance/lending"},
    ).to_wire()
    assert "mca" not in section_wire
    assert section_wire["appUrl"] == "https://app.rhea.finance/lending"


def test_text_explains_why_the_priced_total_includes_eth_but_net_worth_does_not() -> None:
    native_eth = PortfolioRow(
        chain="base",
        chain_label="Base",
        protocol="wallet",
        kind="native",
        symbol="ETH",
        amount="0.000213927837960603",
        value_usd="0.44",
        price_source="CoinGecko",
    )
    overview = PortfolioOverview(
        wallet=OWNER,
        focus="all",
        as_of="2026-11-11T00:00:00+00:00",
        sections=(section("balances", rows=(native_eth, row(value="0.61"))),),
    )
    text = render_text(overview, "all")
    assert "That includes 0.000213927837960603 ETH (~$0.44)" in text
    assert "excludes ETH" in text
