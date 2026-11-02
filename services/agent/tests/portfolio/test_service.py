# ruff: noqa: S101
"""072 — section degradation, per-source timeouts, totals and short caches."""

from __future__ import annotations

import asyncio
from dataclasses import replace

import pytest

from sparkpoint_agent.portfolio.models import PortfolioSection
from sparkpoint_agent.portfolio.service import MultichainPortfolioService

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
