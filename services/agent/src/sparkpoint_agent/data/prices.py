"""Keyless, cached USD reference prices for the assets SparkPoint actually shows (feature 060).

WHY THIS EXISTS. A beta user asked "What is the price of ETH today?" and got "I can't pull live
price data". That was true — no price tier existed — and it is the wrong product answer. This module
is the smallest honest tier that fixes it:

* **Free and keyless.** CoinGecko ``simple/price`` is the primary source; Coinbase spot is the
  fallback. Both are public and unauthenticated. There is no API key anywhere in this path, and the
  base URLs are env-configurable for a mirror/proxy.
* **Never on the custody path.** A price is display data. It is never used for valuation, caps,
  policy, or a signable action.
* **Never block chat.** A lookup is hard-bounded (~2s), cached for ~60s, may serve a stale value for
  up to 15 minutes while one background refresh runs, and a circuit breaker fails fast after
  repeated failures. If the deployment has no egress, callers get an honest "unavailable", not an
  exception and not a guessed number.
* **Stables are special.** USDC/USDT are reported at the feed value with a depeg note when they
  deviate beyond ±2% from $1. USDG has no public quote, so it is shown at ~$1 ONLY while that stable
  sanity check holds; otherwise it is unavailable rather than fabricated.
* **SRK is deliberately absent.** The product quotes no dollar price for SRK (no oracle), so this
  module must never be asked for it.

The service is injectable (transport + clock) so tests never touch the network.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from functools import lru_cache

import httpx

logger = logging.getLogger("sparkpoint_agent.data.prices")

PRICE_API_URL_ENV = "SPARKPOINT_PRICE_API_URL"
PRICE_FALLBACK_URL_ENV = "SPARKPOINT_PRICE_FALLBACK_URL"

DEFAULT_PRICE_API_URL = "https://api.coingecko.com/api/v3"
DEFAULT_PRICE_FALLBACK_URL = "https://api.coinbase.com/v2/prices"

#: Cache freshness and the maximum age a value may be served while a refresh runs.
DEFAULT_TTL_S = 60.0
DEFAULT_MAX_STALE_S = 15 * 60.0
#: Hard bound on one lookup. The chat route adds a little headroom on top.
DEFAULT_TIMEOUT_S = 2.0
DEFAULT_BREAKER_THRESHOLD = 3
DEFAULT_BREAKER_COOLDOWN_S = 60.0

#: Stablecoins are shown at their feed value but flagged when the peg drifts beyond this band.
STABLE_PEG_TOLERANCE = 0.02


@dataclass(frozen=True, slots=True)
class AssetSource:
    """One supported symbol and where to ask for it. ``None`` ⇒ that source cannot price it."""

    symbol: str
    coingecko_id: str | None
    coinbase_pair: str | None
    stable: bool = False
    context_only: bool = False


#: The closed asset set Sparky may quote. BTC/SOL/NEAR are context only (not traded here).
ASSETS: dict[str, AssetSource] = {
    "ETH": AssetSource("ETH", "ethereum", "ETH-USD"),
    "BTC": AssetSource("BTC", "bitcoin", "BTC-USD", context_only=True),
    "SOL": AssetSource("SOL", "solana", "SOL-USD", context_only=True),
    "NEAR": AssetSource("NEAR", "near", "NEAR-USD", context_only=True),
    "USDC": AssetSource("USDC", "usd-coin", "USDC-USD", stable=True),
    "USDT": AssetSource("USDT", "tether", "USDT-USD", stable=True),
    # USDG has no public quote: it is derived from the stable sanity check, never fetched.
    "USDG": AssetSource("USDG", None, None, stable=True),
}

SUPPORTED_PRICE_SYMBOLS: frozenset[str] = frozenset(ASSETS)


@dataclass(frozen=True, slots=True)
class PriceQuote:
    """One USD reference price. ``stale`` means it is past TTL but still inside the stale window."""

    symbol: str
    usd: float
    source: str
    as_of: datetime
    stale: bool = False
    approximate: bool = False
    note: str | None = None


@dataclass(frozen=True, slots=True)
class PriceSnapshot:
    """The result of one lookup: what we could price and what we honestly could not."""

    quotes: Mapping[str, PriceQuote]
    unavailable: frozenset[str] = frozenset()

    def quote(self, symbol: str) -> PriceQuote | None:
        return self.quotes.get(symbol.upper())


@dataclass(slots=True)
class _CacheEntry:
    quote: PriceQuote
    monotonic: float


def _default_now() -> datetime:
    return datetime.now(UTC)


class PriceService:
    """A TTL cache + stale-while-revalidate + breaker in front of two keyless spot sources."""

    def __init__(
        self,
        *,
        base_url: str | None = None,
        fallback_url: str | None = None,
        ttl_s: float = DEFAULT_TTL_S,
        max_stale_s: float = DEFAULT_MAX_STALE_S,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        breaker_threshold: int = DEFAULT_BREAKER_THRESHOLD,
        breaker_cooldown_s: float = DEFAULT_BREAKER_COOLDOWN_S,
        transport: httpx.AsyncBaseTransport | None = None,
        monotonic: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = _default_now,
    ) -> None:
        self._base_url = (base_url or os.getenv(PRICE_API_URL_ENV) or DEFAULT_PRICE_API_URL).rstrip(
            "/"
        )
        self._fallback_url = (
            fallback_url or os.getenv(PRICE_FALLBACK_URL_ENV) or DEFAULT_PRICE_FALLBACK_URL
        ).rstrip("/")
        self._ttl_s = ttl_s
        self._max_stale_s = max_stale_s
        self._timeout_s = timeout_s
        self._breaker_threshold = breaker_threshold
        self._breaker_cooldown_s = breaker_cooldown_s
        self._transport = transport
        self._monotonic = monotonic
        self._now = now
        self._cache: dict[str, _CacheEntry] = {}
        self._inflight: set[str] = set()
        self._tasks: set[asyncio.Task[None]] = set()
        self._failures = 0
        self._open_until = 0.0

    # -- public ------------------------------------------------------------

    async def get(self, symbols: Sequence[str]) -> PriceSnapshot:
        """Return a snapshot for the supported symbols among ``symbols``. Never raises."""
        wanted = tuple(dict.fromkeys(s.upper() for s in symbols if s.upper() in ASSETS))
        if not wanted:
            return PriceSnapshot(quotes={})

        now_m = self._monotonic()
        fresh: dict[str, PriceQuote] = {}
        stale: dict[str, PriceQuote] = {}
        missing: list[str] = []
        for symbol in wanted:
            entry = self._cache.get(symbol)
            if entry is None:
                missing.append(symbol)
                continue
            age = now_m - entry.monotonic
            if age <= self._ttl_s:
                fresh[symbol] = entry.quote
            elif age <= self._max_stale_s:
                stale[symbol] = replace(entry.quote, stale=True)
            else:
                missing.append(symbol)

        breaker_open = now_m < self._open_until
        if missing and not breaker_open:
            await self._refresh(missing)
            # Re-read after the bounded fetch; failures simply stay missing unless a
            # still-inside-the-stale-window value can answer.
            for symbol in missing:
                entry = self._cache.get(symbol)
                if entry is None:
                    continue
                age = now_m - entry.monotonic
                if age <= self._ttl_s:
                    fresh[symbol] = entry.quote
                    stale.pop(symbol, None)
                elif age <= self._max_stale_s:
                    stale[symbol] = replace(entry.quote, stale=True)
                    fresh.pop(symbol, None)

        if stale and not breaker_open:
            self._schedule_refresh(list(stale))

        quotes: dict[str, PriceQuote] = {**stale, **fresh}
        unavailable = frozenset(s for s in wanted if s not in quotes)
        return PriceSnapshot(quotes=quotes, unavailable=unavailable)

    async def refresh(self, symbols: Sequence[str]) -> None:
        """Force a fetch (used by the warm-up and tests). Never raises."""
        wanted = [s.upper() for s in symbols if s.upper() in ASSETS]
        if wanted:
            await self._refresh(wanted)

    # -- cache / breaker ---------------------------------------------------

    def _record_success(self) -> None:
        self._failures = 0
        self._open_until = 0.0

    def _record_failure(self) -> None:
        self._failures += 1
        if self._failures >= self._breaker_threshold:
            self._open_until = self._monotonic() + self._breaker_cooldown_s
            logger.warning(
                "price_feed_breaker_open failures=%s cooldown_s=%s",
                self._failures,
                self._breaker_cooldown_s,
            )

    def _schedule_refresh(self, symbols: list[str]) -> None:
        task = asyncio.create_task(self._refresh(symbols))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _refresh(self, symbols: Sequence[str]) -> None:
        pending = [s for s in dict.fromkeys(symbols) if s not in self._inflight]
        if not pending:
            return
        self._inflight.update(pending)
        try:
            fetched = await asyncio.wait_for(
                self._fetch_sources(pending), timeout=self._timeout_s
            )
        except Exception:  # noqa: BLE001 — any failure is "unavailable", never a crash
            self._record_failure()
            return
        finally:
            self._inflight.difference_update(pending)

        if not fetched:
            self._record_failure()
            return
        self._record_success()
        stamp = self._now()
        for symbol, (usd, source) in fetched.items():
            if symbol == "USDG":
                quote = PriceQuote(
                    symbol=symbol,
                    usd=usd,
                    source=source,
                    as_of=stamp,
                    approximate=True,
                    note="Pegged at about $1; checked against USDC/USDT.",
                )
            else:
                asset = ASSETS[symbol]
                note = None
                if asset.stable and abs(usd - 1.0) > STABLE_PEG_TOLERANCE:
                    note = (
                        f"Depeg check: {symbol} is outside its usual $1 band "
                        f"({STABLE_PEG_TOLERANCE:.0%}); this is the live quote, not a peg."
                    )
                quote = PriceQuote(
                    symbol=symbol, usd=usd, source=source, as_of=stamp, note=note
                )
            self._cache[symbol] = _CacheEntry(quote=quote, monotonic=self._monotonic())

    # -- HTTP --------------------------------------------------------------

    async def _fetch_sources(self, symbols: Sequence[str]) -> dict[str, tuple[float, str]]:
        """Ask the primary source, then the fallback for whatever it could not price."""
        wanted = set(symbols)
        # USDG is derived: fetch the stables that sanity-check it, even when not asked for.
        source_symbols = set(symbols)
        if "USDG" in source_symbols:
            source_symbols.update(("USDC", "USDT"))

        results: dict[str, tuple[float, str]] = {}
        primary = [s for s in source_symbols if ASSETS[s].coingecko_id]
        if primary:
            try:
                results.update(await self._fetch_primary(primary))
            except Exception:  # noqa: BLE001 — fall through to the secondary source
                logger.info("price_primary_unavailable", exc_info=True)

        missing = [s for s in source_symbols if s not in results and ASSETS[s].coinbase_pair]
        if missing:
            try:
                results.update(await self._fetch_fallback(missing))
            except Exception:  # noqa: BLE001 — older cached values may still answer
                logger.info("price_fallback_unavailable", exc_info=True)

        if "USDG" in source_symbols and "USDG" not in results:
            derived = self._derive_usdg(results)
            if derived is not None:
                results["USDG"] = derived

        # Cache the sanity-check stables too; callers only see what they asked for.
        if wanted:
            allowed = wanted | ({"USDC", "USDT"} if "USDG" in wanted else set())
            results = {s: v for s, v in results.items() if s in allowed}
        return results

    @staticmethod
    def _derive_usdg(results: Mapping[str, tuple[float, str]]) -> tuple[float, str] | None:
        """A $1 peg for USDG only while every observed stable is inside the sanity band."""
        observed = [p for s, (p, _) in results.items() if s in ("USDC", "USDT")]
        if not observed:
            return None
        if all(abs(p - 1.0) <= STABLE_PEG_TOLERANCE for p in observed):
            return (1.0, "peg check (USDC/USDT)")
        return None

    async def _fetch_primary(self, symbols: Sequence[str]) -> dict[str, tuple[float, str]]:
        ids = [cid for s in symbols if (cid := ASSETS[s].coingecko_id) is not None]
        if not ids:
            return {}
        async with httpx.AsyncClient(
            timeout=self._timeout_s, transport=self._transport
        ) as client:
            response = await client.get(
                f"{self._base_url}/simple/price",
                params={"ids": ",".join(ids), "vs_currencies": "usd"},
            )
            response.raise_for_status()
            payload = response.json()

        if not isinstance(payload, Mapping):
            return {}
        out: dict[str, tuple[float, str]] = {}
        for symbol in symbols:
            asset = ASSETS[symbol]
            if asset.coingecko_id is None:
                continue
            row = payload.get(asset.coingecko_id)
            if not isinstance(row, Mapping):
                continue
            price = _as_price(row.get("usd"))
            if price is not None:
                out[symbol] = (price, "CoinGecko")
        return out

    async def _fetch_fallback(self, symbols: Sequence[str]) -> dict[str, tuple[float, str]]:
        async with httpx.AsyncClient(
            timeout=self._timeout_s, transport=self._transport
        ) as client:

            async def one(symbol: str) -> tuple[str, float | None]:
                pair = ASSETS[symbol].coinbase_pair
                if pair is None:
                    return symbol, None
                response = await client.get(f"{self._fallback_url}/{pair}/spot")
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, Mapping):
                    return symbol, None
                data = payload.get("data")
                if not isinstance(data, Mapping):
                    return symbol, None
                return symbol, _as_price(data.get("amount"))

            pairs = await asyncio.gather(
                *(one(symbol) for symbol in symbols), return_exceptions=True
            )

        out: dict[str, tuple[float, str]] = {}
        for item in pairs:
            if isinstance(item, BaseException):
                continue
            symbol, price = item
            if price is not None:
                out[symbol] = (price, "Coinbase")
        return out


def _as_price(value: object) -> float | None:
    """A finite, non-negative price from a JSON number or numeric string — else ``None``."""
    if isinstance(value, bool):
        return None
    try:
        price = float(value) if isinstance(value, (int, float, str)) else None
    except (TypeError, ValueError):
        return None
    if price is None or price <= 0.0 or price != price or price == float("inf"):
        return None
    return price


@lru_cache(maxsize=1)
def get_price_service() -> PriceService:
    """The process-wide price service (one cache, one breaker).

    No client is constructed here: ``PriceService`` opens a short-lived client per fetch, so a
    deployment with no egress costs a bounded timeout rather than a broken import.
    """
    return PriceService()
