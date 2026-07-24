"""The §3.11 in-app notifications endpoints (feature 021) — a REAL, derived, read-only feed.

``GET /notifications`` projects the user's notifications LIVE from already-indexed real data —
never a stored or fabricated row (Principle III, "provable, not promised"):

  - **Transaction results** (``txResults``): a *Deposit confirmed* / *Withdrawal confirmed* per
    indexed vault flow (each linked to its on-chain tx), plus a *reverted-tx* alert from the
    executions index (the alert the flow index can't carry — a revert emits no event).
  - **Realized outcomes** (``outcomeUpdates``): a win/loss/flat per withdrawal, from the SAME exact
    average-cost replay the /outcomes ledger uses — surfaced ONLY when the share history reconciles.

The categories are the ``NotifKey`` toggles the settings page exposes, so the client can filter the
feed by the user's on-device preferences. ``POST /notifications/read`` advances a per-user read
cursor (the only persisted state — migration 0023) so the unread badge is real + cross-device.

  - **Session-key lifecycle** (``sessionKeyExpiry``): an *expiring-soon* / *expired* / *revoked* /
    *spending-cap-nearly-reached* alert per scoped automation grant, derived from the `session_keys`
    mirror (feature 022 US6). Standing conditions, so no poller is needed — derive-on-read like the
    flows above.

NON-CUSTODY (N1/N2/N3/N5): advisory READ only — no key, no signature, no fund move, never on the
withdraw/exit path (N2). A chain/index/store outage DEGRADES to a partial or empty feed (fail-open),
never a hard error and never a fabricated notification. Vault caps-near-limit and Aave-rate-change
notifications remain ABSENT: they need a background poller (feature 021 phase 2) — none are faked.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..chain import VaultReader, VaultUnavailable
from ..config import AgentConfig
from ..db import ExecutionStore, NotificationReadStore, SessionKeyStore, get_database
from ..db.executions import ExecutionRow
from ..db.session_keys import SessionKeyRow
from ..db.vault_flows import FlowRow, RealizedOutcome, VaultFlowReader, replay_outcomes
from .security import AccountContext
from .vault import get_account, get_vault_reader

router = APIRouter(tags=["notifications"])

_BASE_BLOCK_SECONDS = 2  # Base ~2s blocks — APPROX event age from height (no stored time)
_FLOW_LIMIT = 10_000  # the replay reconstructs from zero → needs the WHOLE history (a guard)
_EXEC_LIMIT = 50
_FEED_LIMIT = 50  # newest-N surfaced to the client
_REVERTED_STATES = frozenset({"reverted", "dropped"})
_ACTION_LABEL = {
    "deposit": "Deposit", "withdraw": "Withdrawal", "swap": "Swap", "rebalance": "Rebalance",
}


# ─────────────────────────────────────────────────────────────────────────────
# Injected providers (production wiring; overridden with fakes in tests).
# ─────────────────────────────────────────────────────────────────────────────


def get_agent_config() -> AgentConfig:
    """Process config (chiefly the deploy-time vault address). Overridden in tests."""
    return AgentConfig.from_env()


def get_vault_flow_reader() -> VaultFlowReader:
    """The indexed vault-flow reader (Deposit/Withdraw). Overridden in tests."""
    return VaultFlowReader(get_database())


def get_execution_store() -> ExecutionStore:
    """The executions index (for the reverted-tx alert). Overridden in tests."""
    return ExecutionStore(get_database())


def get_notif_read_store() -> NotificationReadStore:
    """The per-user read cursor (migration 0023). Overridden in tests."""
    return NotificationReadStore(get_database())


def get_session_key_store() -> SessionKeyStore:
    """The session-key mirror (migration 0024) — drives sessionKeyExpiry. Overridden in tests."""
    return SessionKeyStore(get_database())


def _network_id(chain_id: int) -> str:  # noqa: ARG001 — both Base chains fold to one mirror id
    """The ``networks`` mirror id for a chain (Base mainnet + Base Sepolia → ``base``)."""
    return "base"


# ─────────────────────────────────────────────────────────────────────────────
# Response models (camelCase = the §3.11 wire shape).
# ─────────────────────────────────────────────────────────────────────────────


class NotificationItem(BaseModel):
    """One derived, provable notification. ``category`` is the ``NotifKey`` the client filters by;
    ``txHash`` is the on-chain proof (when the source is a chain event)."""

    id: str  # stable + deterministic (dep:/wd:/out:<tx>:<log>, rev:<intentId>) — for read-state
    category: str  # txResults | outcomeUpdates  (the settings toggle this belongs to)
    type: str  # deposit_confirmed | withdrawal_confirmed | tx_reverted | outcome_closed
    title: str
    body: str
    icon: str
    tsApprox: str  # ISO; APPROX (block-derived) for flows, REAL wall-clock for executions
    txHash: str | None = None
    href: str | None = None  # in-app deeplink
    unread: bool


class NotificationsResponse(BaseModel):
    """§3.11 ``GET /notifications`` 200 body — the user's real in-app feed (newest first)."""

    asOf: str
    asOfBlock: int
    stale: bool  # the vault read degraded → flow/outcome rows may be incomplete (execs still shown)
    unreadCount: int
    notifications: list[NotificationItem]


class MarkReadResponse(BaseModel):
    """§3.11 ``POST /notifications/read`` 200 body — the advanced cursor (or a fail-open miss)."""

    ok: bool
    readAt: str | None = None


# ─────────────────────────────────────────────────────────────────────────────
# Derivation helpers (pure; every notification is backed by a real row/event).
# ─────────────────────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class _Pos:
    shares: int
    block: int
    stale: bool


async def _read_position(reader: VaultReader, account: AccountContext) -> _Pos:
    """Read the vault share balance + head block; DEGRADE to stale on outage (never raises)."""
    try:
        shares = await reader.balance_of(account.account)
        block = await reader.block_number()
    except VaultUnavailable:
        return _Pos(shares=0, block=0, stale=True)
    return _Pos(shares=shares, block=block, stale=False)


def _usd(base_units: int) -> str:
    """USDC base units (6dp) → USD (2dp) at $1 par, exact int math. ``5_000_000`` → ``"5.00"``."""
    cents = base_units // 10_000
    return f"{cents // 100}.{cents % 100:02d}"


def _approx_dt(head_block: int, block: int) -> datetime:
    """APPROX event time from block height vs the head (onchain_events has no time; ~2s blocks)."""
    delta_s = max(0, head_block - block) * _BASE_BLOCK_SECONDS
    return datetime.fromtimestamp(datetime.now(UTC).timestamp() - delta_s, UTC)


# A derived notification carries: (sort_dt, block | None, item). `block` is the on-chain block for a
# flow/outcome (unread keyed by height — STABLE across reads); None for an execution (keyed by its
# real wall-clock time). This keeps a just-read head-block event from re-flagging on an immediate
# re-read (a volatile now()-relative time would).
_Derived = tuple[datetime, "int | None", NotificationItem]


def _flow_notif(f: FlowRow, head_block: int) -> _Derived:
    dt = _approx_dt(head_block, f.block_number)
    if f.kind == "deposit":
        item = NotificationItem(
            id=f"dep:{f.tx_hash}:{f.log_index}", category="txResults", type="deposit_confirmed",
            title="Deposit confirmed", body=f"{_usd(f.assets)} USDC into the vault", icon="check",
            tsApprox=dt.isoformat(), txHash=f.tx_hash, href="/portfolio", unread=False,
        )
    else:
        item = NotificationItem(
            id=f"wd:{f.tx_hash}:{f.log_index}", category="txResults", type="withdrawal_confirmed",
            title="Withdrawal confirmed", icon="check",
            body=f"{_usd(f.assets)} USDC to your wallet",
            tsApprox=dt.isoformat(), txHash=f.tx_hash, href="/portfolio", unread=False,
        )
    return dt, f.block_number, item


def _outcome_notif(o: RealizedOutcome, head_block: int) -> _Derived:
    dt = _approx_dt(head_block, o.block_number)
    label = "win" if o.realized > 0 else "loss" if o.realized < 0 else "flat"
    icon = "up" if label == "win" else "down" if label == "loss" else "activity"
    body = {
        "win": f"Your vault position closed up +{_usd(o.realized)} USDC",
        "loss": f"Your vault position closed down -{_usd(abs(o.realized))} USDC",
        "flat": "Your vault position closed flat",
    }[label]
    item = NotificationItem(
        id=f"out:{o.tx_hash}:{o.log_index}", category="outcomeUpdates", type="outcome_closed",
        title=f"Outcome: {label.capitalize()}", body=body, icon=icon,
        tsApprox=dt.isoformat(), txHash=o.tx_hash, href="/outcomes", unread=False,
    )
    return dt, o.block_number, item


def _reverted_notif(e: ExecutionRow) -> _Derived:
    action = _ACTION_LABEL.get(e.action_kind, e.action_kind.replace("_", " ").capitalize())
    reason = (e.reverted_reason or "Nothing moved — the transaction reverted on-chain.").strip()
    item = NotificationItem(
        id=f"rev:{e.intent_bundle_id}", category="txResults", type="tx_reverted",
        title=f"{action} reverted", body=reason[:200], icon="alert",
        tsApprox=e.updated_at.isoformat(), txHash=e.tx_hash, href="/portfolio", unread=False,
    )
    return e.updated_at, None, item  # None ⇒ unread keyed by updated_at (a real wall-clock time)


_EXPIRING_SOON = timedelta(hours=24)  # warn when a grant is within this of its hard expiry
_CAP_NEAR_BPS = 9000  # spent ≥ 90% of the cumulative cap → "nearly reached"


def _session_key_notif(r: SessionKeyRow, now: datetime) -> _Derived | None:
    """At most ONE sessionKeyExpiry notification per grant (priority: revoked > expired > expiring >
    cap-near). Keyed by wall-clock (block=None). Every field is derived from the real `session_keys`
    row (a mirror of the on-chain grant) — never fabricated (III). None ⇒ healthy, no alert.
    """
    base = f"ske:{r.session_pubkey}"
    if r.status == "revoked" or r.revoked_tx_hash is not None:
        return r.updated_at, None, NotificationItem(
            id=f"{base}:revoked", category="sessionKeyExpiry", type="session_key_revoked",
            title="Automation key revoked",
            body="Your session key was revoked — Sparky can no longer act for you.",
            icon="alert", tsApprox=r.updated_at.isoformat(), href="/automation", unread=False,
        )
    if now >= r.valid_until:
        return r.valid_until, None, NotificationItem(
            id=f"{base}:expired", category="sessionKeyExpiry", type="session_key_expired",
            title="Automation key expired",
            body="Your session key has expired. Re-authorize to keep hands-off rebalancing on.",
            icon="clock", tsApprox=r.valid_until.isoformat(), href="/automation", unread=False,
        )
    if r.valid_until - now <= _EXPIRING_SOON:
        warn_dt = r.valid_until - _EXPIRING_SOON
        return warn_dt, None, NotificationItem(
            id=f"{base}:expiring", category="sessionKeyExpiry", type="session_key_expiring",
            title="Automation key expiring soon",
            body="Your session key expires within 24 hours. Re-authorize to avoid a pause.",
            icon="clock", tsApprox=warn_dt.isoformat(), href="/automation", unread=False,
        )
    if r.cumulative_cap_raw > 0 and r.spent_raw * 10_000 >= r.cumulative_cap_raw * _CAP_NEAR_BPS:
        return r.updated_at, None, NotificationItem(
            id=f"{base}:capnear", category="sessionKeyExpiry", type="session_key_cap_near",
            title="Automation spending cap nearly reached",
            body=f"Your session key has used {_usd(r.spent_raw)} of "
            f"{_usd(r.cumulative_cap_raw)} USDC.",
            icon="alert", tsApprox=r.updated_at.isoformat(), href="/automation", unread=False,
        )
    return None


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/notifications", response_model=NotificationsResponse)
async def get_notifications(
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    flows: Annotated[VaultFlowReader, Depends(get_vault_flow_reader)],
    config: Annotated[AgentConfig, Depends(get_agent_config)],
    exec_store: Annotated[ExecutionStore, Depends(get_execution_store)],
    read_store: Annotated[NotificationReadStore, Depends(get_notif_read_store)],
    session_store: Annotated[SessionKeyStore, Depends(get_session_key_store)],
) -> NotificationsResponse:
    """The user's real in-app notifications, newest first (§3.11, feature 021).

    Derived LIVE from indexed data — vault Deposit/Withdraw flows + realized outcomes + reverted
    executions — so every row is provable (a tx hash / DB row), never fabricated. Advisory read: a
    degraded read yields a partial or empty feed (fail-open), never a hard error and never on the
    withdraw/exit path (N2). Unread is computed against the per-user read cursor.
    """
    position = await _read_position(reader, account)
    derived: list[_Derived] = []

    # 1. Reverted/dropped executions — the alert the flow index can't carry (a revert has no event).
    try:
        execs = await exec_store.list_by_account(account.account, limit=_EXEC_LIMIT)
    except Exception:  # noqa: BLE001 — advisory; a store outage degrades the feed, never 500s
        execs = []
    derived.extend(_reverted_notif(e) for e in execs if e.status in _REVERTED_STATES)

    # 2. Vault Deposit/Withdraw flows + realized outcomes (only when the vault read is live).
    hist: list[FlowRow] = []
    if not position.stale and config.vault_address:
        try:
            hist = await flows.list_flows(
                _network_id(account.chain_id), config.vault_address, account.account,
                limit=_FLOW_LIMIT,
            )
        except Exception:  # noqa: BLE001 — advisory; index outage degrades the feed
            hist = []
    derived.extend(_flow_notif(f, position.block) for f in hist)
    replay = replay_outcomes(hist, position.shares) if hist else None
    if replay is not None and replay.reconciles:
        derived.extend(_outcome_notif(o, position.block) for o in replay.outcomes)

    # 3. Session-key lifecycle (feature 022): expiring / expired / revoked / cap-near, from the
    #    session_keys mirror. Standing conditions ⇒ derive-on-read, fail-open like the blocks above.
    now = datetime.now(UTC)
    try:
        keys = await session_store.list_by_account(account.account)
    except Exception:  # noqa: BLE001 — advisory; a store outage just omits these rows
        keys = []
    for r in keys:
        notif = _session_key_notif(r, now)
        if notif is not None:
            derived.append(notif)

    # Newest-first, capped.
    derived.sort(key=lambda d: d[0], reverse=True)
    derived = derived[:_FEED_LIMIT]

    # Unread vs the per-user read cursor (fail-open: no cursor / outage ⇒ treat all as unread). A
    # chain event (block is not None) is read once its block <= last_read_block — a STABLE key that
    # can't re-flag on a re-read; an execution row keys off its real updated_at.
    try:
        cursor = await read_store.get(account.account)
    except Exception:  # noqa: BLE001 — advisory; a read-cursor outage never blocks the feed
        cursor = None
    items: list[NotificationItem] = []
    unread_count = 0
    for dt, block, item in derived:
        if cursor is None:
            is_unread = True
        elif block is not None:
            is_unread = block > cursor.last_read_block
        else:
            is_unread = dt > cursor.last_read_at
        if is_unread:
            unread_count += 1
        items.append(item.model_copy(update={"unread": is_unread}))

    return NotificationsResponse(
        asOf=datetime.now(UTC).isoformat(),
        asOfBlock=position.block,
        stale=position.stale,
        unreadCount=unread_count,
        notifications=items,
    )


@router.post("/notifications/read", response_model=MarkReadResponse)
async def mark_notifications_read(
    account: Annotated[AccountContext, Depends(get_account)],
    reader: Annotated[VaultReader, Depends(get_vault_reader)],
    read_store: Annotated[NotificationReadStore, Depends(get_notif_read_store)],
) -> MarkReadResponse:
    """Advance the per-user read cursor: mark everything currently shown as read (§3.11).

    Sets ``last_read_at = now`` (execution rows) and ``last_read_block = the current head`` (chain
    events). A degraded head read passes block ``0`` — the store ``GREATEST`` keeps the prior block
    cursor rather than un-reading (honest fail-open). Advisory write (N2): a store outage returns
    ``ok:false`` (the badge won't clear this time), never a hard error; it never gates anything.
    """
    now = datetime.now(UTC)
    position = await _read_position(reader, account)  # for the current head block (never raises)
    try:
        await read_store.mark_read(account.account, now, position.block)
    except Exception:  # noqa: BLE001 — advisory; a failed mark just leaves the badge, never 500s
        return MarkReadResponse(ok=False, readAt=None)
    return MarkReadResponse(ok=True, readAt=now.isoformat())
