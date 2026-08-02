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
from datetime import UTC, datetime
from typing import Any

from .activity import (
    ActivityEvent,
    format_line,
    merge_and_dedup,
    normalize_tx,
    plan_fold,
)
from .db.user_memory import FoldColumnMissing, MemoryStore
from .db.vault_flows import VaultFlowReader

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
    #: Extension points (US2/US3): see fold_activity for their contracts.
    executions: Any = None
    swaps: Any = None
    swap_networks: tuple[str, ...] = ()
    faucet_probe: Any = None


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

        # US2 (executions) and US3 (swaps + faucet) extend here.

        if not events and cursor is not None:
            # Steady state with nothing new — no write at all (the common case must be free).
            return FoldResult(folded=0, skipped_sources=tuple(skipped))

        deduped = merge_and_dedup(events)
        plan = plan_fold(deduped, cursor)
        lines = [format_line(e) for e in plan.events]
        try:
            await folder.memory.append_with_cursor(owner, lines, plan.cursor)
        except FoldColumnMissing:
            return FoldResult(disabled=True)
        return FoldResult(
            folded=len(lines),
            skipped_sources=tuple(skipped),
            first_fold=plan.first_fold,
        )
    except Exception as exc:  # noqa: BLE001 — the fold's outer fail-open boundary
        return FoldResult(error=exc)
