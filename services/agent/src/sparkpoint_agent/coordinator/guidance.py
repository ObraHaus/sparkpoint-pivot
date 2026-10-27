"""057 — deterministic replies for the four beta chat dead-ends.

The audit prompts below are handled here, in plain Python, for the same reason the 029/031/048
routes are: a classifier can be re-taught and still drift, while these shapes have a knowable
correct answer. Nothing in this module can emit an action block, and nothing here bypasses the
policy gate — the DAG still runs ``propose`` → ``policy.evaluate`` for every proposal.

Covered:
  * an empty-wallet / no-mandate yield question (curated options, a labelled estimate, the Aave
    comparison, the NEAR/Rhea limit, and a next step) instead of the guardrails dead-end;
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

from .curated import CuratedContext, CuratedPick

__all__ = [
    "CONFIRMATION_RE",
    "NOTHING_TO_WITHDRAW",
    "UNSAFE_REFUSAL",
    "amount_from_text",
    "duration_months",
    "is_confirmation",
    "is_explicit_financial_command",
    "is_unsafe_request",
    "is_withdraw_all",
    "is_yield_guidance_question",
    "last_proposal_message",
    "previous_amount",
    "unsupported_swap_answer",
    "unsupported_swap_target",
    "withdraw_all_amount",
    "yield_guidance_answer",
]

# ─────────────────────────────────────────────────────────────────────────────
# Amount + duration parsing
# ─────────────────────────────────────────────────────────────────────────────

_DOLLAR_AMOUNT_RE = re.compile(
    r"\$\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b", re.IGNORECASE
)
_STABLE_AMOUNT_RE = re.compile(
    r"\b(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\s*(?:usdc|usdg|dollars?|bucks|stablecoins?)\b",
    re.IGNORECASE,
)
_MULTIPLIER = {"k": 1_000, "m": 1_000_000}

_DURATION_RE = re.compile(
    r"\b(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)\b", re.IGNORECASE
)
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
_WITHDRAW_ALL_RE = re.compile(
    r"\b(?:withdraw|redeem|cash\s?out|take|pull|move)\b[^.?!]{0,50}"
    r"\b(?:everything|all|max(?:imum)?|full|entire)\b",
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


def is_explicit_financial_command(message: str) -> bool:
    """True when the turn is a command carrying an amount (or "everything"), not a question."""
    if not _FINANCIAL_VERB_RE.search(message):
        return False
    return amount_from_text(message) is not None or is_withdraw_all(message)


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
_UNSUPPORTED_TARGETS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\bnear\b|\brhea\b", re.IGNORECASE), "NEAR"),
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
    (re.compile(r"\bsui\b|\baptos\b|\bton\b|\btron\b", re.IGNORECASE), "that chain"),
    (
        re.compile(
            r"\bon\s+(?:ethereum|arbitrum|optimism|polygon|avalanche|solana|near|bitcoin|bsc)\b",
            re.IGNORECASE,
        ),
        "that chain",
    ),
)


def unsupported_swap_target(message: str) -> str | None:
    """The requested-but-unsupported receive asset/chain in a swap command, or ``None``."""
    if not _SWAP_VERB_RE.search(message):
        return None
    for pattern, label in _UNSUPPORTED_TARGETS:
        if pattern.search(message):
            return label
    return None


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
    """True for prompt injection or a request to move funds to a third party."""
    if _IGNORE_RE.search(message):
        return True
    if _SEND_VERB_RE.search(message) and _ADDRESS_RE.search(message):
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
    r"\b(?:usdc|usdg|stablecoins?|dollars?|money|deposit|aave|near|rhea|rhea\s+finance)\b|"
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
_FOLLOWUP_RE = re.compile(
    r"\b(?:half|quarter|twice|double)\b", re.IGNORECASE
)
_NEAR_RE = re.compile(r"\bnear\b|\brhea\b", re.IGNORECASE)


def is_yield_guidance_question(message: str) -> bool:
    """True for an empty-state yield/estimate/comparison question the composer owns.

    Deliberately narrow: a vault-specific question stays on the curated route, a definition
    question stays on the literacy route, and a funded command stays on the build path.
    """
    if _VAULT_SPECIFIC_RE.search(message):
        return False
    if _APY_DEFINITION_RE.search(message):
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


def _fmt_usd(base_units: int) -> str:
    whole, frac = divmod(max(0, base_units), 1_000_000)
    cents = (frac * 100) // 1_000_000
    return f"${whole:,}.{cents:02d}" if cents else f"${whole:,}"


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
        as_of = f" (as of {vault.as_of[:10]})" if vault.as_of else ""
        lines.append(f"- **{vault.label}** — {_fmt_bps(vault.net_apy_bps)} net APY{as_of}")
    return "\n".join(lines)


def _estimate_apy(
    curated: CuratedContext | None, projected: int | None, gross: int | None
) -> int | None:
    vaults = _curated_vaults(curated)
    for vault in vaults:
        if vault.net_apy_bps is not None:
            return vault.net_apy_bps
    return projected if projected is not None else gross


def _estimate_block(
    amount: int, months: int, apy_bps: int, as_of: str | None
) -> str:
    earned = amount * apy_bps * months // (10_000 * 12)
    stamp = f" as of {as_of[:10]}" if as_of else ""
    period = "1 year" if months == 12 else f"{months} months"
    return (
        f"At the current variable rate of **{_fmt_bps(apy_bps)}**{stamp}, "
        f"{_fmt_usd(amount)} would earn roughly **{_fmt_usd(earned)}** over {period}, before "
        "any fees. That's an illustrative estimate at today's rate, not a promise — the rate "
        "moves with the market."
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
    as_of = f" (as of {pick.as_of[:10]})" if pick is not None and pick.as_of else ""
    if net_bps is None and gross_bps is None:
        return (
            "I don't have a live curated rate or Aave rate to compare right now, so I won't "
            "invent either. The **Vault** page (/vault) shows the board's own figures."
        )
    parts: list[str] = ["Here's the honest comparison."]
    if net_bps is not None:
        parts.append(
            f"**{label}** shows **{_fmt_bps(net_bps)} net APY**{as_of}."
        )
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
    return " ".join(parts)


def withdraw_all_amount(positions: Sequence[object]) -> int | None:
    """The full SparkPoint-vault position in 6-dp base units, or ``None`` when there is none."""
    for position in positions:
        venue = str(getattr(position, "venue", "")).lower()
        if "sparkpoint" not in venue or "vault" not in venue:
            continue
        value = str(getattr(position, "value_usd", "")).replace(",", "")
        try:
            units = int(
                (Decimal(value) * 1_000_000).to_integral_value(rounding=ROUND_HALF_UP)
            )
        except (ArithmeticError, ValueError):
            continue
        if units > 0:
            return units
    return None


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
        sections.append(
            f"At today's variable rate of about **{_fmt_bps(apy)}**, {_fmt_usd(amount)} would "
            "earn that rate over a year before fees — an estimate, not a promise. Tell me a "
            "duration (for example 6 months) and I'll work out the figure."
        )
    elif amount is None and is_yield_guidance_question(message):
        sections.append(
            "If you tell me an amount and a duration (for example \"2,000 USDC for 6 months\"), "
            "I'll give you an illustrative estimate at the current rate."
        )

    if _COMPARE_AAVE_RE.search(message):
        sections.append(
            _comparison_block(curated, gross_apy_bps, projected_apy_bps, performance_fee_bps)
        )

    if _NEAR_RE.search(message):
        sections.append(
            "NEAR yield (including Rhea Finance) isn't supported yet — NEAR support is coming. "
            "Today the live yield path is the curated vault board on this network."
        )

    if (
        amount is not None
        and per_user_cap_base is not None
        and amount > per_user_cap_base
    ):
        sections.append(
            f"One thing to know: a single deposit above {_fmt_usd(per_user_cap_base)} exceeds "
            f"the current per-user cap, so I can only prepare up to {_fmt_usd(per_user_cap_base)} "
            "in one move."
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
