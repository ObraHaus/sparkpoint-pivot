"""048 — "what's the best vault / where should I deposit?" answered from the CURATED RECORD.

FR-004: the answer comes from the same stored row the `/vault` board renders, and it never invents
a vault or a number. Deterministic (no model call), like the other shape-sensitive answers — an APY
is the one figure a user cannot sanity-check, so a model is not asked for one.

The read is INJECTED (:attr:`CoordinatorDag.curated`) and fail-open: a store outage yields an honest
"couldn't read it" error block, never a remembered vault. Nothing here is on the policy/action
path — the output is a ``text`` block, which cannot carry a proposed action or a policy stamp.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

__all__ = [
    "BEST_VAULT_RE",
    "CURATED_FAILURE",
    "VAULTS_LIST_RE",
    "CuratedContext",
    "CuratedPick",
    "VAULT_RATE_RE",
    "curated_answer",
    "curated_list_answer",
    "curated_rate_answer",
    "is_vaults_list_question",
]

#: The question shapes this route owns. Deliberately narrow: a real command ("deposit 100 USDC into
#: the vault") must still build an action, and a specific vault question ("what's the vault fee?")
#: still belongs on the grounded corpus path.
BEST_VAULT_RE = re.compile(
    r"\b(?:best|top|safest|recommended)\b[^.?!]{0,30}\bvaults?\b"
    r"|\bwhich vaults?\b"
    r"|\bwhere (?:should|do|can|would) i (?:deposit|put (?:my )?(?:money|funds|usdc)|invest|earn)\b"
    r"|\bbest (?:place|way) to (?:deposit|earn|invest)\b",
    re.IGNORECASE,
)

#: LIST shapes — "what vaults are available right now?", "which vaults are live?", "show me the
#: vaults". Owned by the curated route too: the answer is the same stored record, enumerated. A
#: command with an amount ("deposit 100 USDC into the vault") is deliberately NOT matched, so it
#: still builds an action.
VAULTS_LIST_RE = re.compile(
    # PLURAL "vaults" after what/which ("what are the vaults available…", "what vaults do you
    # have?"); the singular stays with the corpus ("what's the vault fee?") and the build path.
    r"\b(?:what|which)\b[^.?!]{0,20}\bvaults\b"
    r"|\b(?:list|show|see)\s+(?:me\s+)?(?:the\s+)?vaults?\b"
    r"|\b(?:any|all|available)\s+(?:the\s+)?vaults?\b"
    r"|\bvaults?\b[^.?!]{0,25}\b(?:available|live|listed|on the board|right now|today|open)\b"
    r"|\bwhat can i (?:deposit|invest|earn) (?:in|into|on)\b"
    r"|\bwhere can i (?:deposit|invest|earn)\b",
    re.IGNORECASE,
)

#: RATE shapes — "what's the vault paying now?", "what's the APY?". Answered from the SAME stored
#: figure the board renders: an APY is the one number a user cannot sanity-check, so no model is
#: asked for one (048's rule), and the stored read also avoids a needless LLM call.
VAULT_RATE_RE = re.compile(
    r"\bwhat(?:'s| is| are)?\b[^.?!]{0,30}\b(?:paying|pay|yield|yielding|apy|rate|earning)\b"
    r"[^.?!]{0,20}\bvaults?\b"
    r"|\bvaults?\b[^.?!]{0,25}\b(?:paying|pay|yield|yielding|earning|apy|rate)\b"
    r"|\bwhat(?:'s| is) the (?:apy|yield|rate)\b",
    re.IGNORECASE,
)

#: A "best/top/safest" question is answered with the PICK even when it also looks like a list
#: ("which vaults are best?"), so the two routes cannot fight over the same sentence.
_BEST_STYLE_RE = re.compile(r"\b(?:best|top|safest|recommended)\b", re.IGNORECASE)


def is_vaults_list_question(message: str) -> bool:
    """True for a LIST-shaped vault question that is NOT asking for a single best pick."""
    return bool(VAULTS_LIST_RE.search(message)) and not _BEST_STYLE_RE.search(message)


#: An ERROR block renders the retry affordance and is NOT persisted as an answer — so a failed read
#: can never be replayed later as though Sparky had said it.
CURATED_FAILURE = (
    "I couldn't read the curated vault list just now, and I won't guess at a vault or a rate. "
    "Try again in a moment, or open the **Vault** page (/vault) to see the current board."
)


@dataclass(frozen=True)
class CuratedPick:
    """The stored pick, as chat needs it. Every figure is the stored one — None means unknown."""

    address: str
    label: str
    net_apy_bps: int | None
    tvl_usd: float | None
    curator: str | None
    curator_verified: bool
    reason: str
    as_of: str | None
    wrapped: bool


@dataclass(frozen=True)
class CuratedContext:
    """What the store said this turn: how many approved vaults, the published pick (if any), and
    the approved vaults themselves (for a LIST-shaped question)."""

    vault_count: int
    pick: CuratedPick | None = None
    vaults: tuple[CuratedPick, ...] = ()


def _fmt_apy(bps: int | None) -> str:
    if bps is None:
        return "not available right now"
    return f"{bps / 100:.2f}%"


def _fmt_usd(value: float | None) -> str:
    if value is None:
        return "not available right now"
    if value >= 1_000_000_000:
        return f"${value / 1_000_000_000:.1f}B"
    if value >= 1_000_000:
        return f"${value / 1_000_000:.1f}M"
    if value >= 1_000:
        return f"${value / 1_000:.0f}k"
    return f"${value:.0f}"


def _fee_note(wrapped: bool) -> str:
    if wrapped:
        return (
            "It has a SparkPoint performance-fee wrapper: the fee applies only to your gains above "
            "the high-water mark — never to a deposit, a withdrawal, or a flat or losing position."
        )
    return (
        "SparkPoint charges no fee on this one — you deposit directly into the vault contract from "
        "your own wallet, and you can withdraw directly at any time."
    )


def curated_rate_answer(context: CuratedContext) -> str:
    """The RATE answer — the stored net APY for the published pick, exactly as the board shows it.

    Pure. Falls back to ``curated_answer`` when there is no pick (its honest no-vault / no-pick copy
    is the right answer for a rate question too), and says "no rate yet" rather than inventing one.
    """
    pick = context.pick
    if pick is None:
        return curated_answer(context)
    if pick.net_apy_bps is None:
        return (
            f"I don't have a live net APY for **{pick.label}** right now — the stored scan hasn't "
            "produced one I'd stand behind. The **Vault** page (/vault) shows the board's own "
            "figures. I won't invent a rate."
        )
    as_of = f" as of {pick.as_of[:10]}" if pick.as_of else ""
    return (
        f"**{pick.label}** is showing **{_fmt_apy(pick.net_apy_bps)} net APY**{as_of} — the stored "
        "figure the Vault board renders. Rates float with the underlying market, so treat it as an "
        "estimate, not a promise.\n\nThe **Vault** page (/vault) shows every curated vault's rate."
    )


def curated_list_answer(context: CuratedContext) -> str:
    """Compose the LIST answer — every approved vault, from the same stored record.

    Pure. An empty list falls back to ``curated_answer`` so the "no vaults yet" / "no pick yet"
    copy stays in one place. A pick that is present is marked, never re-ranked here.
    """
    vaults = context.vaults
    if not vaults:
        return curated_answer(context)
    pick_address = context.pick.address.lower() if context.pick else None
    count = len(vaults)
    lines = [
        f"There {'is' if count == 1 else 'are'} {count} curated vault"
        f"{'' if count == 1 else 's'} live on this network right now:",
        "",
    ]
    for vault in vaults:
        is_pick = bool(pick_address) and vault.address.lower() == pick_address
        tag = " · the published pick" if is_pick else ""
        lines.append(
            f"- **{vault.label}** — {_fmt_apy(vault.net_apy_bps)} net APY, "
            f"{_fmt_usd(vault.tvl_usd)} TVL{tag}"
        )
    lines += [
        "",
        "The full board — with each vault's own screening notes — is on the **Vault** page "
        "(/vault). I suggest; you choose and sign.",
    ]
    return "\n".join(lines)


def curated_answer(context: CuratedContext) -> str:
    """Compose the deterministic answer. Pure — every sentence is a fact from the stored record."""
    pick = context.pick
    if pick is None:
        if context.vault_count == 0:
            return (
                "There are no curated vaults on this network yet — I don't have one I've screened, "
                "and I won't invent one.\n\n"
                "Discovery runs daily against this chain's vault source, and the board on the "
                "**Vault** page (/vault) fills in by itself when there is something real to show. "
                "In the meantime I can explain how the vaults work, or help you with a swap."
            )
        return (
            f"I'm tracking {context.vault_count} curated vault"
            f"{'s' if context.vault_count != 1 else ''} on this network, but no best pick has "
            "been published yet — an admin reviews what the curator proposes before it leads the "
            "board.\n\n"
            "You can see them under **Vault** (/vault). I'll name a pick here as soon as there is "
            "a published one."
        )

    lines = [f"I'd point you at **{pick.label}** — {pick.reason}", ""]
    as_of = f" (as of {pick.as_of[:10]})" if pick.as_of else ""
    lines.append(f"- Net APY: {_fmt_apy(pick.net_apy_bps)}{as_of}")
    lines.append(f"- TVL: {_fmt_usd(pick.tvl_usd)}")
    if pick.curator:
        curator = f"{pick.curator} (verified)" if pick.curator_verified else pick.curator
        lines.append(f"- Curator: {curator}")
    lines += [
        "",
        _fee_note(pick.wrapped),
        "",
        "The full board — including the vaults I'm watching but not recommending — is on the "
        "**Vault** page (/vault). I suggest; you choose and sign.",
    ]
    return "\n".join(lines)
