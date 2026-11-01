"""Async client for the NEAR Intents 1Click API (feature 068).

Only the four calls the chat/quote flow needs: ``GET /tokens`` (cached), ``POST /quote`` (dry or
live), ``POST /deposit/submit`` and ``GET /status``. Money is passed as decimal strings — never a
float. A ``400`` is a normal quote answer (``QuoteUnavailable``), not a transport failure.

Cloudflare blocks the default Python user agent, so every request sends
``User-Agent: sparkpoint-agent/1.0``. ``ONECLICK_API_KEY`` is OPTIONAL: when set it is sent as a
Bearer token and is NEVER logged, echoed or exposed through any route. Without a key 1Click adds
its keyless routing fee, which the service surfaces as a fee note.
"""

from __future__ import annotations

import os
import time
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx

USER_AGENT = "sparkpoint-agent/1.0"
API_KEY_ENV = "ONECLICK_API_KEY"
DEFAULT_BASE_URL = "https://1click.chaindefuser.com/v0"
DEFAULT_TIMEOUT_S = 15.0
TOKENS_TTL_S = 300.0


class CrossChainError(Exception):
    """Base class for a cross-chain failure."""


class QuoteUnavailable(CrossChainError):
    """1Click answered, but not with a quote (400). The message is safe to show the user."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class OneClickRejected(CrossChainError):
    """A non-quote 1Click call was rejected (deposit submit / status)."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


class CrossChainTransportError(CrossChainError):
    """The 1Click service could not be reached or returned an unusable response."""


@dataclass(frozen=True, slots=True)
class OneClickToken:
    """One row of ``GET /tokens`` (the fields the app uses)."""

    asset_id: str
    decimals: int
    blockchain: str
    symbol: str
    contract_address: str | None = None

    @classmethod
    def from_wire(cls, raw: Mapping[str, Any]) -> OneClickToken:
        return cls(
            asset_id=str(raw.get("assetId", "")),
            decimals=int(raw.get("decimals", 0)),
            blockchain=str(raw.get("blockchain", "")),
            symbol=str(raw.get("symbol", "")),
            contract_address=(
                str(raw["contractAddress"]) if raw.get("contractAddress") is not None else None
            ),
        )


@dataclass(frozen=True, slots=True)
class QuoteResult:
    """The parts of a 1Click quote the app renders or persists. ``raw`` keeps the signature."""

    raw: Mapping[str, Any]
    amount_in: str
    amount_in_formatted: str
    amount_in_usd: str | None
    amount_out: str
    amount_out_formatted: str
    amount_out_usd: str | None
    min_amount_out: str
    time_estimate_sec: int | None
    deposit_address: str | None
    deadline: str | None
    signature: str | None
    http_status: int = 201

    @classmethod
    def from_payload(cls, payload: Mapping[str, Any], *, http_status: int = 201) -> QuoteResult:
        quote = payload.get("quote")
        if not isinstance(quote, Mapping):
            raise CrossChainTransportError("1Click returned no quote body")
        request = payload.get("quoteRequest")
        request = request if isinstance(request, Mapping) else {}

        def value(key: str) -> str | None:
            raw = quote.get(key)
            return str(raw) if raw is not None else None

        amount_out = value("amountOut")
        if amount_out is None:
            raise CrossChainTransportError("1Click quote is missing amountOut")

        time_estimate = quote.get("timeEstimate")
        return cls(
            raw=payload,
            amount_in=value("amountIn") or "0",
            amount_in_formatted=value("amountInFormatted") or "0",
            amount_in_usd=value("amountInUsd"),
            amount_out=amount_out,
            amount_out_formatted=value("amountOutFormatted") or amount_out,
            amount_out_usd=value("amountOutUsd"),
            min_amount_out=value("minAmountOut") or amount_out,
            time_estimate_sec=(
                int(time_estimate) if isinstance(time_estimate, (int, float)) else None
            ),
            deposit_address=value("depositAddress"),
            deadline=value("deadline")
            or (str(request["deadline"]) if request.get("deadline") is not None else None),
            signature=(str(payload["signature"]) if payload.get("signature") else None),
            http_status=http_status,
        )


def _message(payload: Any, fallback: str) -> str:
    """A short, safe error message from a 1Click error body."""
    if isinstance(payload, Mapping):
        raw = payload.get("message")
        if raw:
            return str(raw)[:300]
    return fallback


class OneClickClient:
    """A thin, injectable 1Click client. ``transport`` lets tests stay offline."""

    def __init__(
        self,
        *,
        base_url: str = DEFAULT_BASE_URL,
        api_key: str | None = None,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Any = time.monotonic,
    ) -> None:
        self._base_url = base_url.rstrip("/") + "/"
        self._api_key = api_key or None
        self._timeout_s = timeout_s
        self._transport = transport
        self._clock = clock
        self._tokens: list[OneClickToken] | None = None
        self._tokens_at = 0.0

    @classmethod
    def from_env(cls, *, transport: httpx.AsyncBaseTransport | None = None) -> OneClickClient:
        return cls(api_key=os.getenv(API_KEY_ENV) or None, transport=transport)

    @property
    def has_api_key(self) -> bool:
        return self._api_key is not None

    def _headers(self) -> dict[str, str]:
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        if self._api_key is not None:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json_body: Mapping[str, Any] | None = None,
        params: Mapping[str, str] | None = None,
    ) -> httpx.Response:
        try:
            async with httpx.AsyncClient(
                base_url=self._base_url,
                timeout=self._timeout_s,
                transport=self._transport,
                headers=self._headers(),
            ) as client:
                return await client.request(method, path.lstrip("/"), json=json_body, params=params)
        except httpx.HTTPError as exc:
            raise CrossChainTransportError("could not reach the 1Click service") from exc

    async def tokens(self, *, force: bool = False) -> list[OneClickToken]:
        """``GET /tokens`` with a short TTL cache. Used to verify asset metadata."""
        now = float(self._clock())
        if not force and self._tokens is not None and now - self._tokens_at < TOKENS_TTL_S:
            return self._tokens
        response = await self._request("GET", "tokens")
        if response.status_code != 200:
            raise CrossChainTransportError(f"1Click tokens returned HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise CrossChainTransportError("1Click tokens returned invalid JSON") from exc
        if not isinstance(payload, list):
            raise CrossChainTransportError("1Click tokens returned an unexpected shape")
        tokens = [OneClickToken.from_wire(item) for item in payload if isinstance(item, Mapping)]
        self._tokens = tokens
        self._tokens_at = now
        return tokens

    async def quote(
        self,
        *,
        dry: bool,
        origin_asset: str,
        destination_asset: str,
        amount: str,
        slippage_bps: int,
        deadline: str,
        refund_to: str,
        recipient: str,
    ) -> QuoteResult:
        """``POST /quote``. ``dry=false`` is the only call that yields a deposit address."""
        body = {
            "dry": dry,
            "swapType": "EXACT_INPUT",
            "slippageTolerance": slippage_bps,
            "originAsset": origin_asset,
            "depositType": "ORIGIN_CHAIN",
            "destinationAsset": destination_asset,
            "amount": amount,
            "refundTo": refund_to,
            "refundType": "ORIGIN_CHAIN",
            "recipient": recipient,
            "recipientType": "DESTINATION_CHAIN",
            "deadline": deadline,
        }
        response = await self._request("POST", "quote", json_body=body)
        if response.status_code in (200, 201):
            try:
                payload = response.json()
            except ValueError as exc:
                raise CrossChainTransportError("1Click quote returned invalid JSON") from exc
            if not isinstance(payload, Mapping):
                raise CrossChainTransportError("1Click quote returned an unexpected shape")
            return QuoteResult.from_payload(payload, http_status=response.status_code)
        if 400 <= response.status_code < 500:
            try:
                payload = response.json()
            except ValueError:
                payload = None
            raise QuoteUnavailable(_message(payload, "Quoting for this pair is not available"))
        raise CrossChainTransportError(f"1Click quote returned HTTP {response.status_code}")

    async def submit_deposit(self, *, deposit_address: str, tx_hash: str) -> Mapping[str, Any]:
        """``POST /deposit/submit`` — an optional speed-up after the user broadcasts."""
        response = await self._request(
            "POST",
            "deposit/submit",
            json_body={"depositAddress": deposit_address, "txHash": tx_hash},
        )
        if 200 <= response.status_code < 300:
            try:
                payload = response.json()
            except ValueError:
                return {}
            return payload if isinstance(payload, Mapping) else {}
        if 400 <= response.status_code < 500:
            try:
                payload = response.json()
            except ValueError:
                payload = None
            raise OneClickRejected(_message(payload, "1Click rejected the deposit submission"))
        raise CrossChainTransportError(
            f"1Click deposit/submit returned HTTP {response.status_code}"
        )

    async def status(self, *, deposit_address: str) -> Mapping[str, Any]:
        """``GET /status`` — the live swap status for a deposit address."""
        response = await self._request("GET", "status", params={"depositAddress": deposit_address})
        if response.status_code != 200:
            if 400 <= response.status_code < 500:
                try:
                    payload = response.json()
                except ValueError:
                    payload = None
                raise OneClickRejected(_message(payload, "1Click could not find that deposit"))
            raise CrossChainTransportError(f"1Click status returned HTTP {response.status_code}")
        try:
            payload = response.json()
        except ValueError as exc:
            raise CrossChainTransportError("1Click status returned invalid JSON") from exc
        if not isinstance(payload, Mapping):
            raise CrossChainTransportError("1Click status returned an unexpected shape")
        return payload


def deadline_at(minutes: int, *, now: datetime | None = None) -> str:
    """An ISO-8601 UTC deadline for a quote request (``now + minutes``)."""
    moment = (now or datetime.now(UTC)) + timedelta(minutes=minutes)
    return moment.astimezone(UTC).isoformat().replace("+00:00", "Z")
