"""Preview/live-quote orchestration for feature 068 (chat + HTTP surfaces).

The chat path asks for a DRY quote and renders :class:`CrossChainQuoteBlock`. The confirm path
(via ``POST /crosschain/quote`` with ``dry=false``) asks for a LIVE quote, which is the only call
that returns a deposit address. The user sends the origin funds from their own wallet; this
service never signs, never holds a key and never takes custody.

Config drives everything (asset ids, decimals, enabled/paused routes), so a client question like
"turn Tron payouts back on" is a ``routes.json`` edit, not a code change.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from ..amounts import bounded_smallest_units
from ..coordinator.chat_blocks import CrossChainQuoteBlock
from .addresses import placeholder_for
from .config import CrossChainAsset, CrossChainConfig
from .oneclick import (
    CrossChainError,
    OneClickClient,
    QuoteResult,
    QuoteUnavailable,
    deadline_at,
)
from .parse import CrossChainRequest

_FEE_NOTE = "Includes 1Click's 0.25% keyless routing fee."


@dataclass(frozen=True, slots=True)
class CrossChainOutcome:
    """The chat turn's payload: a plain-text summary plus the structured card."""

    text: str
    block: CrossChainQuoteBlock


def _trim_decimal(value: Decimal) -> str:
    text = format(value, "f")
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def format_raw_units(raw: str, decimals: int) -> str:
    """Format a smallest-unit integer string as a human decimal string (no float)."""
    try:
        value = Decimal(int(raw)).scaleb(-decimals)
    except (InvalidOperation, ValueError):
        return str(raw)
    return _trim_decimal(value)


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


#: 1Click's bridge minimums arrive as smallest units inside a prose error, e.g.
#: ``"Amount is too low for bridge, try at least 150000"``. Only a number that follows a
#: minimum/threshold phrase is a candidate — never every integer in the message (status codes,
#: request ids, chain ids). An already-human decimal (``"at least 0.15"``) is left untouched.
_MIN_AMOUNT_ERROR_RE = re.compile(
    r"(?i)(?P<lead>(?:too low|at least|minimum(?:\s+amount)?|min(?:imum)?\s+amount|"
    r"below(?:\s+the)?\s+minimum)[^\d]{0,40}?)(?<![$€£])(?P<amount>\d+(?:\.\d+)?)"
)


def format_quote_error_amount(reason: str, *, decimals: int, symbol: str) -> str:
    """Render an upstream minimum-amount error in the SENDING asset's human units.

    The upstream (1Click) number is smallest units, but it is shown to a person. ``150000`` with
    USDC's 6 decimals becomes ``0.15 USDC``; ETH (18), SOL (9) and NEAR (24) convert the same way.
    The asset is always the quote's origin leg — never a guessed or destination asset. A reason
    with no threshold phrase, or one that already carries a decimal, is returned unchanged.
    """
    if not reason or decimals < 0:
        return reason

    def _replace(match: re.Match[str]) -> str:
        raw = match.group("amount")
        # A decimal is already human; a small integer is more likely a human amount ("100 USDC")
        # than a raw minimum. Real 1Click base-unit minimums are large, so only convert those.
        if "." in raw or int(raw) < 1000:
            return match.group(0)
        try:
            value = Decimal(int(raw)).scaleb(-decimals)
        except (InvalidOperation, ValueError):
            return match.group(0)
        return f"{match.group('lead')}{_trim_decimal(value)} {symbol}".rstrip()

    return _MIN_AMOUNT_ERROR_RE.sub(_replace, reason)


def format_usd_two_dp(value: str | None) -> str | None:
    """Format a 1Click USD string as ``$1,234.56`` for prose — never expose raw 12-dp floats.

    ``None`` (no USD estimate) and malformed values are dropped rather than rendered verbatim.
    Display only: the structured block keeps the wire value.
    """
    if not value:
        return None
    try:
        amount = Decimal(value)
    except (InvalidOperation, ValueError):
        return None
    if not amount.is_finite():
        return None
    return f"${amount:,.2f}"


class CrossChainService:
    """One 1Click client + the route config, with preview/live quote helpers."""

    def __init__(
        self,
        config: CrossChainConfig,
        client: OneClickClient,
    ) -> None:
        self.config = config
        self.client = client

    @property
    def feature_enabled(self) -> bool:
        return self.config.feature_enabled

    def _assets(
        self, origin_key: str, destination_key: str
    ) -> tuple[CrossChainAsset, CrossChainAsset]:
        origin = self.config.asset(origin_key)
        destination = self.config.asset(destination_key)
        if origin is None or destination is None:
            raise ValueError("unknown cross-chain asset key")
        return origin, destination

    def _disabled_reason(self, origin: CrossChainAsset, destination: CrossChainAsset) -> str | None:
        for asset in (origin, destination):
            if not asset.enabled:
                return (
                    asset.unavailable_reason
                    or f"1Click is not quoting {asset.chain_label} payouts right now"
                )
        return None

    def _unavailable(
        self,
        request: CrossChainRequest,
        origin: CrossChainAsset,
        destination: CrossChainAsset,
        reason: str,
    ) -> CrossChainOutcome:
        wire_origin = origin.origin_wire(request.amount_human)
        wire_destination = destination.destination_wire()
        # 1112 — the minimum, if the upstream names one, is in the ORIGIN asset's smallest units.
        reason = format_quote_error_amount(reason, decimals=origin.decimals, symbol=origin.symbol)
        block = CrossChainQuoteBlock(
            state="unavailable",
            origin=wire_origin,
            destination=wire_destination,
            slippage_bps=self.config.slippage_bps,
            unavailable_reason=reason,
            quoted_at=_now_iso(),
            recipient=request.recipient,
        )
        text = (
            f"I can't quote that cross-chain route right now: {reason}. Nothing was signed or sent."
        )
        return CrossChainOutcome(text=text, block=block)

    async def request_quote(
        self,
        *,
        origin_key: str,
        destination_key: str,
        amount_raw: int,
        dry: bool,
        recipient: str,
        refund_to: str,
    ) -> QuoteResult:
        """Ask 1Click for one quote. A paused route raises ``QuoteUnavailable``."""
        origin, destination = self._assets(origin_key, destination_key)
        disabled = self._disabled_reason(origin, destination)
        if disabled is not None:
            raise QuoteUnavailable(disabled)
        return await self.client.quote(
            dry=dry,
            origin_asset=origin.asset_id,
            destination_asset=destination.asset_id,
            amount=str(amount_raw),
            slippage_bps=self.config.slippage_bps,
            deadline=deadline_at(self.config.deadline_minutes),
            refund_to=refund_to,
            recipient=recipient,
        )

    async def preview(self, request: CrossChainRequest) -> CrossChainOutcome:
        """A dry quote for the chat preview. Raises only for transport failures."""
        origin, destination = self._assets(request.origin_key, request.destination_key)
        disabled = self._disabled_reason(origin, destination)
        if disabled is not None:
            return self._unavailable(request, origin, destination, disabled)

        try:
            quote = await self.request_quote(
                origin_key=request.origin_key,
                destination_key=request.destination_key,
                amount_raw=request.amount_raw,
                dry=True,
                recipient=placeholder_for(destination.address_kind),
                refund_to=placeholder_for(origin.address_kind),
            )
        except QuoteUnavailable as exc:
            return self._unavailable(request, origin, destination, exc.reason)

        return self._preview_outcome(request, origin, destination, quote)

    def _preview_outcome(
        self,
        request: CrossChainRequest,
        origin: CrossChainAsset,
        destination: CrossChainAsset,
        quote: QuoteResult,
    ) -> CrossChainOutcome:
        amount_out = quote.amount_out_formatted
        min_out = format_raw_units(quote.min_amount_out, destination.decimals)
        fee_note = None if self.client.has_api_key else _FEE_NOTE
        expires_hint = f"Quote expires in about {self.config.deadline_minutes} minutes."
        block = CrossChainQuoteBlock(
            state="preview",
            origin=origin.origin_wire(request.amount_human),
            destination=destination.destination_wire(),
            amount_out=amount_out,
            amount_out_usd=quote.amount_out_usd,
            amount_in_usd=quote.amount_in_usd,
            min_amount_out=min_out,
            time_estimate_sec=quote.time_estimate_sec,
            slippage_bps=self.config.slippage_bps,
            fee_note=fee_note,
            quoted_at=_now_iso(),
            expires_hint=expires_hint,
            recipient=request.recipient,
        )

        eta = (
            f"about {max(1, round(quote.time_estimate_sec / 60))} min"
            if quote.time_estimate_sec
            else "a short time"
        )
        usd_value = format_usd_two_dp(quote.amount_out_usd)
        usd = f" (about {usd_value})" if usd_value else ""
        text = (
            f"Preview only — nothing is signed or sent. {request.amount_human} "
            f"{origin.symbol} on {origin.chain_label} → about {amount_out} {destination.symbol} "
            f"on {destination.chain_label}{usd}, settling in {eta}. {expires_hint}"
        )
        if fee_note:
            text = f"{text} {fee_note}"
        return CrossChainOutcome(text=text, block=block)

    async def live_quote(
        self,
        *,
        origin_key: str,
        destination_key: str,
        amount: Decimal,
        amount_raw: int,
        recipient: str,
        refund_to: str,
    ) -> tuple[QuoteResult, CrossChainAsset, CrossChainAsset]:
        """A LIVE quote (``dry=false``) — the call that returns the deposit address."""
        origin, destination = self._assets(origin_key, destination_key)
        quote = await self.request_quote(
            origin_key=origin_key,
            destination_key=destination_key,
            amount_raw=amount_raw,
            dry=False,
            recipient=recipient,
            refund_to=refund_to,
        )
        if not quote.deposit_address:
            raise CrossChainError("1Click did not return a deposit address")
        return quote, origin, destination

    async def submit_deposit(self, *, deposit_address: str, tx_hash: str) -> dict[str, Any]:
        payload = await self.client.submit_deposit(deposit_address=deposit_address, tx_hash=tx_hash)
        return dict(payload)

    async def status(self, *, deposit_address: str) -> dict[str, Any]:
        payload = await self.client.status(deposit_address=deposit_address)
        return dict(payload)


def amount_from_human(text: str, decimals: int) -> tuple[Decimal, int] | None:
    """Parse a human amount (``"5,000.50"``) into ``(Decimal, smallest-unit int)``."""
    return bounded_smallest_units(text, decimals)


def build_service_from_env() -> CrossChainService | None:
    """The production service, or ``None`` when the feature flag is off."""
    from .config import default_config

    config = default_config()
    if not config.feature_enabled:
        return None
    return CrossChainService(config, OneClickClient.from_env())
