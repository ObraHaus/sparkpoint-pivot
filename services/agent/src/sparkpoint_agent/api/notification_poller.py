"""Background poller for edge-triggered notifications (feature 021 phase 2).

Phase 1 derives notifications from indexed data on read. These three watch for a CHANGE over time,
so they can't be derived on read — a poller observes the value each tick and EMITS a real event only
when it genuinely changes (edge-triggered via ``notification_poller_state``), deduped so it never
repeats:

  - **Vault near capacity** (``capsNearLimit``): live ``total_assets`` vs the deposit cap crosses a
    threshold (up). One event per crossing episode.
  - **Aave rate moved** (``rateChanges``): the live Aave USDC supply APY moves >= a bps threshold
    from the last observation.
  - **New recommendation** (``rateChanges``): a proactive re-score of each active-mandate wallet
    whose TOP cleared recommendation changes (by content ``dedupe_key``). Costs one recommender
    (LLM) call per wallet per run — gated by ``NOTIF_POLLER_NEWRECS`` and bounded per tick.

Every reading is a REAL on-chain / model value at a real time — never fabricated (Principle III).

NON-CUSTODY (N1/N2/N3/N5): advisory only — no key, no signature, off the request path, never on the
withdraw/exit path (N2). Every detector is fail-open: any error is logged and swallowed so a poll
failure never crashes the agent, never blocks anything, and just means that alert doesn't fire.
"""

from __future__ import annotations

import logging
import os
from collections.abc import Iterable
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from ..chain import VaultReader
    from ..chain.aave_rate import AavePoolReader
    from ..config import AgentConfig
    from ..db.notification_events import NotificationEventStore
    from ..db.pool import Database

logger = logging.getLogger("sparkpoint_agent.api.notification_poller")

_CAP_NEAR_BPS = 9_000  # >= 90% of the deposit cap → "near capacity" (arm the alert)
_CAP_REARM_BPS = 8_500  # must fall below 85% before the alert re-arms (hysteresis vs boundary spam)
_RATE_MOVE_BPS = 25  # a >= 0.25% APY move from the last-notified level is notify-worthy
_NEWREC_WALLET_CAP = 20  # bound the per-run LLM cost (wallets re-scored per tick)
_POLL_LOCK_KEY = 210_240_021  # pg advisory-lock id: serialize poll_once across overlapping polls


def _env_on(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes"}


def _pct_from_bps(bps: int) -> str:
    """bps → a percent string, e.g. ``430`` → ``"4.30"`` (exact int math, no float drift)."""
    sign = "-" if bps < 0 else ""
    b = abs(bps)
    return f"{sign}{b // 100}.{b % 100:02d}"


def _fill_bps(total_assets: int, cap: int) -> int:
    """The vault fill as bps of the deposit cap (0 when the cap is 0). Exact int math."""
    return (total_assets * 10_000) // cap if cap > 0 else 0


async def poll_caps(reader: VaultReader, store: NotificationEventStore) -> None:
    """Emit a "vault near capacity" event when the fill crosses ``_CAP_NEAR_BPS`` upward.

    Fill = live ``totalAssets`` / the vault's on-chain ``depositCap`` (the SAME ratio the admin TVL
    utilization uses) — NOT the policy per-action guardrail. An uncapped vault (cap 0) never "near".

    Hysteresis: once armed (≥90%), the episode only ENDS when fill falls below ``_CAP_REARM_BPS``
    (85%), so ordinary deposit/withdraw churn around the 90% line can't re-fire the protocol-wide
    alert. First observation is a silent baseline (never alert an already-full vault on a crossing
    the poller never witnessed) — consistent with poll_rate / poll_new_recs.
    """
    try:
        cap = int(await reader.deposit_cap())
        fill = _fill_bps(int(await reader.total_assets()), cap)
        st = await store.get_state("cap:vault")
        seq = int(st.txt) if (st and st.txt and st.txt.isdigit()) else 0
        if st is None:
            # Silent baseline: record whether we START inside the band, never emit on first sight.
            start = 1 if fill >= _CAP_NEAR_BPS else 0
            await store.set_state("cap:vault", num=start, txt=str(seq))
            return
        was_near = st.num == 1
        if not was_near and fill >= _CAP_NEAR_BPS:
            seq += 1  # crossed UP into the band → one alert for this episode
            await store.emit(
                category="capsNearLimit", type="vault_near_capacity",
                title="Vault nearing capacity",
                body=f"The vault is {fill // 100}% full — new deposits may be capped soon.",
                icon="alert", href="/vault", dedupe_key=f"cap:vault:near:{seq}",
            )
            await store.set_state("cap:vault", num=1, txt=str(seq))
        elif was_near and fill < _CAP_REARM_BPS:
            # Dropped clear of the hysteresis band → episode ends, re-arm silently.
            await store.set_state("cap:vault", num=0, txt=str(seq))
        # else: inside the 85–90% hysteresis zone, or still ≥90% → hold state, no emit, no churn.
    except Exception:  # noqa: BLE001 — advisory poller; a read failure just skips this signal
        logger.warning("notif_poll_caps_skipped (chain/store degraded)")


async def poll_rate(reader: AavePoolReader, asset: str, store: NotificationEventStore) -> None:
    """Emit an "Aave rate moved" event when the live supply APY moves >= ``_RATE_MOVE_BPS``."""
    try:
        new_bps = int(await reader.supply_apy_bps(asset))
        st = await store.get_state("rate:aave")
        last = st.num if st else None
        # A monotonic emit counter (in txt) keys each move uniquely, so a later genuine move BACK to
        # a previously-notified value still notifies (a bare value key would suppress it forever).
        seq = int(st.txt) if (st and st.txt and st.txt.isdigit()) else 0
        if last is None:
            # Baseline: record the first observation, don't emit.
            await store.set_state("rate:aave", num=new_bps, txt=str(seq))
            return
        if abs(new_bps - last) >= _RATE_MOVE_BPS:
            seq += 1
            direction = "up to" if new_bps > last else "down to"
            await store.emit(
                category="rateChanges", type="rate_moved",
                title="Aave USDC rate moved",
                body=f"The Aave USDC supply rate moved {direction} {_pct_from_bps(new_bps)}%.",
                icon="activity", href="/strategies", dedupe_key=f"rate:aave:{seq}",
            )
            await store.set_state("rate:aave", num=new_bps, txt=str(seq))
    except Exception:  # noqa: BLE001 — advisory poller; a degraded rate read just skips this signal
        logger.warning("notif_poll_rate_skipped (rate read degraded)")


def _cleared_kinds(items: Iterable[object]) -> list[str]:
    """The sorted set of distinct strategy KINDS across a wallet's cleared recommendations.

    Keying the new-rec signal on this (not the LLM-ranked TOP rec) is what makes it STABLE: the
    recommender's candidate ORDER — which one is "top" — is LLM-generated and jitters run-to-run
    (the US5/T010 finding), while the SET of policy-cleared kinds is deterministic. Dropping the
    suggested amount too means a balance tick never spams. So we notify on a genuinely new KIND of
    opportunity, never on cosmetic reordering.
    """
    kinds = {str(getattr(it, "strategyKind", "")) for it in items}
    return sorted(k for k in kinds if k)


async def poll_new_recs(db: Database, config: AgentConfig, store: NotificationEventStore) -> None:
    """Re-score each active-mandate wallet; emit "new recommendation" when a NEW kind clears.

    Costs one recommender (LLM) call per wallet — gated by ``NOTIF_POLLER_NEWRECS`` (default on) and
    bounded to ``_NEWREC_WALLET_CAP`` per run. The trigger is the sorted SET of cleared kinds
    (see :func:`_cleared_kinds`), so LLM ranking/amount jitter can't produce a false alert; we emit
    only when a kind appears that wasn't there last tick. A monotonic ``num`` seq keys each emit
    uniquely (a kind that leaves then returns re-notifies). Fully fail-open per wallet.
    """
    if not _env_on("NOTIF_POLLER_NEWRECS"):
        return
    # Lazy imports (heavy; also keeps the api→api dependency inside the fn, like the indexer loop).
    from ..chain import VaultReader
    from ..db.mandates import PgMandateStore
    from ..llm import AsyncClaudeClient
    from .recommendations import _compute, _network_id, _StoreMandateProvider
    from .security import AccountContext

    try:
        mandate_store = PgMandateStore(db)
        network_id = _network_id(config.chain_id)
        # Rotate through ALL active-mandate wallets across ticks (a stable ORDER BY + a fixed LIMIT
        # would permanently starve wallets past the cap). The cursor is a plain offset in the state.
        cur = await store.get_state("newrec:cursor")
        offset = cur.num if (cur and cur.num is not None and cur.num > 0) else 0
        owners = await mandate_store.list_active_owners(
            network_id=network_id, limit=_NEWREC_WALLET_CAP, offset=offset
        )
        if not owners and offset > 0:
            offset = 0  # ran past the end → wrap to the front this tick
            owners = await mandate_store.list_active_owners(
                network_id=network_id, limit=_NEWREC_WALLET_CAP, offset=0
            )
        if not owners:
            return
        # Advance the cursor: a short page means we reached the end → wrap next tick.
        next_offset = 0 if len(owners) < _NEWREC_WALLET_CAP else offset + len(owners)
        await store.set_state("newrec:cursor", num=next_offset)
        reader = VaultReader.from_config(config)
        llm = AsyncClaudeClient.from_env()
        provider = _StoreMandateProvider(mandate_store)
    except Exception:  # noqa: BLE001 — can't set up ⇒ skip the whole signal this tick (fail-open)
        logger.warning("notif_poll_newrecs_setup_skipped")
        return

    for owner in owners:
        try:
            # EOA-direct mode: account == owner (the connected EOA holds the position). The emit
            # keys the event on `owner` and the feed queries by `account.account`; they coincide
            # today. When ERC-4337 smart accounts land (US6), account != owner — the whole re-score
            # + emit key must become account-aware then (see docs/phase-3-deferred / US6 handover).
            account = AccountContext(account=owner, owner=owner, chain_id=config.chain_id)
            _result, items = await _compute(account, reader, config, llm, provider, limit=25)
            kinds = _cleared_kinds(items)
            if not kinds:
                continue  # nothing cleared policy → nothing to notify (don't baseline an empty set)
            new_txt = "|".join(kinds)
            state_key = f"newrec:{owner.lower()}"
            st = await store.get_state(state_key)
            seq = st.num if (st and st.num is not None) else 0
            if st is None or not st.txt:
                # First observation for this wallet: baseline the kind set, don't notify old advice.
                await store.set_state(state_key, num=seq, txt=new_txt)
                continue
            old_kinds = set(st.txt.split("|"))
            added = set(kinds) - old_kinds
            if added:
                seq += 1
                await store.emit(
                    wallet=owner, category="rateChanges", type="new_recommendation",
                    title="A new recommendation for you",
                    body="A new opportunity matched to your goals is ready — see Strategies.",
                    icon="spark", href="/strategies", dedupe_key=f"newrec:{owner.lower()}:{seq}",
                )
                await store.set_state(state_key, num=seq, txt=new_txt)
            elif new_txt != st.txt:
                # The kind set changed only by a REMOVAL → update the baseline silently (never tell
                # a wallet it has *fewer* opportunities).
                await store.set_state(state_key, num=seq, txt=new_txt)
        except Exception:  # noqa: BLE001 — one wallet's failure never affects the others (fail-open)
            logger.warning("notif_poll_newrecs_wallet_skipped")


async def _run_detectors(config: AgentConfig, db: Database, store: NotificationEventStore) -> None:
    from ..chain import VaultReader

    reader = VaultReader.from_config(config)
    await poll_caps(reader, store)
    if config.rpc_url and config.aave_pool_address and config.aave_reserve_usdc_address:
        from ..chain.aave_rate import AavePoolReader
        from ..chain.vault_reader import HttpxJsonRpcTransport

        aave = AavePoolReader(
            pool_address=config.aave_pool_address,
            transport=HttpxJsonRpcTransport(config.rpc_url),
        )
        await poll_rate(aave, config.aave_reserve_usdc_address, store)
    await poll_new_recs(db, config, store)


async def poll_once() -> None:
    """Run all three detectors once (fail-open). Called by the background loop in ``main.py``.

    Guarded by a Postgres advisory lock so two overlapping poll passes (e.g. an old container
    mid-poll while a redeploy boots a new one) can't run the read-modify-write on ``poller_state``
    concurrently — which could regress a seq counter and drop a real emit, or double-insert. A pass
    that can't take the lock simply skips this tick (it'll poll on the next one).
    """
    from ..config import AgentConfig
    from ..db import NotificationEventStore, get_database

    try:
        config = AgentConfig.from_env()
    except Exception:  # noqa: BLE001
        return
    if not (config.vault_address and config.rpc_url):
        return  # no vault/RPC configured on this deployment → nothing to poll
    db = get_database()
    store = NotificationEventStore(db)
    try:
        async with db.acquire() as conn:
            got = await conn.fetchval("SELECT pg_try_advisory_lock($1)", _POLL_LOCK_KEY)
            if not got:
                logger.info("notif_poll_skipped (another poll holds the lock)")
                return
            try:
                await _run_detectors(config, db, store)
            finally:
                await conn.execute("SELECT pg_advisory_unlock($1)", _POLL_LOCK_KEY)
    except Exception:  # noqa: BLE001 — advisory; a pool/lock failure just skips this tick (fail-open)
        logger.warning("notif_poll_once_skipped (db/lock degraded)")
