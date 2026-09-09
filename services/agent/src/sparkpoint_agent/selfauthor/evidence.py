"""034 — what a run fetched, and the two rules that decide whether it may be written down.

PURE. No I/O, no database, no network. Everything the feature promises about *numbers* lives here,
because a promise enforced by a pure function is a promise that survives the fetchers being
rewritten.

TWO RULES, AND BOTH EXIST BECAUSE OF A REAL GAP:

1. **A figure must know which chain it came from.** Our vault reads **0.44%** on Base Sepolia while
   the identical strategy pays **3.48%** on Base mainnet — roughly eight times more. A note written
   from web data would describe returns no alpha user can get; a note written from testnet data
   would make the product look broken. Both are wrong. So a figure without a `chain_id` is not
   publishable, and `describe()` puts the chain in the sentence rather than in a footnote nobody
   reads.

2. **A figure must be plausible.** Market data is fetched from third parties who occasionally
   return a negative rate, a placeholder, or a number in the wrong unit. The bounds here are
   deliberately wide — the intent is to catch a broken feed, not to second-guess a real market.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any

#: Chain ids this product runs on, and the name a reader recognises. A figure carrying a chain we
#: do not know about is still publishable — it just gets described by its number, which is honest.
CHAIN_NAMES: dict[int, str] = {
    1: "Ethereum mainnet",
    8453: "Base mainnet",
    84532: "Base Sepolia (testnet)",
    4663: "Robinhood Chain",
    46630: "Robinhood testnet",
}

#: Chains where the numbers are play money. Used to keep testnet and mainnet figures from ever being
#: presented as competing options.
TESTNET_CHAIN_IDS: frozenset[int] = frozenset({84532, 46630})

#: Wide on purpose. A supply APY outside 0–100% is a broken feed, not a market.
MIN_APY_BPS = 0
MAX_APY_BPS = 10_000

#: A TVL below this is noise (a fresh test deployment), above it is implausible for any single pool.
MAX_TVL_USD = Decimal("1e12")

#: Evidence sources, by name. These are the values an admin may put in `allowed_data_sources`.
SOURCE_CHAIN = "chain"
SOURCE_DEFILLAMA = "defillama"
SOURCE_MORPHO = "morpho"
SOURCE_OWN_CORPUS = "own_corpus"
SOURCE_ANSWER_GAPS = "answer_gaps"
SOURCE_PROSE = "prose"

KNOWN_SOURCES: frozenset[str] = frozenset(
    {
        SOURCE_CHAIN,
        SOURCE_DEFILLAMA,
        SOURCE_MORPHO,
        SOURCE_OWN_CORPUS,
        SOURCE_ANSWER_GAPS,
        SOURCE_PROSE,
    }
)

#: What a label is CALLED when a person reads it. Found in live output: the first run published
#: "aave_supply_apy_bps_mainnet on Base mainnet: 3.48%" — a database column name, in a document
#: written for users. A label without an entry here falls back to a de-underscored form, so a new
#: label reads badly rather than breaking, and the fix is one line.
LABEL_NAMES: dict[str, str] = {
    "aave_supply_apy_bps_mainnet": "Aave's USDC supply rate",
    "vault_net_apy_bps_testnet": "our vault's rate, net of the performance fee",
    "vault_performance_fee_bps": "our vault's performance fee (charged only on profit)",
    "managed_usdc_apy_bps_range_mainnet": "managed USDC vaults, low end of the range",
    "morpho_net_apy_bps": "Morpho's net rate after its whole fee chain",
}


#: Labels that describe OUR OWN TERMS rather than a market rate.
#:
#: Found by the second live run: the performance fee rendered under "On the testnet this alpha runs
#: on", beneath the disclaimer that those figures "come from a handful of test wallets" and "are not
#: a forecast". Both statements are true of a market rate and false of a fee. Read together they
#: implied our 10% fee is a testnet artifact that will be different on mainnet. It will not be, and
#: a reader making a decision on that would have been misled by us — in exactly the dimension this
#: feature exists to protect.
TERM_LABELS: frozenset[str] = frozenset({"vault_performance_fee_bps"})


def label_name(label: str) -> str:
    """A label as a person would say it."""
    return LABEL_NAMES.get(label, label.replace("_", " "))


def is_term(label: str) -> bool:
    """Whether this figure is one of our own terms rather than a rate a market set."""
    return label in TERM_LABELS


STATUS_OK = "ok"
STATUS_REFUSED = "refused"
STATUS_IMPLAUSIBLE = "implausible"
STATUS_ERROR = "error"


@dataclass(frozen=True)
class Evidence:
    """One fetched fact or quotation.

    ``value`` and ``quote`` are separate rather than one polymorphic field: a figure gets bounds and
    a chain, a quotation gets attribution and a trust tier, and merging them invites code that
    forgets which it is holding.
    """

    source: str
    label: str
    value: Decimal | None = None
    quote: str | None = None
    chain_id: int | None = None
    url: str | None = None
    attribution: str | None = None
    status: str = STATUS_OK
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def is_figure(self) -> bool:
        return self.value is not None

    @property
    def is_prose(self) -> bool:
        return self.quote is not None

    @property
    def is_testnet(self) -> bool:
        return self.chain_id in TESTNET_CHAIN_IDS

    @property
    def publishable(self) -> bool:
        """Whether this may appear in a document.

        A figure without a chain is NOT publishable. That is the whole point of the rule: the
        alternative is a bare percentage that a reader will assume applies to them, and on a testnet
        product that assumption is wrong by a factor of eight.
        """
        if self.status != STATUS_OK:
            return False
        if self.is_figure:
            return self.chain_id is not None
        if self.is_prose:
            # Prose without attribution cannot be quoted, because a quotation whose speaker is
            # unknown is indistinguishable from something we wrote ourselves.
            return bool(self.attribution)
        return False

    def describe(self) -> str:
        """This figure as a sentence fragment, with the chain named IN it."""
        if self.is_prose:
            who = self.attribution or "an external source"
            return f"{who} says: “{(self.quote or '').strip()}”"
        name = label_name(self.label)
        if is_term(self.label):
            # No chain clause: a fee is our term, not something a market on some chain decided.
            return f"{name}: {format_bps(self.value)}"
        chain = chain_name(self.chain_id)
        if not chain:
            return f"{name}: {self.value}"
        return f"{name} on {chain}: {format_bps(self.value)}"


def chain_name(chain_id: int | None) -> str:
    """A chain a reader recognises, or an honest fallback. Never an empty string for a known id."""
    if chain_id is None:
        return ""
    return CHAIN_NAMES.get(chain_id, f"chain {chain_id}")


def format_bps(value: Decimal | None) -> str:
    """Basis points as a percentage a person would say out loud. 348 -> "3.48%"."""
    if value is None:
        return "unavailable"
    return f"{value / Decimal(100):.2f}%"


def _as_decimal(value: Any) -> Decimal | None:
    """A comparable finite Decimal, or None.

    ``Decimal("nan")`` PARSES — it is only the comparison that raises ``InvalidOperation``, so a
    NaN sails through a naive parse and explodes inside the bounds check. This project has been
    bitten by NaN once already: feature 029 shipped ``x-chain-id: NaN`` on every request because
    ``chainId ?? DEFAULT`` does not catch it either. A broken feed returning NaN must read as
    "not a number we can use", not as an exception from a plausibility check.
    """
    try:
        decimal = Decimal(str(value))
    except (InvalidOperation, TypeError, ValueError):
        return None
    return None if not decimal.is_finite() else decimal


def is_plausible_apy_bps(value: Any) -> bool:
    """Whether an APY in basis points could have come from a working feed.

    Wide bounds by design. A 0% rate is real (a testnet with no borrowers); a negative rate or a
    900% supply APY on a stablecoin is a broken feed or a unit error, and writing it down would put
    a fabricated number in front of a user.
    """
    decimal = _as_decimal(value)
    if decimal is None:
        return False
    return MIN_APY_BPS <= decimal <= MAX_APY_BPS


def is_plausible_tvl_usd(value: Any) -> bool:
    decimal = _as_decimal(value)
    if decimal is None:
        return False
    return Decimal(0) <= decimal <= MAX_TVL_USD


def separates_testnet_from_mainnet(items: list[Evidence]) -> bool:
    """Whether a set of figures can be shown together without misleading anyone.

    A document may never put a testnet figure beside a mainnet one as if they were competing
    options — that is the single most misleading thing this feature could produce. Mixed sets are
    still USABLE; they just have to be rendered in separate, labelled passages, which is what the
    document renderer does. This predicate is what tells it a set is mixed.
    """
    chains = {e.chain_id for e in items if e.is_figure and e.chain_id is not None}
    has_testnet = any(c in TESTNET_CHAIN_IDS for c in chains)
    has_mainnet = any(c not in TESTNET_CHAIN_IDS for c in chains)
    return not (has_testnet and has_mainnet)
