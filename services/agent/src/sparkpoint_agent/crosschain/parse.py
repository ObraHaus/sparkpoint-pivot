"""Deterministic parser for cross-chain requests in chat (feature 068).

This runs BEFORE the LLM classifier, so the four demo prompts work with zero model credits. It is
deliberately narrow: a request needs an action verb, an amount and a source symbol, and it only
fires when the resolved origin and destination are on DIFFERENT 1Click chains (or the destination
is a non-EVM chain). A same-chain swap ("swap 0.1 ETH to USDC") therefore stays with the existing
Aerodrome/Uniswap chat flow.

Supported shapes::

    Swap 5,000 USDC into native BTC.
    Move 10,000 USDC from Ethereum to Base.
    Turn 2,000 USDC into SOL on Solana.
    Swap 500 USDG to USDC on Base.
    Pay my supplier 3,000 USDT on Tron.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, DecimalException, InvalidOperation

from .config import CrossChainAsset, CrossChainConfig

_ACTION_RE = re.compile(
    r"\b(?:swap|swaps|swapping|move|moves|moving|turn|turns|turning|convert|converts|"
    r"converting|bridge|bridges|bridging|send|sends|sending|pay|pays|paying|transfer|"
    r"transfers|transferring)\b",
    re.IGNORECASE,
)
_SYMBOL_RE = re.compile(r"\b(?:USDC|USDT|USDG|BTC|SOL|NEAR)\b", re.IGNORECASE)
#: Native ETH is not a 1Click route in this table; "convert 100 USDC to ETH" must stay a
#: same-chain swap, not become "USDC on Ethereum → USDC on Ethereum".
_UNSUPPORTED_DEST_RE = re.compile(r"\b(?:ETH|WETH)\b", re.IGNORECASE)
_AMOUNT_TOKEN_RE = re.compile(
    r"(?<![\w.])(?P<amount>\d[\d,]*(?:\.\d+)?)\s*(?P<scale>k|m)?\s*"
    r"(?P<symbol>USDC|USDT|USDG|BTC|SOL|NEAR)\b",
    re.IGNORECASE,
)
_FROM_CHAIN_RE = re.compile(
    r"\bfrom\s+(?P<chain>[a-z][a-z ]{0,30}?)(?=\s+(?:to|into|on|in)\b|[,.]|$)",
    re.IGNORECASE,
)
_DEST_RE = re.compile(r"\b(?:into|to)\s+(?P<dest>.+)$", re.IGNORECASE)
_CHAIN_MARKER_RE = re.compile(r"\b(?:on|in)\s+(?P<chain>[a-z][a-z ]{0,30})", re.IGNORECASE)
_TRAILING_NOISE_RE = re.compile(r"\b(?:please|now|today|thanks|asap)\b.*$", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class CrossChainRequest:
    """A parsed cross-chain swap in human units plus the smallest-unit amount."""

    origin_key: str
    destination_key: str
    amount: Decimal
    amount_raw: int
    message: str

    @property
    def amount_human(self) -> str:
        text = format(self.amount, "f")
        if "." in text:
            text = text.rstrip("0").rstrip(".")
        return text or "0"


def _parse_amount(raw: str, scale: str | None, decimals: int) -> tuple[Decimal, int] | None:
    try:
        amount = Decimal(raw.replace(",", ""))
    except InvalidOperation:
        return None
    multiplier = {"k": Decimal(1000), "m": Decimal(1_000_000)}.get(
        (scale or "").lower(), Decimal(1)
    )
    amount *= multiplier
    if not amount.is_finite() or amount <= 0:
        return None
    exponent = amount.as_tuple().exponent
    if isinstance(exponent, int) and -exponent > decimals:
        return None
    try:
        raw_units = int(amount.scaleb(decimals))
    except (DecimalException, ValueError, OverflowError):
        return None
    if raw_units <= 0:
        return None
    return amount, raw_units


def _resolve_source_chain(message: str, config: CrossChainConfig) -> str | None:
    match = _FROM_CHAIN_RE.search(message)
    if match is None:
        return None
    return config.resolve_chain(match.group("chain"))


def _destination_asset(
    destination_text: str,
    source_symbol: str,
    config: CrossChainConfig,
) -> CrossChainAsset | None:
    text = _TRAILING_NOISE_RE.sub("", destination_text).strip(" .,!?:;")
    if not text:
        return None
    if _UNSUPPORTED_DEST_RE.search(text):
        return None

    chain_key: str | None = None
    marker = _CHAIN_MARKER_RE.search(text)
    if marker is not None:
        chain_key = config.resolve_chain(marker.group("chain"))
        if chain_key is None:
            return None
        text = text[: marker.start()].strip(" .,!?:;")

    symbol_match = _SYMBOL_RE.search(text)
    symbol = symbol_match.group(0).upper() if symbol_match is not None else source_symbol

    if chain_key is None:
        chain_key = config.resolve_chain(text)
        if chain_key is None:
            default_asset = config.default_for_symbol(symbol)
            if default_asset is None:
                return None
            chain_key = default_asset.chain

    return config.find_asset(chain_key, symbol)


def _destination_on_chain(
    tail: str, source_symbol: str, config: CrossChainConfig
) -> CrossChainAsset | None:
    """``Pay ... 3,000 USDT on Tron`` — no ``to``/``into``, just a destination chain."""
    match = _CHAIN_MARKER_RE.search(tail)
    if match is None:
        return None
    chain_key = config.resolve_chain(match.group("chain"))
    if chain_key is None:
        return None
    return config.find_asset(chain_key, source_symbol)


def parse_cross_chain_request(message: str, config: CrossChainConfig) -> CrossChainRequest | None:
    """Parse a cross-chain swap request, or ``None`` to leave the turn to existing flows."""
    text = message.strip()
    if not text or _ACTION_RE.search(text) is None:
        return None
    amount_match = _AMOUNT_TOKEN_RE.search(text)
    if amount_match is None:
        return None

    source_symbol = amount_match.group("symbol").upper()
    source_chain = _resolve_source_chain(text, config)
    if source_chain is None:
        origin = config.default_for_symbol(source_symbol)
    else:
        origin = config.find_asset(source_chain, source_symbol)
    if origin is None:
        return None

    parsed_amount = _parse_amount(
        amount_match.group("amount"), amount_match.group("scale"), origin.decimals
    )
    if parsed_amount is None:
        return None
    amount, amount_raw = parsed_amount

    tail = text[amount_match.end() :]
    destination_match = _DEST_RE.search(tail)
    if destination_match is not None:
        destination = _destination_asset(destination_match.group("dest"), source_symbol, config)
    else:
        destination = _destination_on_chain(tail, source_symbol, config)
    if destination is None:
        return None

    # Same-chain EVM swaps are the existing swap flow's job. Only a genuinely cross-chain route
    # (or a non-EVM destination) belongs here.
    if origin.key == destination.key:
        return None
    if origin.chain == destination.chain and destination.address_kind == "evm":
        return None

    return CrossChainRequest(
        origin_key=origin.key,
        destination_key=destination.key,
        amount=amount,
        amount_raw=amount_raw,
        message=message,
    )
