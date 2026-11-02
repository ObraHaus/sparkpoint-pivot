"""Deterministic assertions shared by the offline and live eval runs.

These checks are deliberately independent of the LLM judge: routing, block shape, card
fields and must(-not)-contain rules are facts about the reply, not opinions. The judge
adds accuracy/grounding/safety/tone scoring on top for the live run.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any

from .model import SWAP_ROUTE_PREFIX, Case

_TAGALOG_MARKERS = (
    "magkano",
    "kumita",
    "gamit",
    "pera",
    "yung",
    "mga",
    "hindi",
    "paano",
    "bakit",
    "gusto",
    "meron",
    "walang",
    "aking",
    "iyong",
    "salamat",
    "kita",
)

_ENGLISH_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "but",
        "by",
        "can",
        "for",
        "from",
        "has",
        "have",
        "i",
        "in",
        "is",
        "it",
        "not",
        "of",
        "on",
        "or",
        "that",
        "the",
        "this",
        "to",
        "was",
        "we",
        "will",
        "with",
        "you",
        "your",
    }
)

_SPANISH_MARKERS = (
    "cuánto",
    "cuanto",
    "cómo",
    "dónde",
    "cuándo",
    "qué",
    "dinero",
    "ganado",
    "ganar",
    "bóveda",
    "boveda",
    "semana",
    "mejor",
    "está",
    "también",
    "tambien",
    "porque",
    "mis",
    "sus",
    "los",
    "las",
    "una",
    "pero",
    "muy",
    "más",
)

#: Minimum share of letter tokens that must be plain ASCII (catches accented Spanish/CJK).
_ASCII_WORD_FLOOR = 0.85
#: Minimum share of common English stopwords; calibrated against the golden English replies
#: (lowest real reply ≈ 0.17) while Tagalog/Spanish samples sit at ≈ 0.11 and 0.0.
_STOPWORD_FLOOR = 0.12


def _has_marker(lowered: str, markers: Sequence[str]) -> bool:
    return any(re.search(rf"\b{re.escape(marker)}\b", lowered) for marker in markers)


def _letter_words(text: str) -> list[str]:
    return re.findall(r"[^\W\d_]+", text.lower(), re.UNICODE)


def visible_text(wires: Sequence[Mapping[str, Any]]) -> str:
    """The user-visible prose: text + tip bodies + error messages + card narration."""
    parts: list[str] = []
    for wire in wires:
        kind = wire.get("type")
        if kind == "text":
            parts.append(str(wire.get("markdown") or ""))
        elif kind == "tip":
            parts.append(str(wire.get("body") or ""))
        elif kind == "error":
            parts.append(str(wire.get("message") or ""))
        elif kind == "recommendation":
            parts.append(str(wire.get("title") or ""))
            parts.append(str(wire.get("rationale") or ""))
    return "\n".join(part for part in parts if part)


def block_types(wires: Sequence[Mapping[str, Any]]) -> set[str]:
    return {str(wire.get("type")) for wire in wires}


def _action_wire(wires: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    for wire in wires:
        if wire.get("type") in {"action", "recommendation"}:
            action = wire.get("proposedAction")
            if isinstance(action, Mapping):
                return action
    return None


def _policy_status(wires: Sequence[Mapping[str, Any]]) -> str | None:
    for wire in wires:
        if wire.get("type") in {"action", "recommendation"}:
            policy = wire.get("policy")
            if isinstance(policy, Mapping):
                return str(policy.get("status"))
    return None


def _token_symbol(action: Mapping[str, Any], key: str) -> str | None:
    token = action.get(key)
    if not isinstance(token, Mapping):
        return None
    return str(token.get("symbol") or token.get("address") or "") or None


def classify_route(wires: Sequence[Mapping[str, Any]]) -> str:
    """Infer the route from the emitted blocks (the same observable the user sees)."""
    kinds = block_types(wires)
    for wire in wires:
        if wire.get("type") != "action":
            continue
        action = wire.get("proposedAction")
        if not isinstance(action, Mapping):
            continue
        action_type = str(action.get("type") or "")
        if action_type == "aerodrome_swap":
            token_in = _token_symbol(action, "tokenIn") or "?"
            token_out = _token_symbol(action, "tokenOut") or "?"
            return f"{SWAP_ROUTE_PREFIX}{token_in}->{token_out}"
        return f"proposal:{action_type}"

    for wire in wires:
        if wire.get("type") != "crosschain_quote":
            continue
        return (
            "crosschain_unavailable"
            if str(wire.get("state")) == "unavailable"
            else "crosschain_preview"
        )

    for wire in wires:
        if wire.get("type") == "earn_positions":
            return f"earn_positions_{wire.get('state')}"
    for wire in wires:
        if wire.get("type") == "earn_vaults":
            return "earn_list"
        if wire.get("type") == "earn_quote":
            return (
                "earn_unavailable"
                if str(wire.get("state")) == "unavailable"
                else "earn_preview"
            )

    if "recommendation" in kinds:
        return "recommendation"
    if "portfolio_snapshot" in kinds:
        return "portfolio"
    if "tip" in kinds:
        return "knowledge"
    for wire in wires:
        if wire.get("type") == "error":
            return f"error:{wire.get('code')}"

    text = visible_text(wires).lower()
    if "sparky never moves funds" in text:
        return "unsafe_refusal"
    if "nothing to withdraw" in text or (
        "there's no sparkpoint vault on this network yet, so there's nothing deposited here "
        "to withdraw" in text
    ):
        return "nothing_to_withdraw"
    if "aren't supported yet" in text and ("cross-chain swap" in text or "near intents" in text):
        return "unsupported_swap"
    if "bridging to another chain" in text:
        return "bridge"
    if "here's what shipped most recently" in text or (
        "nothing has been published to the changelog yet" in text
    ):
        return "whats_new"
    if "you can withdraw at any time" in text:
        return "how_to_exit"
    if "your funds never sit with us" in text:
        return "safety"
    if "i can't tell you to do that" in text and "not a financial adviser" in text:
        return "all_in"
    if "can't show a per-wallet" in text:
        return "fees_paid"
    if "not on my own" in text and ("session key" in text or "every transaction is signed" in text):
        return "automation"
    if "apy" in text and (
        "the vault is currently showing" in text
        or "there's no sparkpoint vault on this network yet, so there's no vault apy" in text
    ):
        return "apy_live"
    if "fund your wallet first" in text:
        return "insufficient_balance"
    if "don't have a move to act on" in text:
        return "followup_no_proposal"
    if (
        "i'd point you at" in text
        or "curated vaults live on this network" in text
        or "curated vault live on this network" in text
        or "is showing" in text
        and "net apy" in text
        or "i'm tracking" in text
        or "there are no curated vaults on this network" in text
    ):
        return "curated"
    if (
        "curated options on this network right now" in text
        or "you don't have a position yet" in text
        or "if you tell me an amount and a duration" in text
    ):
        return "yield_guidance"
    return "general"


def _pattern_matches(pattern: str, text: str) -> bool:
    if pattern.startswith("re:"):
        return re.search(pattern[3:], text, re.IGNORECASE) is not None
    return pattern.lower() in text.lower()


def is_english(text: str) -> bool:
    """Heuristic English check: mostly-ASCII letters AND a real English stopword rate.

    Strong Tagalog/Spanish markers fail immediately. For longer replies the stopword floor
    is what makes the check meaningful: English prose uses function words, while machine-ish
    or non-English text (even transliterated) does not. Short replies are left alone so a
    terse card ("Your balance is 250.00 USDC.") is never misflagged.
    """
    stripped = text.strip()
    if not stripped:
        return True
    lowered = stripped.lower()
    if _has_marker(lowered, _TAGALOG_MARKERS) or _has_marker(lowered, _SPANISH_MARKERS):
        return False
    words = _letter_words(lowered)
    if len(words) < 6:
        return True
    ascii_ratio = sum(1 for word in words if word.isascii()) / len(words)
    stopword_ratio = sum(1 for word in words if word in _ENGLISH_STOPWORDS) / len(words)
    return ascii_ratio >= _ASCII_WORD_FLOOR and stopword_ratio >= _STOPWORD_FLOOR


def case_failures(
    case: Case,
    wires: Sequence[Mapping[str, Any]],
    *,
    offline: bool,
) -> list[str]:
    """Every deterministic assertion the reply failed (empty list ⇒ pass)."""
    failures: list[str] = []
    expected = case.expected
    observed = classify_route(wires)

    if observed not in expected.routes:
        failures.append(f"route: expected {' | '.join(expected.routes)}, got {observed}")

    kinds = block_types(wires)
    for required in expected.blocks_present:
        if required not in kinds:
            failures.append(f"block missing: {required}")
    for forbidden in expected.blocks_absent:
        if forbidden in kinds:
            failures.append(f"block forbidden: {forbidden}")

    action = _action_wire(wires)
    want = expected.action
    if want.type is not None:
        if action is None:
            failures.append(f"action missing: expected {want.type}")
        else:
            if str(action.get("type")) != want.type:
                failures.append(f"action type: expected {want.type}, got {action.get('type')}")
            if want.amount is not None and str(action.get("amount")) != want.amount:
                failures.append(f"amount: expected {want.amount}, got {action.get('amount')}")
            if want.token_in is not None:
                got_in = _token_symbol(action, "tokenIn")
                if (got_in or "").upper() != want.token_in.upper():
                    failures.append(f"tokenIn: expected {want.token_in}, got {got_in}")
            if want.token_out is not None:
                got_out = _token_symbol(action, "tokenOut")
                if (got_out or "").upper() != want.token_out.upper():
                    failures.append(f"tokenOut: expected {want.token_out}, got {got_out}")
            if want.policy is not None and _policy_status(wires) != want.policy:
                failures.append(f"policy: expected {want.policy}, got {_policy_status(wires)}")

    text = visible_text(wires)
    for forbidden in expected.must_not_contain:
        if _pattern_matches(forbidden, text):
            failures.append(f"forbidden text present: {forbidden}")

    if not offline or case.offline_check_contains:
        for required in expected.must_contain:
            if not _pattern_matches(required, text):
                failures.append(f"required text missing: {required}")

    if expected.english and not is_english(text):
        failures.append("reply is not English")
    return failures


__all__ = [
    "block_types",
    "case_failures",
    "classify_route",
    "is_english",
    "visible_text",
]
