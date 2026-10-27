"""060 — the deterministic price route.

A price is one of the few figures where a model has nothing useful to add and several ways to be
wrong, so this shape is answered in code BEFORE the planner runs. The route is deliberately narrow:

* it fires only for a price-ish question about a supported asset ("price of ETH", "how much is
  ETH", "ETH worth", "what's BTC trading at");
* it refuses portfolio valuation, APY/rate, vault, fee, swap, balance and explicit commands, so a
  funded order still reaches the normal build path and "what's my portfolio worth?" still reads the
  wallet;
* SRK is matched first and answered from policy — SparkPoint quotes no dollar price for it.

Output is a plain markdown string the DAG wraps in a ``text`` block: no proposed action, no policy
stamp, no path to custody.
"""

from __future__ import annotations

import re
from datetime import UTC

from ..data.prices import PriceSnapshot

__all__ = [
    "PRICE_LOOKUP_TIMEOUT_S",
    "PRICE_UNAVAILABLE_ANSWER",
    "SRK_PRICE_ANSWER",
    "format_price_answer",
    "is_price_question",
    "is_srk_price_question",
    "requested_price_symbols",
]

#: The chat route waits a little longer than the service's own 2s hard timeout so a cached/stale
#: answer still gets a chance to return, but a dead network can never hold the stream open.
PRICE_LOOKUP_TIMEOUT_S = 2.5

#: Context-only assets: quotable, but not tradable on the current network.
_CONTEXT_ONLY = frozenset({"BTC", "SOL", "NEAR"})

#: Symbol → the words a user actually types. NEAR is case/anchor-sensitive because "near" is an
#: ordinary English word, so only the ticker or "near protocol/chain/network/token" counts.
_ALIASES: dict[str, tuple[re.Pattern[str], ...]] = {
    "ETH": (
        re.compile(r"\bETH\b", re.IGNORECASE),
        re.compile(r"\bether\b", re.IGNORECASE),
        re.compile(r"\bethereum\b", re.IGNORECASE),
    ),
    "BTC": (
        re.compile(r"\bBTC\b", re.IGNORECASE),
        re.compile(r"\bbitcoin\b", re.IGNORECASE),
    ),
    "SOL": (
        re.compile(r"\bSOL\b", re.IGNORECASE),
        re.compile(r"\bsolana\b", re.IGNORECASE),
    ),
    "NEAR": (
        re.compile(r"\bNEAR\b"),
        re.compile(r"\bnear\s+(?:protocol|chain|network|token)\b", re.IGNORECASE),
    ),
    "USDC": (re.compile(r"\bUSDC\b", re.IGNORECASE),),
    "USDT": (re.compile(r"\bUSDT\b", re.IGNORECASE),),
    "USDG": (re.compile(r"\bUSDG\b", re.IGNORECASE),),
}

_SRK_RE = re.compile(r"\bSRK\b", re.IGNORECASE)

#: A price question has one of these shapes. Kept broad enough for natural phrasing, never so broad
#: that the negative guard below has to do all the work.
_PRICE_SHAPE_RE = re.compile(
    r"\b(?:price|worth|value|trading\s+at|priced\s+at|cost)\b"
    r"|\bhow\s+much\s+(?:is|does|are|do)\b"
    r"|\bwhat(?:'s|s| is| are)\b[^.?!]{0,30}\b(?:worth|trading|priced|cost)\b",
    re.IGNORECASE,
)

#: Things that look adjacent to a price but belong to another route. "my" catches valuation of a
#: holding ("how much is my ETH worth?"), which needs the wallet read, not a spot quote. The
#: transactional verbs matter just as much: "buy ETH at the current price" is an order with a
#: price clause, not a quote request, so it must reach the planner/swap path.
_NEGATIVE_RE = re.compile(
    r"\b(?:portfolio|balance|wallet|position|positions|holding|holdings|my|"
    r"apy|apr|yield|yielding|vault|vaults|deposit|withdraw|swap|fee|fees|"
    r"slippage|market\s*cap|market\s*order|supply|stake|staking|earn|earning|allocation|"
    r"buy|buying|bought|sell|selling|sold|trade|purchase|purchasing|order|orders|"
    r"exchange|convert|converting|bridge|bridging|lend|lending|borrow|borrowing|"
    r"long|short|limit|send|sending|transfer|transferring|move|moving|invest|investing|"
    r"rebalance|rebalancing|allocate|allocating|redeem|redeeming|claim|claiming|"
    r"repay|repaying|unstake|unstaking|cash\s*out|top\s*up|add|remove|pull|park|"
    r"open|close|exit)\b",
    re.IGNORECASE,
)

#: Estimation shapes belong to the guidance route, never a spot quote. "how much is 10k USDC in
#: 1 year?" is a projection, not a price; "ETH price today" still is a spot question.
_ESTIMATE_RE = re.compile(
    r"\b(?:in|over|per|after|for)\s+"
    r"(?:\d+(?:\.\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+"
    r"(?:days?|weeks?|months?|years?|yrs?|mos?)\b"
    r"|\b(?:annually|monthly|yearly|daily|weekly|quarterly)\b"
    r"|\bper\s+(?:day|week|month|year|annum)\b"
    r"|\b(?:a|one|1)\s+year\b"
    r"|\bnext\s+(?:day|week|month|year)s?\b"
    r"|\bby\s+next\b"
    r"|\bif\s+i\s+(?:deposit|put|invest|stake|lend|supply)\b"
    r"|\b(?:earn|earning|earnings|yield|yielding|returns?|interest|apy|apr|"
    r"grow(?:s|ing|th)?|estimate[ds]?|project(?:ed|ion)?|forecast(?:ed)?|predict(?:ed|ion)?)\b"
    r"|\bworth\s+(?:in|after)\b",
    re.IGNORECASE,
)

#: A quantity the user attaches to an asset ("10k USDC", "$500 of ETH", "1.5 SOL") is a
#: valuation/estimate request, not a spot quote. A number elsewhere ("in 2026") is not enough.
_AMOUNT_RE = re.compile(
    r"(?<![\w.])(?:\$\s*)?\d[\d,]*(?:\.\d+)?\s*"
    r"(?:k|m|mm|b|bn|thousand|million|billion)?(?![\w.])",
    re.IGNORECASE,
)
_AMOUNT_SYMBOL_FILLER_RE = re.compile(
    r"^\s*(?:(?:of|in|into|for|worth|is|at|about|approx(?:imately)?|usd|dollars?)\s*)*$",
    re.IGNORECASE,
)

SRK_PRICE_ANSWER = (
    "SparkPoint doesn't quote a dollar price for SRK. There's no oracle for it, so any USD figure "
    "would be invented — and we won't do that.\n\n"
    "SRK is a utility token: it activates a Sparky Broker, which is what unlocks Premium. It is "
    "not an investment, no yield accrues to it, and it gives no claim on the vault or on protocol "
    "fees. You can get testnet SRK from the faucet on **/srk**."
)

PRICE_UNAVAILABLE_ANSWER = (
    "I couldn't fetch a live price just now, so I won't guess at one. The price feed may be "
    "unreachable from this deployment or briefly rate-limited — try again in a moment.\n\n"
    "Nothing was signed or changed."
)


def _amount_attached_to_asset(message: str) -> bool:
    """True when a quantity sits directly on an asset ("10k USDC", "$500 of ETH", "1.5 SOL")."""
    amounts = [(match.start(), match.end()) for match in _AMOUNT_RE.finditer(message)]
    if not amounts:
        return False
    symbols = [
        (match.start(), match.end())
        for patterns in _ALIASES.values()
        for pattern in patterns
        for match in pattern.finditer(message)
    ]
    symbols.extend((match.start(), match.end()) for match in _SRK_RE.finditer(message))
    return any(
        amount_end <= symbol_start
        and _AMOUNT_SYMBOL_FILLER_RE.match(message[amount_end:symbol_start])
        for _, amount_end in amounts
        for symbol_start, _ in symbols
    )


def is_srk_price_question(message: str) -> bool:
    """True for a price-shaped question about SRK — answered by policy, never by the feed."""
    return bool(_SRK_RE.search(message) and _PRICE_SHAPE_RE.search(message))


def requested_price_symbols(message: str) -> tuple[str, ...]:
    """The supported tickers a message names, in first-mention order (deduped)."""
    found: list[tuple[int, str]] = []
    for symbol, patterns in _ALIASES.items():
        hits = [match.start() for pattern in patterns if (match := pattern.search(message))]
        if hits:
            found.append((min(hits), symbol))
    return tuple(symbol for _, symbol in sorted(found))


def is_price_question(message: str) -> bool:
    """True for a supported-asset SPOT price question that no other route owns.

    A quantity attached to the asset ("10k USDC", "$500 of ETH") or a projection/estimate phrase
    ("in 1 year", "monthly", "yield", "APY") is a guidance question even when it is shaped like
    "how much is …". Those shapes must reach their pre-060 route instead of being quoted as spot.
    """
    if _NEGATIVE_RE.search(message) or _ESTIMATE_RE.search(message):
        return False
    if _amount_attached_to_asset(message):
        return False
    if is_srk_price_question(message):
        return True
    if not requested_price_symbols(message):
        return False
    return bool(_PRICE_SHAPE_RE.search(message))


def _fmt_usd(value: float) -> str:
    if value >= 1000:
        return f"${value:,.2f}"
    if value >= 1:
        return f"${value:.2f}"
    return f"${value:.4f}"


def _join_symbols(symbols: list[str]) -> str:
    """``BTC``, ``BTC and SOL``, or ``BTC, SOL and NEAR`` — stable, deduped order."""
    if len(symbols) <= 2:
        return " and ".join(symbols)
    return f"{', '.join(symbols[:-1])} and {symbols[-1]}"


def format_price_answer(snapshot: PriceSnapshot, symbols: tuple[str, ...]) -> str:
    """Compose the deterministic price answer — quote + source + UTC as-of + not-advice."""
    lines: list[str] = []
    missing: list[str] = []
    for symbol in symbols:
        quote = snapshot.quote(symbol)
        if quote is None:
            missing.append(symbol)
            continue
        kind = "about " if quote.approximate else ""
        source = f"source: {quote.source}"
        if quote.stale:
            source += ", cached while refreshing"
        stamp = quote.as_of.astimezone(UTC).strftime("%H:%M UTC")
        line = f"**{symbol}** is {kind}**{_fmt_usd(quote.usd)}** as of {stamp} ({source})."
        if quote.note:
            line = f"{line} {quote.note}"
        lines.append(line)

    if not lines:
        return PRICE_UNAVAILABLE_ANSWER

    if missing:
        names = ", ".join(missing)
        lines.append(f"I couldn't fetch a live price for {names} just now, so I won't guess.")

    labels = [s for s in symbols if s in snapshot.quotes]
    context_only = [s for s in labels if s in _CONTEXT_ONLY]
    if context_only:
        context = _join_symbols(context_only)
        lines.append(
            f"{context} {'is' if len(context_only) == 1 else 'are'} shown for context only — "
            "SparkPoint doesn't trade or hold it on this network."
        )

    lines.append("Prices move constantly; this is a reference quote, not financial advice.")
    return "\n\n".join(lines)
