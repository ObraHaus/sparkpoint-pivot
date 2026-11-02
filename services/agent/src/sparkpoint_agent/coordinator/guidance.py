"""057 — deterministic replies for the four beta chat dead-ends.

The audit prompts below are handled here, in plain Python, for the same reason the 029/031/048
routes are: a classifier can be re-taught and still drift, while these shapes have a knowable
correct answer. Nothing in this module can emit an action block, and nothing here bypasses the
policy gate — the DAG still runs ``propose`` → ``policy.evaluate`` for every proposal.

Covered:
  * an empty-wallet / no-mandate yield question (curated options, a labelled estimate, the Aave
    comparison, the Rhea NEAR-yield path, and a next step) instead of the guardrails dead-end;
  * unsupported swap targets (native BTC, SOL/Solana, NEAR) instead of the default USDG ↔ ETH card;
  * unsafe-transfer / prompt-injection detection with an explicit refusal;
  * small parsing helpers for amounts/durations and the deposit/withdraw/follow-up predicates.

Every figure comes from injected curated/market data. A missing figure is stated as unavailable,
never filled in.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from decimal import ROUND_HALF_UP, Decimal

from ..formatting import format_usd
from .comparative import KNOWN_SUBJECTS, aliases_for
from .curated import CuratedContext, CuratedPick
from .staleness import as_of_suffix, staleness_caveat

__all__ = [
    "CONFIRMATION_RE",
    "NEAR_NATIVE_STAKING_ANSWER",
    "NOTHING_TO_WITHDRAW",
    "UNSAFE_REFUSAL",
    "amount_from_text",
    "duration_months",
    "has_financial_action_verb",
    "is_comparative_question",
    "is_confirmation",
    "is_explicit_financial_command",
    "is_protocol_choice_question",
    "is_unsafe_request",
    "is_withdraw_all",
    "is_withdraw_request",
    "is_yield_guidance_question",
    "last_proposal_message",
    "mentions_withdraw_exception",
    "named_swap_pair",
    "previous_amount",
    "swap_pair_matches",
    "swap_pair_unavailable_answer",
    "unsupported_swap_answer",
    "unsupported_swap_target",
    "withdraw_all_amount",
    "withdraw_all_exception_amount",
    "yield_guidance_answer",
]

# ─────────────────────────────────────────────────────────────────────────────
# Amount + duration parsing
# ─────────────────────────────────────────────────────────────────────────────

_DOLLAR_AMOUNT_RE = re.compile(r"\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b", re.IGNORECASE)
_STABLE_AMOUNT_RE = re.compile(
    r"\b(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\s*(?:usdc|usdg|dollars?|bucks|stablecoins?)\b",
    re.IGNORECASE,
)
_MULTIPLIER = {"k": 1_000, "m": 1_000_000}

_DURATION_RE = re.compile(r"\b(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)\b", re.IGNORECASE)
_ANNUAL_RE = re.compile(r"\b(?:annual|annually|per year|a year|one year|yearly)\b", re.IGNORECASE)
_HALF_RE = re.compile(r"\bhalf\b", re.IGNORECASE)
_QUARTER_RE = re.compile(r"\bquarter\b", re.IGNORECASE)
_DOUBLE_RE = re.compile(r"\b(?:double|twice)\b", re.IGNORECASE)


def _to_base_units(raw: str, multiplier: str | None) -> int | None:
    """Dollar text → exact 6-dp stable base units (never a float)."""
    text = raw.replace(",", "")
    try:
        value = Decimal(text) * _MULTIPLIER.get((multiplier or "").lower(), 1)
    except (ArithmeticError, ValueError):
        return None
    units = int((value * 1_000_000).to_integral_value(rounding=ROUND_HALF_UP))
    return units if units > 0 else None


def amount_from_text(text: str) -> int | None:
    """The first *money* amount in ``text``, in 6-dp base units, or ``None``.

    Requires a currency marker (``$`` or USDC/USDG/dollars) so "in 6 months" is never read as an
    amount. ``k``/``m`` suffixes are honoured ("10k usdc").
    """
    for pattern in (_DOLLAR_AMOUNT_RE, _STABLE_AMOUNT_RE):
        match = pattern.search(text)
        if match is not None:
            amount = _to_base_units(match.group(1), match.group(2))
            if amount is not None:
                return amount
    return None


def duration_months(text: str) -> int | None:
    """The duration in ``text`` as whole months (``1 yr`` → 12, ``6 months`` → 6)."""
    match = _DURATION_RE.search(text)
    if match is not None:
        value = Decimal(match.group(1))
        unit = match.group(2).lower()
        months = value * (12 if unit.startswith(("year", "yr")) else 1)
        return max(1, int(months.to_integral_value(rounding=ROUND_HALF_UP)))
    return 12 if _ANNUAL_RE.search(text) else None


def _scaled_followup(message: str, base: int) -> int:
    if _HALF_RE.search(message):
        return max(1, base // 2)
    if _QUARTER_RE.search(message):
        return max(1, base // 4)
    if _DOUBLE_RE.search(message):
        return base * 2
    return base


def previous_amount(history: Sequence[tuple[str, str]] | None) -> int | None:
    """The most recent amount the USER typed in this conversation, or ``None``."""
    for role, content in reversed(list(history or ())):
        if role != "user":
            continue
        amount = amount_from_text(str(content))
        if amount is not None:
            return amount
    return None


def _previous_duration(history: Sequence[tuple[str, str]] | None) -> int | None:
    for role, content in reversed(list(history or ())):
        if role != "user":
            continue
        months = duration_months(str(content))
        if months is not None:
            return months
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Intent-shape predicates
# ─────────────────────────────────────────────────────────────────────────────

_FINANCIAL_VERB_RE = re.compile(
    r"\b(?:deposit|supply|stake|withdraw|redeem|cash\s?out|unstake|swap|exchange|convert|"
    r"trade|buy|sell|transfer|send)\b",
    re.IGNORECASE,
)
#: A withdraw-all instruction needs an EXIT verb. "take all the risk" and "move all my money
#: into the vault" are not withdrawals: the latter is a deposit, the former is not an action at
#: all. Bare take/pull/move only count when paired with "out", where they really mean an exit.
_WITHDRAW_ALL_RE = re.compile(
    r"(?:\b(?:withdraw|redeem|cash\s?out)\b[^.?!]{0,60}"
    r"\b(?:everything|all|max(?:imum)?|full|entire)\b)"
    r"|(?:\b(?:take|pull|move|get|remove|close)\b[^.?!]{0,60}\bout\b[^.?!]{0,40}"
    r"\b(?:everything|all|max(?:imum)?|full|entire)\b)"
    r"|(?:\b(?:take|pull|move|get|remove|close)\b[^.?!]{0,40}"
    r"\b(?:everything|all|max(?:imum)?|full|entire)\b[^.?!]{0,40}\bout\b)",
    re.IGNORECASE,
)

#: Any explicit exit request (with or without an "all" marker) — used to keep the deposit-balance
#: guard from blocking a legitimate withdraw command.
_WITHDRAW_REQUEST_RE = re.compile(
    r"\b(?:withdraw|redeem|cash\s?out)\b"
    r"|\b(?:take|pull|move|get|remove|close)\b[^.?!]{0,40}\bout\b",
    re.IGNORECASE,
)

#: "withdraw everything except 100" must leave a residual, never the whole position. The amount
#: may carry a currency marker or not, because "except 100" is ordinary phrasing.
_WITHDRAW_EXCEPTION_RE = re.compile(
    r"\b(?:except|excluding|minus|less|other\s+than|but\s+not|leaving|leave|keep)\b"
    r"[^.?!]{0,30}?\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?",
    re.IGNORECASE,
)
_WITHDRAW_EXCEPTION_WORD_RE = re.compile(
    r"\b(?:except|excluding|minus|less|other\s+than|but\s+not|leaving|leave|keep)\b",
    re.IGNORECASE,
)

CONFIRMATION_RE = re.compile(
    r"^\s*(?:ok(?:ay)?[,\s]+)?(?:yes[,\s]+)?(?:please[,\s]+)?"
    r"(?:do it|go ahead|proceed|confirm|execute|make it happen|do that|sign it|send it)"
    r"(?:\s+(?:now|please))?\s*[.!]?\s*$",
    re.IGNORECASE,
)

_PROPOSAL_MARKER_RE = re.compile(r"\[(?:proposed action|recommended):", re.IGNORECASE)


def is_confirmation(message: str) -> bool:
    """True for a bare "do it" / "yes, go ahead" follow-up (not a new instruction)."""
    return bool(CONFIRMATION_RE.match(message))


def is_withdraw_all(message: str) -> bool:
    """True for an *instruction* to withdraw the whole position (never a "how do I" question)."""
    if re.search(r"\bhow\b", message, re.IGNORECASE):
        return False
    return bool(_WITHDRAW_ALL_RE.search(message))


def is_withdraw_request(message: str) -> bool:
    """True when the turn is an explicit exit request (withdraw/redeem/cash out/take out)."""
    return bool(_WITHDRAW_REQUEST_RE.search(message))


def mentions_withdraw_exception(message: str) -> bool:
    """True when a withdraw-all instruction carves an amount out ("except 100", "keep 50")."""
    return bool(_WITHDRAW_EXCEPTION_WORD_RE.search(message))


def withdraw_all_exception_amount(message: str) -> int | None:
    """The amount to LEAVE BEHIND in "withdraw everything except 100", in base units."""
    match = _WITHDRAW_EXCEPTION_RE.search(message)
    if match is None:
        return None
    return _to_base_units(match.group(1), match.group(2))


def is_explicit_financial_command(message: str) -> bool:
    """True when the turn is a command carrying an amount (or "everything"), not a question."""
    if not _FINANCIAL_VERB_RE.search(message):
        return False
    return amount_from_text(message) is not None or is_withdraw_all(message)


#: 063 Defender — the action verbs that make a turn an instruction even when no amount parses.
#: This is a SUPERSET of ``_FINANCIAL_VERB_RE``: the explicit-command guard keeps its narrower
#: list (so a sized "which vault should I put 1,000 USDC in?" stays a curated question), while
#: the comparative guard must never swallow a turn that asks for an action. Amount is NOT
#: required here: "deposit my entire balance into whichever is safer than Aave" acts.
_ACTION_VERB_RE = re.compile(
    r"\b(?:deposit|supply|stake|withdraw|redeem|cash\s?out|unstake|swap|exchange|convert|"
    r"trade|buy|sell|transfer|send|move|put|invest|allocate|rebalance|lend|borrow)\b",
    re.IGNORECASE,
)


def has_financial_action_verb(message: str) -> bool:
    """True when the turn names a financial ACTION verb (an amount is NOT required)."""
    return bool(_ACTION_VERB_RE.search(message))


def last_proposal_message(history: Sequence[tuple[str, str]] | None) -> str | None:
    """The user request behind the most recent assistant proposal, or ``None``.

    The persisted assistant summary marks a proposal with ``[proposed action: …]`` /
    ``[recommended: …]``; the user turn immediately before it is the request to replay for a
    "do it" follow-up.
    """
    turns = list(history or ())
    for index in range(len(turns) - 1, -1, -1):
        role, content = turns[index]
        if role == "assistant" and _PROPOSAL_MARKER_RE.search(str(content)):
            for prior in range(index - 1, -1, -1):
                if turns[prior][0] == "user":
                    text = str(turns[prior][1]).strip()
                    return text or None
            return None
    return None


# ─────────────────────────────────────────────────────────────────────────────
# C — unsupported swap targets
# ─────────────────────────────────────────────────────────────────────────────

_SWAP_VERB_RE = re.compile(
    r"\b(?:swap|swapping|convert|convert(?:ing)?|turn|exchange|trade|buy)\b", re.IGNORECASE
)

# TON is both a ticker and an ordinary English word ("a ton of ETH"), so it only counts when it
# is unambiguously the chain/asset: "toncoin" (any case), or uppercase "TON" (which also covers
# "TON chain/network/token"). An all-caps "TON OF …" is still the English quantifier.
_TON_RE = re.compile(r"\bTON\b(?!\s+(?i:of)\b)|(?i:\btoncoin\b|\bton\s+(?:chain|network|token)\b)")

# NEAR likewise: uppercase NEAR (which also covers "on/into/to/for NEAR" and
# "NEAR protocol/chain/network/token"), or "Rhea". Lowercase "near-term", "near the top" and
# "near zero" are ordinary English and must not be read as the asset.
_NEAR_RE = re.compile(
    r"\bNEAR\b|(?i:\bnear\s+(?:protocol|chain|network|token)\b|\brhea(?:\s+finance)?\b)"
)

_UNSUPPORTED_TARGETS: tuple[tuple[re.Pattern[str], str], ...] = (
    (_NEAR_RE, "NEAR"),
    (_TON_RE, "that chain"),
    (re.compile(r"\bsolana\b|\bsol\b", re.IGNORECASE), "SOL on Solana"),
    (
        re.compile(r"\bnative\s+btc\b|\bbitcoin\b|\bw?btc\b|\bcbbtc\b", re.IGNORECASE),
        "native BTC",
    ),
    (re.compile(r"\bxrp\b|\bripple\b", re.IGNORECASE), "XRP"),
    (re.compile(r"\bdoge(?:coin)?\b|\bshib\b|\bpepe\b", re.IGNORECASE), "that asset"),
    (re.compile(r"\busdt\b|\bdai\b|\blink\b|\buni\b", re.IGNORECASE), "that asset"),
    (re.compile(r"\bcardano\b|\bada\b", re.IGNORECASE), "Cardano (ADA)"),
    (re.compile(r"\bavalanche\b|\bavax\b", re.IGNORECASE), "AVAX"),
    (re.compile(r"\bpolygon\b|\bmatic\b", re.IGNORECASE), "MATIC/POL"),
    (re.compile(r"\bsui\b|\baptos\b|\btron\b", re.IGNORECASE), "that chain"),
    (
        re.compile(
            r"\bon\s+(?:ethereum|arbitrum|optimism|polygon|avalanche|solana|bitcoin|bsc)\b",
            re.IGNORECASE,
        ),
        "that chain",
    ),
)

_RECEIVE_SIDE_RE = re.compile(r"\b(?:into|to|for)\s+(?P<target>[^.?!\n]+)", re.IGNORECASE)


def _swap_sides(message: str) -> tuple[str, str]:
    """Split a swap command into (source text, target text).

    "swap my NEAR to USDC" → ("swap my NEAR ", "USDC"); "swap ETH for SOL" → (…, "SOL").
    With no into/to/for marker the whole message is the source side (e.g. "buy NEAR"), which
    lets a bare asset still be found without inventing a target.
    """
    match = _RECEIVE_SIDE_RE.search(message)
    if match is None:
        return message, ""
    return message[: match.start()], match.group("target")


def unsupported_swap_target(message: str) -> str | None:
    """The requested-but-unsupported asset/chain on EITHER side of a swap, or ``None``.

    Both sides matter: "swap my NEAR to USDC" is just as unsupported as "swap ETH to NEAR", and
    letting the source side fall through reproduced the wrong default USDG ↔ ETH card. The
    receive side is checked first so an unsupported target is the label we report.
    """
    if not _SWAP_VERB_RE.search(message):
        return None
    source, target = _swap_sides(message)
    for pattern, label in _UNSUPPORTED_TARGETS:
        if pattern.search(target):
            return label
    for pattern, label in _UNSUPPORTED_TARGETS:
        if pattern.search(source):
            return label
    return None


#: The assets this product can actually swap. USDC and USDG are both the chain-local stable, so
#: they normalise to one symbol for comparison (the card names whichever is real on the chain).
_SWAP_SYMBOL_RE = re.compile(r"\b(eth|usdc|usdg)\b", re.IGNORECASE)


def _normalise_symbol(symbol: str | None) -> str | None:
    if symbol is None:
        return None
    value = symbol.strip().upper()
    if value in {"USDC", "USDG"}:
        return "STABLE"
    return "ETH" if value == "ETH" else value


def _first_swap_symbol(text: str) -> str | None:
    match = _SWAP_SYMBOL_RE.search(text)
    return _normalise_symbol(match.group(1)) if match is not None else None


def named_swap_pair(message: str) -> tuple[str | None, str | None]:
    """The (from, to) symbols the user actually named, normalised (USDC/USDG → STABLE)."""
    source, target = _swap_sides(message)
    return _first_swap_symbol(source), _first_swap_symbol(target)


def swap_pair_matches(message: str, proposed_action: dict[str, object]) -> bool:
    """True unless the card's pair contradicts the assets the user explicitly named.

    Safety net for a planner that yields a plausible-looking default card for a different pair:
    a chip that says USDG ↔ ETH must never be shown to someone who asked for another asset.
    Only the sides the user actually named are compared, so a pasted custom token (no symbol)
    and a one-sided request are not blocked.
    """
    named_in, named_out = named_swap_pair(message)
    token_in = proposed_action.get("tokenIn")
    token_out = proposed_action.get("tokenOut")
    in_symbol = token_in.get("symbol") if isinstance(token_in, dict) else None
    out_symbol = token_out.get("symbol") if isinstance(token_out, dict) else None
    if named_in is not None and _normalise_symbol(in_symbol) != named_in:
        return False
    if (
        named_out is not None
        and out_symbol is not None
        and _normalise_symbol(out_symbol) != named_out
    ):
        return False
    return True


def swap_pair_unavailable_answer(
    named_in: str | None, named_out: str | None, stable_symbol: str
) -> str:
    """Honest answer when the prepared swap pair does not match what the user asked for."""
    pair = (
        f"{named_in} → {named_out}"
        if named_in is not None and named_out is not None
        else "that pair"
    )
    return (
        f"I couldn't prepare a swap for {pair}. On this network the assistant only prepares "
        f"ETH ↔ {stable_symbol} swaps, so I won't show a card for a different pair. Open the "
        "**Swap** page to check the live pair, review the quote, and sign from your own wallet."
    )


def unsupported_swap_answer(label: str, stable_symbol: str) -> str:
    """The honest answer for a swap into an asset/chain the product does not support yet."""
    target = label if label != "that chain" else "that chain"
    return (
        f"Swaps into {target} aren't supported yet — that's a cross-chain swap, and the "
        "assistant only prepares same-network swaps today. NEAR Intents-based cross-chain swaps "
        "are planned for the November build.\n\n"
        f"What IS live today: swap between ETH and {stable_symbol} on the **Swap** page. You "
        "review the live quote and sign from your own wallet — I can't move your funds."
    )


# ─────────────────────────────────────────────────────────────────────────────
# D — unsafe transfer / prompt injection
# ─────────────────────────────────────────────────────────────────────────────

_ADDRESS_RE = re.compile(r"\b0x[0-9a-fA-F]{40}\b")
_TO_ADDRESS_RE = re.compile(
    r"\b(?:to|into|towards?)\s+(?:the\s+|a\s+)?0x[0-9a-fA-F]{40}\b", re.IGNORECASE
)
_FROM_ADDRESS_RE = re.compile(r"\bfrom\b[^.?!\n]{0,40}?0x[0-9a-fA-F]{40}\b", re.IGNORECASE)
_IGNORE_RE = re.compile(
    r"\b(?:ignore|disregard|forget|override|bypass|discard)\b[^.?!]{0,40}"
    r"\b(?:previous|prior|above|earlier|all)\b[^.?!]{0,25}"
    r"\b(?:instructions?|prompts?|rules?|directions?|guardrails?)\b",
    re.IGNORECASE,
)
_SEND_VERB_RE = re.compile(
    r"\b(?:send|sends|sending|transfer|transfers|transferring|wire|wires|pay|pays|"
    r"payment|move|moves|withdraw|withdraws)\b",
    re.IGNORECASE,
)
_VALUE_RE = re.compile(
    r"\b(?:funds?|money|everything|all|balance|usdc|usdg|stablecoins?|eth|btc|"
    r"crypto|assets?|savings?)\b",
    re.IGNORECASE,
)
_THIRD_PARTY_RE = re.compile(
    r"\b(?:third[- ]party|third[- ]parties|someone else|somebody else|another wallet|"
    r"external wallet|a stranger|to a friend|to an address)\b",
    re.IGNORECASE,
)

UNSAFE_REFUSAL = (
    "I can't do that. Sparky never moves funds, and it never sends anything to a third-party "
    "address. I only prepare deposit, withdraw or swap moves inside your own wallet for you to "
    "review and sign — I can't sign, and I won't take instructions that try to override my safety "
    "rules, whatever they claim to be.\n\n"
    "If you want to move funds, use the **Vault** or **Swap** page and sign from your own wallet."
)


def is_unsafe_request(message: str) -> bool:
    """True for prompt injection or a request to move funds to a third party.

    A vault address is not automatically a third party: withdrawing FROM a vault address to the
    user's own wallet is a normal vault action. An address is only treated as a destination when
    it is the object of "to"/"into"; an address with no "from" source either is still treated as
    a destination so "send 100 USDC 0x…" cannot slip through.
    """
    if _IGNORE_RE.search(message):
        return True
    if _SEND_VERB_RE.search(message) and _ADDRESS_RE.search(message):
        if _TO_ADDRESS_RE.search(message):
            return True
        if not _FROM_ADDRESS_RE.search(message):
            return True
    if (
        _SEND_VERB_RE.search(message)
        and _VALUE_RE.search(message)
        and _THIRD_PARTY_RE.search(message)
    ):
        return True
    return False


# ─────────────────────────────────────────────────────────────────────────────
# A — empty-wallet / no-mandate yield guidance
# ─────────────────────────────────────────────────────────────────────────────

_VAULT_SPECIFIC_RE = re.compile(r"\bvaults?\b", re.IGNORECASE)
_APY_DEFINITION_RE = re.compile(
    r"\bwhat(?:'s| is| are| does)\s+(?:an?\s+)?(?:apy|apr)\b|\bapy\s+mean|"
    r"\bhow\s+(?:do(?:es)?|is)\s+(?:an?\s+)?(?:apy|apr)\b|\bdifference between\b",
    re.IGNORECASE,
)
_YIELD_RE = re.compile(
    r"\b(?:earn|earning|yield|apy|apr|return|interest|invest|investing|grow|"
    r"put\s+(?:it\s+)?to\s+work)\b",
    re.IGNORECASE,
)
_MONEY_RE = re.compile(
    r"\b(?:usdc|usdg|stablecoins?|dollars?|money|deposit|aave)\b|"
    r"(?-i:\bNEAR\b)|\bnear\s+(?:protocol|chain|network|token)\b|"
    r"\brhea(?:\s+finance)?\b|"
    r"\$\s*\d|\b\d[\d,]*\s*(?:k|m)?\s*(?:usdc|usdg|dollars?)\b",
    re.IGNORECASE,
)
_COMPARE_AAVE_RE = re.compile(
    r"\bcompar(?:e|ed|ing|ison)\b[^.?!]{0,50}\baave\b|"
    r"\baave\b[^.?!]{0,50}\bcompar(?:e|ed|ing|ison)\b|"
    r"\bjust\s+(?:keep|keeping|leave|leaving|put|putting)\b[^.?!]{0,40}\baave\b",
    re.IGNORECASE,
)
_RISK_RE = re.compile(
    r"\b(?:moderate|balanced|conservative|growth|aggressive|risk|riskier)\b", re.IGNORECASE
)
#: 063 — comparison shapes ("X vs Y", "safer than", "compare … with …"). These are KNOWLEDGE
#: questions: the answer must compare risk/yield/protocol facts from grounding, never the
#: yield/mandate composer's canned copy and never an action. Kept deliberately broad on the
#: comparison VERB and narrow enough that an ordinary action command does not match; the DAG
#: additionally requires that the turn carries no financial action verb at all.
_COMPARATIVE_RE = re.compile(
    r"\b(?:vs\.?|versus)\b"
    r"|\bcompar(?:e|es|ed|ing|ison)\b"
    r"|\bsafer\s+than\b"
    r"|\b(?:more|less)\s+(?:safe|risky)\s+than\b"
    r"|\briskier\s+than\b"
    r"|\bwhich\s+(?:one\s+)?(?:is\s+)?(?:safer|better|riskier)\b",
    re.IGNORECASE,
)
#: A bare "better/worse than" is ordinary English ("move it wherever is better than Aave"), so
#: it only marks a knowledge comparison when the whole turn is shaped like a question.
_BETTER_WORSE_THAN_RE = re.compile(r"\b(?:better|worse)\s+than\b", re.IGNORECASE)
_COMPARATIVE_QUESTION_SHAPE_RE = re.compile(
    r"^\s*(?:is|are|which|what|how|where|compare|does|do|should)\b|\?\s*$", re.IGNORECASE
)
_OR_RE = re.compile(r"\bor\b", re.IGNORECASE)


def _venue_aliases() -> dict[str, str]:
    """Alias → canonical protocol/venue name, reusing the comparative subject table.

    The table covers the shipped corpus protocols; Rhea and Kamino are supported earn venues
    but are not knowledge subjects, so they are added here rather than to ``_KNOWN`` (which the
    074 facts table pins).
    """
    aliases: dict[str, str] = {}
    for subject in KNOWN_SUBJECTS:
        for alias in (*aliases_for(subject), subject.lower()):
            aliases[alias.lower()] = subject.lower()
    for alias in ("rhea", "rhea finance"):
        aliases[alias] = "rhea"
    aliases["kamino"] = "kamino"
    return aliases


_VENUE_ALIASES = _venue_aliases()
_VENUE_ALIAS_RE = re.compile(
    r"(?<![A-Za-z0-9])(?:"
    + "|".join(re.escape(alias) for alias in sorted(_VENUE_ALIASES, key=len, reverse=True))
    + r")(?![A-Za-z0-9])",
    re.IGNORECASE,
)


def _named_venues(message: str) -> tuple[str, ...]:
    seen: list[str] = []
    for match in _VENUE_ALIAS_RE.finditer(message):
        canonical = _VENUE_ALIASES[match.group(0).lower()]
        if canonical not in seen:
            seen.append(canonical)
    return tuple(seen)


def is_protocol_choice_question(message: str) -> bool:
    """True for an advisory "X or Y?" choice between two or more known protocols/venues.

    A choice question with no parsed amount is a KNOWLEDGE question even when it contains an
    action verb ("should I put my USDC in Rhea or Aave?"). A sized command keeps the planner.
    """
    if amount_from_text(message) is not None:
        return False
    if not _COMPARATIVE_QUESTION_SHAPE_RE.search(message):
        return False
    if not _OR_RE.search(message):
        return False
    return len(_named_venues(message)) >= 2


def is_comparative_question(message: str) -> bool:
    """True for an "X vs Y" / "safer than" / "compare …" / "X or Y?" knowledge question."""
    if _COMPARATIVE_RE.search(message):
        return True
    if _BETTER_WORSE_THAN_RE.search(message) and _COMPARATIVE_QUESTION_SHAPE_RE.search(message):
        return True
    return is_protocol_choice_question(message)


_FOLLOWUP_RE = re.compile(r"\b(?:half|quarter|twice|double)\b", re.IGNORECASE)


def is_yield_guidance_question(message: str) -> bool:
    """True for an empty-state yield/estimate/comparison question the composer owns.

    Deliberately narrow: a vault-specific question stays on the curated route, a definition
    question stays on the literacy route, and a funded command stays on the build path.
    """
    if _VAULT_SPECIFIC_RE.search(message):
        return False
    if _APY_DEFINITION_RE.search(message):
        return False
    # 063 — a comparison is a knowledge question, not a yield/mandate estimate. Route it to the
    # grounded prose branch; the yield composer's "nothing for a mandate to apply to" is not an
    # answer to "Is Morpho safer than Aave?".
    if is_comparative_question(message):
        return False
    if is_explicit_financial_command(message):
        return False
    if _COMPARE_AAVE_RE.search(message):
        return True
    if _YIELD_RE.search(message) and (
        _MONEY_RE.search(message) or duration_months(message) is not None
    ):
        return True
    if _RISK_RE.search(message) and amount_from_text(message) is not None:
        return True
    if _FOLLOWUP_RE.search(message) and re.search(
        r"\b(?:put|deposit|invest|use|only|what if)\b", message, re.IGNORECASE
    ):
        return True
    return False


def _fmt_bps(bps: int | None) -> str:
    if bps is None:
        return "not available right now"
    whole, frac = divmod(max(0, int(bps)), 100)
    return f"{whole}.{frac:02d}%" if frac else f"{whole}%"


def _curated_vaults(curated: CuratedContext | None) -> tuple[CuratedPick, ...]:
    if curated is None:
        return ()
    if curated.vaults:
        return curated.vaults
    return (curated.pick,) if curated.pick is not None else ()


def _options_block(curated: CuratedContext | None) -> str:
    vaults = _curated_vaults(curated)
    if not vaults:
        return (
            "There are no curated vaults on this network yet — I won't invent one. The **Vault** "
            "page (/vault) fills in when the daily scan finds something real."
        )
    lines = ["Curated options on this network right now (the same board `/vault` shows):"]
    for vault in vaults[:3]:
        as_of = as_of_suffix(vault.as_of)
        lines.append(f"- **{vault.label}** — {_fmt_bps(vault.net_apy_bps)} net APY{as_of}")
    caveats = [
        staleness_caveat(vault.as_of, subject=f"{vault.label}'s figure") for vault in vaults[:3]
    ]
    unique = [c for i, c in enumerate(caveats) if c and c not in caveats[:i]]
    if unique:
        lines += ["", *unique]
    return "\n".join(lines)


def _estimate_apy(
    curated: CuratedContext | None, projected: int | None, gross: int | None
) -> int | None:
    vaults = _curated_vaults(curated)
    for vault in vaults:
        if vault.net_apy_bps is not None:
            return vault.net_apy_bps
    return projected if projected is not None else gross


def _estimate_block(amount: int, months: int, apy_bps: int, as_of: str | None) -> str:
    earned = amount * apy_bps * months // (10_000 * 12)
    stamp = as_of_suffix(as_of, style="space")
    caveat = staleness_caveat(as_of, subject="This rate")
    caveat_line = f" {caveat}" if caveat else ""
    period = "1 year" if months == 12 else f"{months} months"
    return (
        f"At the current variable rate of **{_fmt_bps(apy_bps)}**{stamp}, "
        f"{format_usd(amount)} would earn roughly **{format_usd(earned)}** over {period}, before "
        "any fees. That's an illustrative estimate at today's rate, not a promise — the rate "
        f"moves with the market.{caveat_line}"
    )


def _comparison_block(
    curated: CuratedContext | None,
    gross_bps: int | None,
    projected_bps: int | None,
    fee_bps: int | None,
) -> str:
    pick = curated.pick if curated is not None else None
    net_bps = pick.net_apy_bps if pick is not None else projected_bps
    label = pick.label if pick is not None else "the SparkPoint vault"
    as_of = as_of_suffix(pick.as_of) if pick is not None else ""
    if net_bps is None and gross_bps is None:
        return (
            "I don't have a live curated rate or Aave rate to compare right now, so I won't "
            "invent either. The **Vault** page (/vault) shows the board's own figures."
        )
    parts: list[str] = ["Here's the honest comparison."]
    if net_bps is not None:
        parts.append(f"**{label}** shows **{_fmt_bps(net_bps)} net APY**{as_of}.")
    if gross_bps is not None:
        fee_note = (
            f" The vault's net figure already reflects its {_fmt_bps(fee_bps)} performance fee."
            if fee_bps and net_bps is not None
            else ""
        )
        parts.append(
            f"Keeping USDC in Aave directly earns the underlying lending rate — currently about "
            f"**{_fmt_bps(gross_bps)} gross** — with no SparkPoint performance fee.{fee_note}"
        )
    parts.append(
        "Either way it's the same Aave lending market and the same smart-contract and "
        "variable-rate risk; the difference is the wrapper, its fee, and who manages the position."
    )
    if pick is not None:
        caveat = staleness_caveat(pick.as_of, subject=f"{pick.label}'s figure")
        if caveat:
            parts.append(caveat)
    return " ".join(parts)


def withdraw_all_amount(positions: Sequence[object]) -> int | None:
    """The full SparkPoint-vault position in 6-dp base units, or ``None`` when there is none."""
    for position in positions:
        venue = str(getattr(position, "venue", "")).lower()
        if "sparkpoint" not in venue or "vault" not in venue:
            continue
        value = str(getattr(position, "value_usd", "")).replace(",", "")
        try:
            units = int((Decimal(value) * 1_000_000).to_integral_value(rounding=ROUND_HALF_UP))
        except (ArithmeticError, ValueError):
            continue
        if units > 0:
            return units
    return None


# 071 — native NEAR-token staking is not Rhea USDC lending; say so and point at what works.
NEAR_NATIVE_STAKING_ANSWER = (
    "NEAR-token staking isn't supported here. The supported NEAR yield is Rhea Lending — "
    "USDC only for now. Tell me an amount (for example 100 USDC) and I'll show a dry deposit "
    "preview; nothing is signed or sent."
)

NOTHING_TO_WITHDRAW = (
    "You don't have a position in the SparkPoint vault, so there's nothing to withdraw right now. "
    "If you deposit first, you can withdraw at any time — there's no lock-up, and you sign the "
    "withdrawal yourself."
)

NOTHING_TO_WITHDRAW_NO_VAULT = (
    "There's no SparkPoint vault on this network yet, so there's nothing deposited here to "
    "withdraw — your funds stay in your own wallet the whole time, and only you can move them."
)


def yield_guidance_answer(
    *,
    message: str,
    history: Sequence[tuple[str, str]] | None,
    offers_vault: bool,
    curated: CuratedContext | None,
    has_positions: bool,
    idle_usdc: int | None,
    mandate_risk: str | None,
    projected_apy_bps: int | None,
    gross_apy_bps: int | None,
    performance_fee_bps: int | None,
    per_user_cap_base: int | None,
) -> str:
    """Compose the empty-wallet / no-mandate yield answer from injected data only."""
    amount = amount_from_text(message)
    if amount is None:
        previous = previous_amount(history)
        if previous is not None:
            amount = _scaled_followup(message, previous)
    months = duration_months(message)
    if months is None and amount is not None:
        months = _previous_duration(history)

    sections: list[str] = []
    if not has_positions:
        sections.append(
            "You don't have a position yet, so there's nothing for a mandate to apply to. "
            "Here's what's actually available."
        )
    sections.append(_options_block(curated))

    apy = _estimate_apy(curated, projected_apy_bps, gross_apy_bps)
    as_of = curated.pick.as_of if curated is not None and curated.pick is not None else None
    if amount is not None and months is not None and apy is not None:
        sections.append(_estimate_block(amount, months, apy, as_of))
    elif amount is not None and apy is not None:
        stamp = as_of_suffix(as_of, style="space")
        caveat = staleness_caveat(as_of, subject="This rate")
        sections.append(
            f"At today's variable rate of about **{_fmt_bps(apy)}**{stamp}, {format_usd(amount)} "
            "would earn that rate over a year before fees — an estimate, not a promise. Tell me a "
            "duration (for example 6 months) and I'll work out the figure."
            + (f" {caveat}" if caveat else "")
        )
    elif amount is None and is_yield_guidance_question(message):
        sections.append(
            'If you tell me an amount and a duration (for example "2,000 USDC for 6 months"), '
            "I'll give you an illustrative estimate at the current rate."
        )

    if _COMPARE_AAVE_RE.search(message):
        sections.append(
            _comparison_block(curated, gross_apy_bps, projected_apy_bps, performance_fee_bps)
        )

    if _NEAR_RE.search(message):
        sections.append(
            "Rhea Lending is the supported NEAR yield — USDC only for now. Tell me an amount "
            "(for example 100 USDC) and I'll show a dry deposit preview; you withdraw on "
            "app.rhea.finance with the same wallet."
        )

    if amount is not None and per_user_cap_base is not None and amount > per_user_cap_base:
        cap = format_usd(per_user_cap_base)
        sections.append(
            f"One thing to know: a single deposit above {cap} exceeds the current per-user cap, "
            f"so I can only prepare up to {cap} in one move."
        )

    if mandate_risk is None:
        sections.append(
            "You haven't set a mandate yet. It's optional, but it lets me keep every suggestion "
            "inside limits you choose."
        )
    else:
        sections.append(
            f"Your mandate is set to {mandate_risk}; I'll only suggest moves that fit inside it."
        )

    if offers_vault:
        if idle_usdc is not None and idle_usdc == 0:
            sections.append(
                "To get started, fund your wallet with the stablecoin first — right now it has no "
                "balance to deposit. Then open the **Vault** page (/vault) to deposit; you review "
                "and sign each move."
            )
        else:
            sections.append(
                "To get started, open the **Vault** page (/vault) to deposit — you review and sign "
                "each move."
            )
    else:
        sections.append(
            "The SparkPoint vault isn't live on this network yet. You can still swap on the "
            "**Swap** page — you review the quote and sign from your own wallet — and the vault "
            "will open here later."
        )
    return "\n\n".join(sections)
