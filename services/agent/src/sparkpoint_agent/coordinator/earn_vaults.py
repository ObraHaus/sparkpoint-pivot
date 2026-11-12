"""Live earn-vault answers across every chain (the same snapshot the /vault page renders).

The 048 curated record is per-connected-chain. When that store is empty but the live earn
registry has vaults (Kamino/Solana, Rhea/NEAR, Morpho/Base), a "best vault / what's paying /
which vaults are live" question must answer from the registry instead of claiming there are no
vaults. Everything here is deterministic and read-only: it composes text from injected rows and
never invents a vault or a number. No action block is possible — the caller emits text plus the
non-signable ``earn_vaults`` card.
"""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC
from decimal import Decimal, InvalidOperation
from typing import Any

from ..earn.config import EarnConfig
from ..earn.registry import EarnSnapshot
from .chat_blocks import EarnVaultsBlock

__all__ = [
    "EARN_BEST_YIELD_RE",
    "EarnVaultFilters",
    "apy_bps",
    "detect_earn_filters",
    "earn_option_lines",
    "earn_vaults_answer",
    "earn_vaults_block",
]

_PROTOCOL_LABELS = {"morpho": "Morpho", "kamino": "Kamino", "rhea": "Rhea"}
#: "best/highest/top … yield/APY/rate" without the word "vault" (e.g. "highest yield on Solana").
EARN_BEST_YIELD_RE = re.compile(
    r"\b(?:best|highest|top|most)\b[^.?!]{0,24}"
    r"\b(?:yield|yielding|apy|apr|rate|paying|return)\b",
    re.IGNORECASE,
)
#: Extra chain spellings beyond the config keys/labels.
_CHAIN_ALIASES = {
    "ethereum": "eth",
    "ethereum mainnet": "eth",
    "solana": "sol",
    "base mainnet": "base",
}
#: NEAR is an ordinary English word, so only the uppercase chain name or a chain preposition
#: counts (mirrors ``earn.parse`` / ``coordinator.guidance``).
_NEAR_CHAIN_RE = re.compile(
    r"\bNEAR\b"
    r"|(?i:\bnear\s+(?:protocol|chain|network|token)\b)"
    r"|(?i:\b(?:on|in|into|for|from)\s+near\b(?!\s*-))"
)
_PROTOCOL_RE = re.compile(r"\b(?:rhea|burrow|kamino|morpho)\b", re.IGNORECASE)
_ASSET_RE = re.compile(r"\b(USDC|USDT|WETH|ETH|cbBTC|SOL)\b", re.IGNORECASE)


@dataclass(frozen=True, slots=True)
class EarnVaultFilters:
    """The chain/protocol/asset a turn names, if any (all config keys / symbols)."""

    chain: str | None = None
    protocol: str | None = None
    asset: str | None = None

    @property
    def any(self) -> bool:
        return self.chain is not None or self.protocol is not None or self.asset is not None


def _chain_names(config: EarnConfig) -> list[tuple[str, str]]:
    names: dict[str, str] = {}
    for key, chain in config.chains.items():
        names[chain.label.lower()] = key
        names[key.lower()] = key
    for alias, key in _CHAIN_ALIASES.items():
        names.setdefault(alias, key)
    # Longest first so "ethereum mainnet" wins over "ethereum".
    return sorted(names.items(), key=lambda item: len(item[0]), reverse=True)


def _named_chain(text: str, config: EarnConfig) -> str | None:
    for name, key in _chain_names(config):
        if key == "near":
            if _NEAR_CHAIN_RE.search(text) is not None:
                return key
            continue
        if re.search(rf"\b{re.escape(name)}\b", text, re.IGNORECASE) is not None:
            return key
    return None


def _named_protocol(text: str) -> str | None:
    match = _PROTOCOL_RE.search(text)
    if match is None:
        return None
    value = match.group(0).lower()
    return "rhea" if value in {"rhea", "burrow"} else value


def _named_asset(text: str) -> str | None:
    match = _ASSET_RE.search(text)
    if match is None:
        return None
    symbol = match.group(1).upper()
    return "WETH" if symbol == "ETH" else symbol


def detect_earn_filters(message: str, config: EarnConfig) -> EarnVaultFilters:
    """Read the chain/protocol/asset a vault question names, using config keys and labels."""
    return EarnVaultFilters(
        chain=_named_chain(message, config),
        protocol=_named_protocol(message),
        asset=_named_asset(message),
    )


def _protocol_label(row: Mapping[str, Any]) -> str:
    protocol = str(row.get("protocol") or "morpho").lower()
    return _PROTOCOL_LABELS.get(protocol, protocol.title())


def _chain_label(config: EarnConfig, row: Mapping[str, Any]) -> str:
    key = str(row.get("chain") or "")
    chain = config.chain(key)
    return chain.label if chain is not None else key.title()


def _asset_symbol(row: Mapping[str, Any]) -> str:
    asset = row.get("asset")
    if isinstance(asset, Mapping):
        return str(asset.get("symbol") or "")
    return ""


def _name(row: Mapping[str, Any]) -> str:
    return str(row.get("name") or row.get("symbol") or row.get("address") or "Unnamed vault")


def _apy_text(row: Mapping[str, Any]) -> str:
    apy = row.get("netApy")
    return f"{apy}% net APY" if apy not in (None, "") else "APY unavailable"


def apy_bps(row: Mapping[str, Any]) -> int | None:
    """The wire percent (``"6.01"``) as integer basis points, or ``None`` when unavailable."""
    apy = row.get("netApy")
    if apy in (None, ""):
        return None
    try:
        return int((Decimal(str(apy)) * 100).to_integral_value())
    except (InvalidOperation, ValueError):
        return None


def _fmt_usd(raw: Any) -> str:
    if raw in (None, ""):
        return "TVL unavailable"
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        return "TVL unavailable"
    if not value.is_finite() or value < 0:
        return "TVL unavailable"
    number = float(value)
    if number >= 1_000_000_000:
        return f"${number / 1_000_000_000:.1f}B TVL"
    if number >= 1_000_000:
        return f"${number / 1_000_000:.1f}M TVL"
    if number >= 1_000:
        return f"${number / 1_000:.0f}k TVL"
    return f"${number:,.0f} TVL"


def _as_of(snapshot: EarnSnapshot) -> str:
    moment = snapshot.fetched_at
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC).strftime("%Y-%m-%d %H:%M UTC")


def _row_line(config: EarnConfig, row: Mapping[str, Any]) -> str:
    return (
        f"**{_name(row)}** — {_protocol_label(row)} · {_chain_label(config, row)} · "
        f"{_asset_symbol(row)} · {_apy_text(row)} · {_fmt_usd(row.get('tvlUsd'))}"
    )


def _filter_description(config: EarnConfig, filters: EarnVaultFilters) -> str:
    qualifiers = []
    if filters.protocol is not None:
        qualifiers.append(_PROTOCOL_LABELS.get(filters.protocol, filters.protocol.title()))
    if filters.asset is not None:
        qualifiers.append(filters.asset)
    phrase = " ".join(qualifiers)
    phrase = f"{phrase} vault" if phrase else "vault"
    if filters.chain is not None:
        chain = config.chain(filters.chain)
        phrase += f" on {chain.label if chain is not None else filters.chain.title()}"
    return phrase


def earn_option_lines(
    config: EarnConfig, rows: Sequence[Mapping[str, Any]], *, limit: int = 3
) -> list[str]:
    """Short bullet bodies for the 057/A yield-guidance options block."""
    return [_row_line(config, row) for row in rows[:limit]]


def earn_vaults_block(
    *,
    rows: Sequence[Mapping[str, Any]],
    snapshot: EarnSnapshot,
    source: str | None,
    note: str | None = None,
) -> EarnVaultsBlock:
    """The non-signable ``earn_vaults`` card carrying the same rows the text names."""
    return EarnVaultsBlock(
        state="ready",
        vaults=tuple(dict(row) for row in rows),
        snapshot_age_minutes=snapshot.age_minutes(),
        snapshot_source=source,
        note=note,
    )


def _unavailable_text() -> str:
    return (
        "I don't have a live vault list right now — I won't invent one. The **Vault** page "
        "(/vault) shows the current board as soon as the snapshot is available. I suggest; you "
        "choose and sign."
    )


def earn_vaults_answer(
    *,
    config: EarnConfig,
    rows: Sequence[Mapping[str, Any]],
    snapshot: EarnSnapshot,
    kind: str,
    filters: EarnVaultFilters,
    all_rows: Sequence[Mapping[str, Any]] | None = None,
) -> str:
    """Compose the deterministic live-vault answer from registry rows.

    ``kind`` is ``"best"`` (highest yield), ``"rate"`` (what is it paying) or ``"list"``. A
    chain/protocol/asset filter that matches nothing is stated honestly and followed by the
    all-chain list; an entry without an APY renders "APY unavailable" and ranks last.
    """
    as_of = _as_of(snapshot)
    scope = "across every chain" if not filters.any else "matching your filter"
    filtered_empty = not rows and filters.any
    if filtered_empty:
        fallback = list(all_rows or ())
        if not fallback:
            return _unavailable_text()
        lines = [
            f"I don't see a {_filter_description(config, filters)} in the live snapshot right "
            "now — I won't invent one. Here are the vaults I do have across every chain:",
            "",
            *[f"- {_row_line(config, row)}" for row in fallback[:12]],
            "",
            f"Snapshot as of {as_of}. The full board is on the **Vault** page (/vault). I "
            "suggest; you choose and sign.",
        ]
        return "\n".join(lines)

    if not rows:
        return _unavailable_text()

    if kind == "list":
        total = len(rows)
        noun = "vault" if total == 1 else "vaults"
        verb = "is" if total == 1 else "are"
        header = f"There {verb} {total} live {noun} {scope} right now (snapshot as of {as_of})."
        if total > 12:
            header = (
                f"There are {total} live vaults {scope} right now (snapshot as of "
                f"{as_of}); here are the top 12 by net APY."
            )
        lines = [
            header,
            "",
            *[f"- {_row_line(config, row)}" for row in rows[:12]],
            "",
            "The full board is on the **Vault** page (/vault). I suggest; you choose and sign.",
        ]
        return "\n".join(lines)

    top = rows[0]
    top_apy = apy_bps(top)
    if top_apy is None:
        lead = (
            "No vault in the current snapshot reports a net APY, so I can't rank them by yield. "
            f"**{_name(top)}** is the first listed vault: {_protocol_label(top)} on "
            f"{_chain_label(config, top)}, {_asset_symbol(top)}, {_apy_text(top)}, "
            f"{_fmt_usd(top.get('tvlUsd'))}."
        )
    elif kind == "rate":
        lead = (
            f"The vault paying the most right now is **{_name(top)}** — {_protocol_label(top)} on "
            f"{_chain_label(config, top)}, {_asset_symbol(top)}, **{_apy_text(top)}**, "
            f"{_fmt_usd(top.get('tvlUsd'))}."
        )
    else:
        lead = (
            f"**{_name(top)}** has the highest net APY in the live snapshot {scope}: "
            f"{_protocol_label(top)} on {_chain_label(config, top)}, {_asset_symbol(top)}, "
            f"**{_apy_text(top)}**, {_fmt_usd(top.get('tvlUsd'))}."
        )
    lines = [
        lead,
        "",
        f"Snapshot as of {as_of}. Top vaults by net APY right now:",
        "",
        *[f"- {_row_line(config, row)}" for row in rows[:5]],
        "",
        "Rates float with the market, so treat them as an estimate, not a promise.",
        "",
        "The full board is on the **Vault** page (/vault). I suggest; you choose and sign.",
    ]
    return "\n".join(lines)
