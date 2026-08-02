"""The 028 activity-fold orchestrator — reads each activity source since the per-user cursor,
derives memory lines (:mod:`sparkpoint_agent.activity`), and appends them WITH the advanced
cursor in one transaction (:meth:`MemoryStore.append_with_cursor`).

Called once per chat turn by the memory sink in :mod:`sparkpoint_agent.api.chat` — lazily, so
activity only ever folds for users who actually talk to Sparky, and NEVER on a custody-adjacent
path.

FAIL-OPEN CONTRACT: :func:`fold_activity` returns a :class:`FoldResult` and RAISES NOTHING.
Every source read is individually guarded — a source that fails is skipped (its sub-cursor
untouched, so nothing is lost) and named in ``skipped_sources``; a disabled fold (migration 0031
absent) or a failed append returns ``folded=0`` with the reason. The CALLER owns the
once-per-process warning, mirroring the 027 sink discipline (the #125 lesson: fail-open must
never be blind).

Source→identity mapping (research R1, following each consumer's precedent):
vault flows are keyed by ``account.account`` (exactly how the portfolio reads them);
executions by ``account.account`` (what ``insert_submitted`` records — US2);
swaps/faucet by ``owner`` (the signing wallet — US3). Identical strings today via the BFF.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID

from .activity import (
    EXEC_SKIP_FOREVER,
    EXEC_TERMINAL_SUCCESS,
    MAX_DEFERRED_EXECS,
    SWAP_NOTIONAL_MULTIPLIER,
    ActivityEvent,
    format_line,
    merge_and_dedup,
    normalize_tx,
    plan_fold,
)
from .chain.faucet_probe import FaucetProbe
from .db.executions import ExecutionStore
from .db.swap_fees import PgSwapFeeEventStore
from .db.user_memory import FoldColumnMissing, MemoryStore
from .db.vault_flows import VaultFlowReader

#: The exec sub-cursor's epoch — reads "everything" on a first fold without a NULL-vs-ts branch.
_EXEC_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)

#: Per-source read bound BEFORE merge/sample/cap — keeps a hyperactive wallet's fold O(small).
SOURCE_READ_LIMIT = 25


@dataclass(frozen=True)
class FoldResult:
    """What one fold did. ``error`` is set (and ``folded == 0``) when the fold as a whole could
    not run — the caller decides whether that is warn-worthy."""

    folded: int = 0
    skipped_sources: tuple[str, ...] = ()
    first_fold: bool = False
    disabled: bool = False
    error: BaseException | None = None


@dataclass
class ActivityFolder:
    """Bundles the sources. US1 wires vault flows; US2/US3 extend with executions, swaps and the
    faucet probe via the optional fields so each story stays independently shippable."""

    memory: MemoryStore
    flows: VaultFlowReader | None = None
    #: (network_id, vault_address) pairs to read flows from — today one: ('base', <vault>).
    flow_targets: tuple[tuple[str, str], ...] = ()
    #: US2 — app-signed executions (keyed by ``account.account``).
    executions: ExecutionStore | None = None
    #: US3 — attributed swaps (keyed by ``owner``, per network) + the canonical-USDC match for
    #: honest units (a fee in any other token renders unitless).
    swaps: PgSwapFeeEventStore | None = None
    swap_networks: tuple[str, ...] = ()
    usdc_by_network: dict[str, str] | None = None
    #: US3 — the SRK faucet claim probe (keyed by ``owner``; Base Sepolia only today).
    faucet_probe: FaucetProbe | None = None


async def _read_flow_events(
    folder: ActivityFolder, account: str, cursor: dict[str, Any] | None
) -> tuple[list[ActivityEvent], list[str]]:
    """Vault flows since the cursor, as events. Failures skip the source, never raise."""
    if folder.flows is None or not folder.flow_targets:
        return [], []
    events: list[ActivityEvent] = []
    skipped: list[str] = []
    buckets = (cursor or {}).get("flows") or {}
    for network_id, vault in folder.flow_targets:
        after = None
        marker = buckets.get(network_id)
        if isinstance(marker, dict) and "block" in marker:
            after = (int(marker["block"]), int(marker.get("log", 0)))
        try:
            rows = await folder.flows.list_flows_since(
                network_id, vault, account, after, limit=SOURCE_READ_LIMIT
            )
        except Exception:
            skipped.append(f"flows:{network_id}")
            continue
        for r in rows:
            at = r.created_at if r.created_at is not None else datetime.now(UTC)
            events.append(
                ActivityEvent(
                    source="flow",
                    kind=r.kind,
                    at=at,
                    amount_raw=r.assets,
                    decimals=6,
                    unit="USDC",
                    tx=normalize_tx(r.tx_hash),
                    network=network_id,
                    position=(r.block_number, r.log_index),
                )
            )
    return events, skipped


@dataclass(frozen=True)
class _ExecRead:
    """One exec-source read: the fold candidates + what the sub-cursor advance needs to know."""

    events: list[ActivityEvent]
    #: (id, at) of every row seen, by disposition. ``ts`` may only advance past a row that is
    #: folded, skipped-forever, or carried in ``deferred`` — anything else must stay re-readable.
    pending: list[tuple[str, datetime]]
    settled: list[tuple[str, datetime, str | None]]
    seen_max: datetime
    #: True iff the read returned ANY row — even all-skip-forever reads must advance ``ts``,
    #: or those rows would be re-read on every fold forever.
    saw_rows: bool = False


async def _read_exec_events(
    folder: ActivityFolder, account: str, cursor: dict[str, Any] | None
) -> tuple[_ExecRead | None, list[str]]:
    """US2: executions since the exec sub-cursor. ``(None, skipped)`` when unwired or failed —
    the sub-cursor then stays untouched, so nothing is lost."""
    if folder.executions is None:
        return None, []
    sub = ((cursor or {}).get("execs") or {}) if cursor is not None else {}
    after_raw = sub.get("ts")
    try:
        after = datetime.fromisoformat(after_raw) if isinstance(after_raw, str) else _EXEC_EPOCH
    except ValueError:
        after = _EXEC_EPOCH
    deferred_ids = []
    deferred_raw = sub.get("deferred") or []
    for item in deferred_raw if isinstance(deferred_raw, list) else []:
        try:
            deferred_ids.append(UUID(str(item)))
        except ValueError:
            continue
    try:
        rows = await folder.executions.list_by_account_since(
            account, after, deferred_ids, limit=SOURCE_READ_LIMIT
        )
    except Exception:
        return None, ["execs"]
    read = _ExecRead(events=[], pending=[], settled=[], seen_max=after)
    seen_max = after
    for row in rows:
        at = row.created_at if row.created_at.tzinfo else row.created_at.replace(tzinfo=UTC)
        seen_max = max(seen_max, at)
        if row.status in EXEC_TERMINAL_SUCCESS or row.status == "reverted":
            read.events.append(
                ActivityEvent(
                    source="exec",
                    kind=row.action_kind,
                    at=at,
                    via_sparky=True,
                    reverted=row.status == "reverted",
                    tx=normalize_tx(row.tx_hash),
                    position=str(row.id),
                )
            )
            read.settled.append((str(row.id), at, normalize_tx(row.tx_hash)))
        elif row.status in EXEC_SKIP_FOREVER:
            pass  # advances silently — chat already remembered the proposal
        else:
            read.pending.append((str(row.id), at))
    return _ExecRead(read.events, read.pending, read.settled, seen_max, bool(rows)), []


def _exec_sub_cursor(
    read: _ExecRead, folded: tuple[ActivityEvent, ...], *, first_fold: bool
) -> dict[str, Any]:
    """The advanced exec sub-cursor (research R5), safe against the fold's line cap.

    ``deferred`` carries pending rows AND settled rows whose events were cut by the cap, so
    ``ts`` can advance past everything seen without losing either. If the carry overflows its
    bound, ``ts`` is held back to just before the oldest uncarried row (strict ``>`` read makes
    it re-readable). First fold keeps jump-to-head semantics (the sample is a taste — D1): only
    genuinely-pending rows are carried.
    """
    folded_exec_ids = {e.position for e in folded if e.source == "exec"}
    # A dedup-merged exec folds AS ITS FLOW (source="flow") — cover it by tx hash, or the
    # settled row would be carried and re-folded as a duplicate line next turn.
    folded_txs = {e.tx for e in folded if e.tx}
    if first_fold:
        carry = [(rid, at) for rid, at in read.pending]
    else:
        unfolded_settled = [
            (rid, at)
            for rid, at, tx in read.settled
            if rid not in folded_exec_ids and (tx is None or tx not in folded_txs)
        ]
        carry = sorted(read.pending + unfolded_settled, key=lambda p: p[1])
    kept = carry[:MAX_DEFERRED_EXECS]
    dropped = carry[MAX_DEFERRED_EXECS:]
    if dropped:
        ts = min(at for _, at in dropped) - timedelta(microseconds=1)
    else:
        ts = read.seen_max
    return {"ts": ts.isoformat(), "deferred": [rid for rid, _ in kept]}


async def _read_swap_events(
    folder: ActivityFolder, owner: str, cursor: dict[str, Any] | None
) -> tuple[list[ActivityEvent], list[str]]:
    """US3: attributed swaps since the per-network swap sub-cursor. The notional is estimated
    from the recorded 0.20% platform fee (× SWAP_NOTIONAL_MULTIPLIER) and always marked
    approximate; a fee token that is not the network's canonical USDC renders unitless."""
    if folder.swaps is None or not folder.swap_networks:
        return [], []
    events: list[ActivityEvent] = []
    skipped: list[str] = []
    buckets = (cursor or {}).get("swaps") or {}
    usdc = folder.usdc_by_network or {}
    for network_id in folder.swap_networks:
        after = None
        marker = buckets.get(network_id)
        if isinstance(marker, dict) and "block" in marker:
            after = (int(marker["block"]), int(marker.get("log", 0)))
        try:
            rows = await folder.swaps.list_for_swapper(
                network_id, owner, after, limit=SOURCE_READ_LIMIT
            )
        except Exception:
            skipped.append(f"swaps:{network_id}")
            continue
        canonical = (usdc.get(network_id) or "").lower()
        for r in rows:
            at = r.block_time if r.block_time.tzinfo else r.block_time.replace(tzinfo=UTC)
            is_usdc = bool(canonical) and r.token_address.lower() == canonical
            events.append(
                ActivityEvent(
                    source="swap",
                    kind="swap",
                    at=at,
                    amount_raw=r.fee_value_raw * SWAP_NOTIONAL_MULTIPLIER,
                    decimals=r.token_decimals,
                    unit="USDC" if is_usdc else None,
                    approx=True,
                    tx=normalize_tx(r.tx_hash),
                    network=network_id,
                    position=(r.block_number, r.log_index),
                )
            )
    return events, skipped


async def _read_faucet_event(
    folder: ActivityFolder, owner: str, cursor: dict[str, Any] | None
) -> tuple[list[ActivityEvent], dict[str, Any] | None]:
    """US3: at most ONE faucet-claim event — the most recent claim, when newer than the faucet
    sub-cursor. Returns ``(events, new_faucet_ts)``; ``(None)`` sub-cursor means untouched."""
    if folder.faucet_probe is None:
        return [], None
    last = await folder.faucet_probe.last_claim_at(owner)
    if last is None:
        return [], None
    prior_raw = (cursor or {}).get("faucet")
    try:
        prior = datetime.fromisoformat(prior_raw) if isinstance(prior_raw, str) else None
    except ValueError:
        prior = None
    if prior is not None and last <= prior:
        return [], None
    event = ActivityEvent(source="faucet", kind="faucet_claim", at=last)
    return [event], {"faucet": last.isoformat()}


async def fold_activity(folder: ActivityFolder, *, owner: str, account: str) -> FoldResult:
    """One lazy fold for this user. Returns, never raises (see the module contract)."""
    try:
        try:
            cursor = await folder.memory.get_activity_cursor(owner)
        except FoldColumnMissing:
            return FoldResult(disabled=True)

        events: list[ActivityEvent] = []
        skipped: list[str] = []

        flow_events, flow_skipped = await _read_flow_events(folder, account, cursor)
        events.extend(flow_events)
        skipped.extend(flow_skipped)

        exec_read, exec_skipped = await _read_exec_events(folder, account, cursor)
        if exec_read is not None:
            events.extend(exec_read.events)
        skipped.extend(exec_skipped)

        swap_events, swap_skipped = await _read_swap_events(folder, owner, cursor)
        events.extend(swap_events)
        skipped.extend(swap_skipped)

        faucet_events, faucet_sub = await _read_faucet_event(folder, owner, cursor)
        events.extend(faucet_events)

        exec_saw_something = exec_read is not None and exec_read.saw_rows
        if not events and cursor is not None and not exec_saw_something:
            # Steady state with nothing new — no write at all (the common case must be free).
            return FoldResult(folded=0, skipped_sources=tuple(skipped))

        deduped = merge_and_dedup(events)
        plan = plan_fold(deduped, cursor)
        new_cursor = dict(plan.cursor)
        if faucet_sub is not None:
            # The faucet event never survives a cap-cut silently: if it folded, advance; if the
            # plan cut it, leave the sub-cursor so it re-derives next turn.
            if any(e.source == "faucet" for e in plan.events):
                new_cursor["faucet"] = faucet_sub["faucet"]
        if exec_read is not None:
            # Overlay the exec sub-cursor — it needs source-private knowledge (pending rows +
            # cap-cut settled rows), which plan_fold deliberately doesn't have (data-model §4).
            new_cursor["execs"] = _exec_sub_cursor(
                exec_read, plan.events, first_fold=plan.first_fold
            )
        lines = [format_line(e) for e in plan.events]
        try:
            await folder.memory.append_with_cursor(owner, lines, new_cursor)
        except FoldColumnMissing:
            return FoldResult(disabled=True)
        return FoldResult(
            folded=len(lines),
            skipped_sources=tuple(skipped),
            first_fold=plan.first_fold,
        )
    except Exception as exc:  # noqa: BLE001 — the fold's outer fail-open boundary
        return FoldResult(error=exc)
