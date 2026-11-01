"""Deterministic earn parser (feature 069) — runs before the planner.

It is deliberately narrow and only fires on an explicit **Morpho** mention (or a configured vault
name), so the existing vault/deposit flow keeps phrases like "deposit 100 USDC into the vault" and
a comparative turn ("Compare Aave and Morpho, then deposit 500 USDC into the safer one") reaches
the planner unchanged.

Supported shapes::

    Deposit 100 USDC into Morpho Gauntlet USDC Prime
    Put 500 USDC in Morpho on Base
    Stake 50 USDC into the Moonwell Flagship USDC vault
    Show Morpho vaults on Base
    List Morpho vaults on Ethereum for USDC
    What's the best Morpho vault on Base?
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Literal

from .config import EarnConfig

EarnKind = Literal["list", "deposit"]
EarnSort = Literal["tvl", "apy"]

_ALIASES = {
    "base": "base",
    "base mainnet": "base",
    "ethereum": "eth",
    "ethereum mainnet": "eth",
    "eth": "eth",
    "mainnet": "eth",
}

_LIST_VERB_RE = re.compile(
    r"\b(?:show|list|what|which|best|available|find|see|tell)\b", re.IGNORECASE
)
_LIST_RE = re.compile(r"\bvaults?\b", re.IGNORECASE)
_MORPHO_RE = re.compile(r"\bmorpho\b", re.IGNORECASE)
_BEST_RE = re.compile(r"\bbest\b", re.IGNORECASE)
_DEPOSIT_VERB_RE = re.compile(
    r"\b(?:earn|deposit|deposits|depositing|put|puts|putting|stake|stakes|staking|"
    r"invest|invests|investing|supply|supplies|supplying|lend|lends|lending)\b",
    re.IGNORECASE,
)
_AMOUNT_RE = re.compile(
    r"(?<![\w.])(?P<amount>\d[\d,]*(?:\.\d+)?)\s*(?P<scale>k|m)?\s*"
    r"(?P<symbol>USDC|USDT|WETH|ETH|cbBTC|CBBTC)\b",
    re.IGNORECASE,
)
_TARGET_RE = re.compile(
    r"\b(?:into|in|to|with|via)\s+(?P<target>.+)$", re.IGNORECASE
)
_CHAIN_MARKER_RE = re.compile(
    r"\b(?:on|in)\s+(?P<chain>base|base mainnet|ethereum|ethereum mainnet|eth|mainnet)\b",
    re.IGNORECASE,
)
_FROM_CHAIN_RE = re.compile(
    r"\bfrom\s+(?P<chain>base|base mainnet|ethereum|ethereum mainnet|eth|mainnet)\b",
    re.IGNORECASE,
)
_FOR_ASSET_RE = re.compile(r"\bfor\s+(?P<asset>USDC|USDT|WETH|ETH|cbBTC)\b", re.IGNORECASE)
_TRAILING_NOISE_RE = re.compile(r"\b(?:please|now|today|thanks|asap)\b.*$", re.IGNORECASE)

_DECIMALS = {"USDC": 6, "USDT": 6, "WETH": 18, "ETH": 18, "CBBTC": 8}


@dataclass(frozen=True, slots=True)
class EarnRequest:
    kind: EarnKind
    chain: str | None
    asset: str | None
    amount: Decimal | None
    amount_raw: int | None
    vault_query: str | None
    sort: EarnSort
    message: str
    origin_chain: str | None = None

    @property
    def amount_human(self) -> str | None:
        if self.amount is None:
            return None
        text = format(self.amount, "f")
        if "." in text:
            text = text.rstrip("0").rstrip(".")
        return text or "0"


def _chain_from(text: str) -> str | None:
    match = _CHAIN_MARKER_RE.search(text)
    if match is None:
        return None
    return _ALIASES.get(" ".join(match.group("chain").lower().split()))


def _origin_chain_from(text: str) -> str | None:
    match = _FROM_CHAIN_RE.search(text)
    if match is None:
        return None
    return _ALIASES.get(" ".join(match.group("chain").lower().split()))


def _amount(text: str) -> tuple[Decimal, int, str] | None:
    match = _AMOUNT_RE.search(text)
    if match is None:
        return None
    try:
        amount = Decimal(match.group("amount").replace(",", ""))
    except InvalidOperation:
        return None
    multiplier = {"k": Decimal(1000), "m": Decimal(1_000_000)}.get(
        (match.group("scale") or "").lower(), Decimal(1)
    )
    amount *= multiplier
    if amount <= 0:
        return None
    symbol = match.group("symbol").upper()
    decimals = _DECIMALS.get(symbol, 18)
    exponent = amount.as_tuple().exponent
    if isinstance(exponent, int) and -exponent > decimals:
        return None
    raw = int(amount.scaleb(decimals))
    if raw <= 0:
        return None
    return amount, raw, symbol


def _vault_query(target: str, config: EarnConfig) -> str | None:
    text = _TRAILING_NOISE_RE.sub("", target).strip(" .,!?:;")
    text = _CHAIN_MARKER_RE.sub("", text).strip(" .,!?:;")
    lowered = text.lower()
    for name in config.known_vault_names:
        if name.lower() in lowered:
            return name
    if "morpho" not in lowered:
        return None
    cleaned = re.sub(r"\bmorpho(?:\s+vaults?)?\b", " ", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"^(?:the|a|an)\s+", "", cleaned.strip(), flags=re.IGNORECASE)
    cleaned = re.sub(r"\bvaults?\b$", "", cleaned, flags=re.IGNORECASE).strip(" .,!?:;")
    return cleaned


def parse_earn_request(message: str, config: EarnConfig) -> EarnRequest | None:
    """Parse an explicit Morpho list/deposit request, or ``None`` to leave the turn alone."""
    text = message.strip()
    if not text:
        return None
    mentions_morpho = _MORPHO_RE.search(text) is not None
    mentions_known = config.is_known_vault_name(text)

    if (
        _LIST_RE.search(text) is not None
        and _LIST_VERB_RE.search(text) is not None
        and (mentions_morpho or mentions_known)
    ):
        chain = _chain_from(text)
        asset_match = _FOR_ASSET_RE.search(text)
        asset = asset_match.group("asset").upper() if asset_match is not None else None
        if asset == "ETH":
            asset = "WETH"
        sort: EarnSort = "apy" if _BEST_RE.search(text) is not None else "tvl"
        return EarnRequest(
            kind="list",
            chain=chain,
            asset=asset,
            amount=None,
            amount_raw=None,
            vault_query=None,
            sort=sort,
            message=message,
        )

    if _DEPOSIT_VERB_RE.search(text) is None:
        return None
    amount = _amount(text)
    if amount is None:
        return None
    target_match = _TARGET_RE.search(text)
    if target_match is None:
        return None
    target = target_match.group("target")
    query = _vault_query(target, config)
    if query is None:
        return None

    parsed_amount, raw, symbol = amount
    return EarnRequest(
        kind="deposit",
        chain=_chain_from(text),
        asset=symbol,
        amount=parsed_amount,
        amount_raw=raw,
        vault_query=query or None,
        sort="tvl",
        message=message,
        origin_chain=_origin_chain_from(text),
    )
