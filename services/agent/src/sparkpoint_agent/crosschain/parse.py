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
from decimal import Decimal

from ..amounts import bounded_smallest_units
from .addresses import is_valid_address
from .config import AddressKind, CrossChainAsset, CrossChainConfig

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
#: ``swap 50 USDC for SOL`` / ``convert 50 USDC into SOL`` / ``swap USDC to SOL`` all name the
#: destination the same way. "for" was missing, so the common demo phrasing fell through to the
#: generic "pair not available" answer.
_DEST_RE = re.compile(r"\b(?:into|to|for)\s+(?P<dest>.+)$", re.IGNORECASE)
_CHAIN_MARKER_RE = re.compile(r"\b(?:on|in)\s+(?P<chain>[a-z][a-z ]{0,30})", re.IGNORECASE)
_TRAILING_NOISE_RE = re.compile(r"\b(?:please|now|today|thanks|asap)\b.*$", re.IGNORECASE)

#: Named recipients in the user's message. The bare word "NEAR" is a chain name, not an
#: account — only an explicit ``*.near`` id, a 64-hex implicit account, or a 0x EVM address
#: counts, and only when it matches the route's destination family.
_NAMED_NEAR_RE = re.compile(r"\b[a-z0-9]+(?:[._-][a-z0-9]+)*\.near\b", re.IGNORECASE)
_NAMED_NEAR_IMPLICIT_RE = re.compile(r"\b[0-9a-f]{64}\b")
_NAMED_EVM_RE = re.compile(r"\b0x[0-9a-fA-F]{40}\b")


def parse_named_recipient(message: str, address_kind: AddressKind) -> str | None:
    """Return a destination address the user named, or ``None``.

    Used to prefill the swap card so the user does not have to retype an account they
    already wrote in chat (e.g. ``sparkpoint2026.near``).
    """
    if address_kind == "near":
        match = _NAMED_NEAR_RE.search(message)
        if match is not None:
            candidate = match.group(0).lower()
            return candidate if is_valid_address(candidate, "near") else None
        implicit = _NAMED_NEAR_IMPLICIT_RE.search(message)
        if implicit is not None:
            candidate = implicit.group(0)
            return candidate if is_valid_address(candidate, "near") else None
        return None
    if address_kind == "evm":
        match = _NAMED_EVM_RE.search(message)
        if match is None:
            return None
        candidate = match.group(0)
        return candidate if is_valid_address(candidate, "evm") else None
    return None



@dataclass(frozen=True, slots=True)
class CrossChainRequest:
    """A parsed cross-chain swap in human units plus the smallest-unit amount."""

    origin_key: str
    destination_key: str
    amount: Decimal
    amount_raw: int
    message: str
    recipient: str | None = None

    @property
    def amount_human(self) -> str:
        text = format(self.amount, "f")
        if "." in text:
            text = text.rstrip("0").rstrip(".")
        return text or "0"


@dataclass(frozen=True, slots=True)
class CrossChainClarification:
    """A recognisable cross-chain request that is missing only the amount.

    ``swap USDC to SOL`` used to fall through to the generic swap-pair answer ("pair not
    available"), which is both wrong and unhelpful — the route exists. This carries enough context
    for the coordinator to ask a focused question instead.
    """

    origin_key: str
    destination_key: str
    source_symbol: str
    destination_label: str

    @property
    def message(self) -> str:
        return (
            f"How much {self.source_symbol} would you like to send to {self.destination_label}? "
            f'Tell me an amount — for example "swap 50 {self.source_symbol} to '
            f"{self.destination_label}\" — and I'll quote it. Nothing has been signed or sent."
        )


def _parse_amount(raw: str, scale: str | None, decimals: int) -> tuple[Decimal, int] | None:
    multiplier = {"k": Decimal(1000), "m": Decimal(1_000_000)}.get(
        (scale or "").lower(), Decimal(1)
    )
    return bounded_smallest_units(raw, decimals, multiplier=multiplier)


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
        recipient=parse_named_recipient(text, destination.address_kind),
    )


def parse_cross_chain_clarification(
    message: str, config: CrossChainConfig
) -> CrossChainClarification | None:
    """Return a clarification when a cross-chain request names a route but no amount.

    Only fires when the action verb, source symbol and destination all resolve to a REAL,
    different route. Anything vaguer (``bridge to NEAR``, ``swap USDC``) stays with the normal
    flows rather than guessing. A same-chain pair is deliberately left alone — that is the
    existing swap flow's job, not a missing amount.
    """
    text = message.strip()
    if not text or _ACTION_RE.search(text) is None:
        return None
    if _AMOUNT_TOKEN_RE.search(text) is not None:
        return None

    destination_match = _DEST_RE.search(text)
    if destination_match is None:
        return None

    head = text[: destination_match.start()]
    symbols = list(_SYMBOL_RE.finditer(head))
    if not symbols:
        return None
    source_symbol = symbols[-1].group(0).upper()

    origin = config.default_for_symbol(source_symbol)
    if origin is None:
        return None

    destination = _destination_asset(destination_match.group("dest"), source_symbol, config)
    if destination is None:
        return None
    if origin.key == destination.key:
        return None

    return CrossChainClarification(
        origin_key=origin.key,
        destination_key=destination.key,
        source_symbol=origin.symbol,
        destination_label=destination.chain_label,
    )
