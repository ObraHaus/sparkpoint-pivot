# ruff: noqa: S101
"""060 — the price service: cache, stale-while-revalidate, timeout, fallback, breaker, depeg.

Every request goes through an injected ``httpx.MockTransport``. No test touches the network.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

from sparkpoint_agent.data.prices import (
    ASSETS,
    PriceService,
)

PRIMARY = "https://prices.test/api"
FALLBACK = "https://fallback.test/prices"

_ID_TO_SYMBOL = {
    asset.coingecko_id: symbol for symbol, asset in ASSETS.items() if asset.coingecko_id
}


class _Clock:
    def __init__(self) -> None:
        self.m = 1_000.0
        self.dt = datetime(2026, 10, 27, 12, 0, tzinfo=UTC)

    def monotonic(self) -> float:
        return self.m

    def now(self) -> datetime:
        return self.dt

    def advance(self, seconds: float) -> None:
        self.m += seconds
        self.dt += timedelta(seconds=seconds)


def _primary_handler(
    prices: dict[str, float], calls: list[str] | None = None
) -> Callable[[httpx.Request], httpx.Response]:
    def handler(request: httpx.Request) -> httpx.Response:
        if calls is not None:
            calls.append(str(request.url))
        if not request.url.path.endswith("/simple/price"):
            return httpx.Response(404, json={})
        ids = request.url.params.get("ids", "").split(",")
        body = {
            cid: {"usd": prices[symbol]}
            for cid in ids
            if (symbol := _ID_TO_SYMBOL.get(cid)) in prices
        }
        return httpx.Response(200, json=body)

    return handler


def _service(
    handler: Callable[[httpx.Request], httpx.Response],
    clock: _Clock,
    **kwargs: Any,
) -> PriceService:
    return PriceService(
        base_url=PRIMARY,
        fallback_url=FALLBACK,
        transport=httpx.MockTransport(handler),
        monotonic=clock.monotonic,
        now=clock.now,
        **kwargs,
    )


async def test_a_fresh_quote_is_cached_and_reused() -> None:
    clock = _Clock()
    calls: list[str] = []
    service = _service(_primary_handler({"ETH": 2500.0}, calls), clock)

    first = await service.get(["ETH"])
    second = await service.get(["eth"])

    assert first.quote("ETH") is not None
    assert first.quote("ETH").usd == 2500.0  # type: ignore[union-attr]
    assert second.quote("ETH") is not None
    assert len(calls) == 1, "a second lookup inside the TTL must not hit the feed"


async def test_stale_while_revalidate_returns_immediately_and_refreshes() -> None:
    clock = _Clock()
    calls: list[str] = []
    service = _service(_primary_handler({"ETH": 2500.0}, calls), clock)
    await service.get(["ETH"])

    clock.advance(61)  # past the 60s TTL, inside the 15-minute stale window
    stale = await service.get(["ETH"])
    quote = stale.quote("ETH")
    assert quote is not None and quote.stale, "the cached quote answers while the refresh runs"

    await asyncio.sleep(0.05)
    assert len(calls) == 2, "one background refresh must have run"

    fresh = await service.get(["ETH"])
    assert fresh.quote("ETH") is not None
    assert fresh.quote("ETH").stale is False  # type: ignore[union-attr]


async def test_a_hard_timeout_returns_unavailable_without_raising() -> None:
    clock = _Clock()

    async def slow(_: httpx.Request) -> httpx.Response:
        await asyncio.sleep(0.5)
        return httpx.Response(200, json={})

    service = _service(slow, clock, timeout_s=0.05)  # type: ignore[arg-type]
    snapshot = await service.get(["ETH"])

    assert snapshot.quote("ETH") is None
    assert snapshot.unavailable == frozenset({"ETH"})


async def test_a_second_caller_awaits_the_inflight_fetch_before_reporting_unavailable() -> None:
    clock = _Clock()
    entered = asyncio.Event()
    release = asyncio.Event()

    async def slow(_: httpx.Request) -> httpx.Response:
        entered.set()
        await release.wait()
        return httpx.Response(200, json={"ethereum": {"usd": 2500.0}})

    service = _service(slow, clock)  # type: ignore[arg-type]
    first = asyncio.create_task(service.get(["ETH"]))
    await entered.wait()

    second = asyncio.create_task(service.get(["ETH"]))
    await asyncio.sleep(0.01)  # let the second caller register on the in-flight fetch
    release.set()

    first_snapshot, second_snapshot = await asyncio.gather(first, second)
    assert first_snapshot.quote("ETH") is not None
    assert second_snapshot.quote("ETH") is not None, (
        "the second caller must wait for the shared fetch, not answer from a no-op refresh"
    )
    assert second_snapshot.unavailable == frozenset()


async def test_the_secondary_source_is_used_when_the_primary_fails() -> None:
    clock = _Clock()

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/simple/price"):
            return httpx.Response(503, json={})
        if request.url.path.endswith("/ETH-USD/spot"):
            return httpx.Response(200, json={"data": {"amount": "2512.34"}})
        return httpx.Response(404, json={})

    service = _service(handler, clock)
    snapshot = await service.get(["ETH"])
    quote = snapshot.quote("ETH")

    assert quote is not None
    assert quote.usd == 2512.34
    assert quote.source == "Coinbase"


async def test_the_breaker_opens_then_recovers_after_the_cooldown() -> None:
    clock = _Clock()
    calls: list[str] = []

    def down(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        return httpx.Response(503, json={})

    service = _service(down, clock, breaker_threshold=2, breaker_cooldown_s=100)

    assert (await service.get(["ETH"])).quote("ETH") is None
    assert (await service.get(["ETH"])).quote("ETH") is None
    attempts = len(calls)
    assert attempts >= 2

    assert (await service.get(["ETH"])).quote("ETH") is None
    assert len(calls) == attempts, "an open breaker must fail fast without another request"

    clock.advance(101)
    assert (await service.get(["ETH"])).quote("ETH") is None
    assert len(calls) > attempts, "after cooldown the breaker allows a retry"


async def test_a_usdg_peg_is_derived_only_while_the_stable_sanity_check_holds() -> None:
    clock = _Clock()
    service = _service(_primary_handler({"USDC": 1.0, "USDT": 0.999}), clock)
    snapshot = await service.get(["USDG"])
    quote = snapshot.quote("USDG")

    assert quote is not None
    assert quote.usd == 1.0
    assert quote.approximate is True
    assert "peg check" in quote.source

    depegged = _service(_primary_handler({"USDC": 0.90, "USDT": 1.0}), _Clock())
    down = await depegged.get(["USDG"])
    assert down.quote("USDG") is None, "do not invent a $1 peg while a stable is off-peg"


async def test_a_stable_outside_its_band_is_reported_with_a_depeg_note() -> None:
    clock = _Clock()
    service = _service(_primary_handler({"USDC": 0.90}), clock)
    quote = (await service.get(["USDC"])).quote("USDC")

    assert quote is not None
    assert quote.usd == 0.90
    assert quote.note is not None and "Depeg check" in quote.note


async def test_unsupported_symbols_are_empty_not_an_error() -> None:
    clock = _Clock()
    service = _service(_primary_handler({"ETH": 2500.0}), clock)
    snapshot = await service.get(["SRK", "DOGE"])

    assert snapshot.quotes == {}
    assert snapshot.unavailable == frozenset()
