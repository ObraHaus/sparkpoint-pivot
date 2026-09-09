"""Pure derivation for feature 028 — platform activity → memory lines.

Turns the user's already-recorded platform actions (indexed vault flows, app-signed executions,
swap-fee events, a faucet-claim probe) into the short human-readable lines the feature-027 memory
digest stores, plus the cursor arithmetic that guarantees EXACTLY-ONCE folding. Everything here is
pure and synchronous — no I/O, no clock reads (timestamps ride in on the events) — mirroring
:mod:`sparkpoint_agent.memory`, so the risky logic is testable without a database.

The fold pipeline (driven by :mod:`sparkpoint_agent.activity_fold`):

    events  = [ActivityEvent … from each source, already cursor-filtered]
    events  = merge_and_dedup(events)      # tx-hash join: flow+exec pair → ONE via-Sparky event
    plan    = plan_fold(events, cursor)    # first-fold sample K=5 / steady-state cap 10 / cursor
    lines   = [format_line(e) for e in plan.events]

LABELING RULE (research R6/R7): a vault flow whose tx hash matches an app-signed execution is the
SAME action seen twice — it folds once, labeled "via Sparky's plan" (every drawer execution starts
from a Sparky-proposed card, so the label is truthful). A flow with no execution is the user acting
alone: "yourself". Executions with no flow (session-key ops, reverted attempts) stand alone.

HONESTY RULES (Constitution III): swap notionals are ESTIMATES from the recorded 0.20% platform fee
(× 500) and always render with "~"; a swap in a token we cannot confidently name renders unitless
("~5.00 tokens") rather than with an invented symbol; faucet claims carry NO amount (historic claim
sizes are unknowable). Dates are absolute, day-granular (event timestamps are indexer receipt
times — minutes of lag, irrelevant at day granularity).

NON-CUSTODY: derived lines are advisory prose context only. They flow into the same digest with the
same fence/sanitize path and the same classifier+prose-only boundary as every 027 line.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from .memory import MAX_LINE_CHARS

#: First-ever fold takes only this many most-recent events (client decision D1) — a conversational
#: sample, not an archival dump; the cursor then jumps to head.
FIRST_FOLD_SAMPLE = 5
#: Steady-state folds add at most this many lines; the cursor advances only past what folded.
MAX_FOLD_LINES = 10
#: Pending executions carried on the cursor awaiting a terminal state (research R5), bounded.
MAX_DEFERRED_EXECS = 10
#: The swap fee is 0.20% of notional, so notional ≈ fee × 500. Always rendered as approximate.
SWAP_NOTIONAL_MULTIPLIER = 500

#: Execution statuses that fold as a success line. ``reverted`` folds as the gentle failure line.
EXEC_TERMINAL_SUCCESS = frozenset({"confirmed", "indexed"})
#: Statuses that will NEVER fold — proposals/rejections chat already remembers, or terminal noise.
EXEC_SKIP_FOREVER = frozenset({"built", "policy_rejected", "declined", "dropped"})

Source = Literal["flow", "exec", "swap", "faucet"]


def _clamp(text: str) -> str:
    """Whitespace-flatten + hard-cap at :data:`MAX_LINE_CHARS` (memory.py's discipline)."""
    flat = " ".join(text.split())
    return flat if len(flat) <= MAX_LINE_CHARS else flat[: MAX_LINE_CHARS - 1].rstrip() + "…"


def normalize_tx(tx: str | bytes | None) -> str | None:
    """Lower hex without ``0x`` — the cross-source dedup key. ``None``/empty stays ``None``."""
    if tx is None:
        return None
    if isinstance(tx, bytes | bytearray):
        h = bytes(tx).hex()
    else:
        h = tx.lower().removeprefix("0x")
    return h or None


@dataclass(frozen=True)
class ActivityEvent:
    """One real platform action, source-agnostic (data-model.md §2). Never persisted or wired."""

    source: Source
    #: ``deposit`` | ``withdraw`` | ``swap`` | ``faucet_claim`` | an execution ``action_kind``.
    kind: str
    at: datetime
    amount_raw: int | None = None
    decimals: int | None = None
    #: The amount's unit when confidently known (address-book match); ``None`` renders unitless.
    unit: str | None = None
    approx: bool = False
    via_sparky: bool = False
    reverted: bool = False
    tx: str | None = None
    #: The source network id (``base`` / ``robinhood`` …) for per-network cursor buckets.
    network: str | None = None
    #: Opaque per-source position used for cursor advance (flows/swaps: (block, log);
    #: execs: the row id str; faucet: unused).
    position: tuple[int, int] | str | None = None

    def sort_key(self) -> tuple[datetime, str, str]:
        at = self.at if self.at.tzinfo is not None else self.at.replace(tzinfo=UTC)
        return (at, self.source, self.tx or "")


def _amount(event: ActivityEvent) -> str | None:
    """``500.00 USDC`` / ``~1,000.00 USDC`` / ``~5.00 tokens`` — or ``None`` when unknowable."""
    if event.amount_raw is None or event.decimals is None:
        return None
    whole = event.amount_raw / (10**event.decimals)
    rendered = f"{whole:,.2f} {event.unit or 'tokens'}"
    return f"~{rendered}" if event.approx else rendered


def _date(event: ActivityEvent) -> str:
    at = event.at if event.at.tzinfo is not None else event.at.replace(tzinfo=UTC)
    return f"{at.strftime('%b')} {at.day}"


_FLOW_VERBS = {"deposit": "deposited", "withdraw": "withdrew"}
_FLOW_DIRECTION = {"deposit": "into", "withdraw": "from"}
#: Reverted lines name the action gently without amounts — the money did NOT move.
_REVERTED_NAMES = {
    "deposit": "a vault deposit",
    "withdraw": "a vault withdrawal",
    "vault_deposit": "a vault deposit",
    "vault_withdraw": "a vault withdrawal",
    "vault_redeem": "a vault withdrawal",
}
#: Standalone execution kinds (no vault flow to speak through).
_EXEC_NAMES = {
    "session_key_grant": "granted a session key",
    "session_key_revoke": "revoked a session key",
    "vault_deposit": "made a vault deposit",
    "vault_withdraw": "made a vault withdrawal",
    "vault_redeem": "made a vault withdrawal",
}


def format_line(event: ActivityEvent) -> str:
    """One digest line for one event (data-model.md §3). Total, never raises; always ≤120 chars."""
    when = _date(event)
    if event.reverted:
        name = _REVERTED_NAMES.get(event.kind, "an action")
        return _clamp(f"{name} you signed didn't go through (reverted, {when})")
    if event.source == "faucet":
        return _clamp(f"claimed test SRK from the faucet ({when})")
    if event.source == "swap":
        amount = _amount(event)
        detail = f"{amount}, {when}" if amount else when
        return _clamp(f"made a token swap ({detail})")
    label = "via Sparky's plan" if event.via_sparky else "yourself"
    if event.source == "flow" and event.kind in _FLOW_VERBS:
        amount = _amount(event) or "funds"
        verb, direction = _FLOW_VERBS[event.kind], _FLOW_DIRECTION[event.kind]
        return _clamp(f"{verb} {amount} {direction} the vault ({label}, {when})")
    # Execution-only events (or an unknown flow kind — defensive).
    known = _EXEC_NAMES.get(event.kind)
    if known is None:
        pretty = event.kind.replace("_", " ").strip() or "an action"
        known = f"completed {pretty}"
    return _clamp(f"{known} ({label}, {when})")


def merge_and_dedup(events: list[ActivityEvent]) -> list[ActivityEvent]:
    """Chronological merge with the tx-hash join (research R6).

    A flow and an execution sharing a tx are ONE action: keep the FLOW's amounts/kind (chain truth)
    stamped ``via_sparky`` (and ``reverted`` if the execution says so — flows of reverted txs
    should not exist, but belt-and-braces). Events without a tx never dedup.
    """
    exec_by_tx: dict[str, ActivityEvent] = {
        e.tx: e for e in events if e.source == "exec" and e.tx
    }
    merged: list[ActivityEvent] = []
    consumed_execs: set[str] = set()
    for event in events:
        if event.source == "exec" and event.tx and event.tx in consumed_execs:
            continue
        if event.source == "flow" and event.tx and event.tx in exec_by_tx:
            twin = exec_by_tx[event.tx]
            consumed_execs.add(event.tx)
            merged.append(
                ActivityEvent(
                    source="flow",
                    kind=event.kind,
                    at=event.at,
                    amount_raw=event.amount_raw,
                    decimals=event.decimals,
                    unit=event.unit,
                    approx=event.approx,
                    via_sparky=True,
                    reverted=twin.reverted,
                    tx=event.tx,
                    network=event.network,
                    position=event.position,
                )
            )
            continue
        merged.append(event)
    # Second pass drops exec twins that appeared BEFORE their flow in the input order.
    deduped: list[ActivityEvent] = [
        e for e in merged if not (e.source == "exec" and e.tx and e.tx in consumed_execs)
    ]
    deduped.sort(key=ActivityEvent.sort_key)
    return deduped


@dataclass(frozen=True)
class FoldPlan:
    """What one fold will actually do: the events to render (in order) + the cursor to store."""

    events: tuple[ActivityEvent, ...]
    cursor: dict[str, Any]
    first_fold: bool = False


def _advance_positions(
    prior: dict[str, Any], folded: list[ActivityEvent]
) -> dict[str, Any]:
    """Cursor arithmetic (data-model §4). Flows/swaps advance per-network past the newest FOLDED
    event (steady state) so a cap-truncated fold resumes where it stopped; executions advance
    ``ts`` past the newest SEEN terminal-or-skip row with pendings carried in ``deferred``
    (research R5) — the caller pre-computes that sub-cursor because only it sees pending rows."""
    cursor = {k: v for k, v in prior.items() if k != "v"}
    cursor["v"] = 1
    for e in folded:
        if e.source in ("flow", "swap") and isinstance(e.position, tuple):
            net = e.network or "base"
            bucket = dict(cursor.get(f"{e.source}s") or {})
            best = bucket.get(net)
            candidate = {"block": e.position[0], "log": e.position[1]}
            if best is None or (candidate["block"], candidate["log"]) > (
                best.get("block", -1),
                best.get("log", -1),
            ):
                bucket[net] = candidate
            cursor[f"{e.source}s"] = bucket
    return cursor


def plan_fold(
    events: list[ActivityEvent],
    prior_cursor: dict[str, Any] | None,
) -> FoldPlan:
    """Select what folds and compute the base cursor advance.

    ``events`` are already cursor-filtered per source and deduped. First fold (no prior cursor):
    the :data:`FIRST_FOLD_SAMPLE` most recent events, cursor jumps to head-of-everything-seen
    (the sample is a taste, not a ledger — D1). Steady state: the oldest
    :data:`MAX_FOLD_LINES`, cursor past exactly what folded. The exec and faucet sub-cursors are
    OVERLAID by the orchestrator (they need source-private knowledge: pending rows, probe ts).
    """
    ordered = sorted(events, key=ActivityEvent.sort_key)
    if prior_cursor is None:
        chosen = ordered[-FIRST_FOLD_SAMPLE:]
        # The cursor jumps past EVERYTHING seen — the sample is a taste, not a ledger (D1).
        return FoldPlan(
            events=tuple(chosen),
            cursor=_advance_positions({}, ordered),
            first_fold=True,
        )
    chosen = ordered[:MAX_FOLD_LINES]
    return FoldPlan(
        events=tuple(chosen),
        cursor=_advance_positions(prior_cursor, chosen),
        first_fold=False,
    )
