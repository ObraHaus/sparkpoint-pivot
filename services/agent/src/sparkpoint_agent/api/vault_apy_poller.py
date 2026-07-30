"""Background APY poller for registry vaults (feature 024 Phase 4, T051).

WHY A POLLER AND NOT A READ-THROUGH CACHE. Morpho's API is rate-limited and sustained abuse
reportedly triggers a long (reported: week-scale) cooldown. A request-path read would scale with
traffic and could take the feed down for everyone, so the API is touched from exactly one place, on
a
fixed schedule, with an advisory lock so overlapping instances do not multiply the call rate. Every
consumer reads the resulting `vault_apy_snapshots` rows instead — `GET /admin/vault-registry`
already
returns them via ``store.latest_apy``, so nothing else needs a new endpoint.

HONESTY IS THE POINT OF THIS MODULE, NOT A CONSTRAINT ON IT. On Base Sepolia — the chain we actually
run on — Morpho's API serves nothing, so the only row this poller may ever write there is
``source='unavailable'`` with ``net_apy_bps=NULL``. A `0` would be a fabricated yield figure
(Principle III, FR-013), and `0026`'s ``vault_apy_unavailable_is_null`` CHECK refuses it outright,
so
a careless ``net_apy_bps=x or 0`` would simply abort the INSERT and silently leave the table empty.
Writing an explicit "unavailable" snapshot is better than writing nothing: it records that we LOOKED
and could not know, which is a different (and more trustworthy) statement than absence.

FAIL-OPEN EVERYWHERE. A degraded DB, an unapplied `0026`, an unreachable API, or a bad decode all
just skip the tick with a warning. Nothing here can block a deposit and — the invariant that matters
most — nothing here can block a withdrawal (N2). Losing this poller entirely costs a yield figure,
never custody.

It NEVER writes `vault_registry` itself: that table is seeded by a reviewed migration or an operator
(see `db/vault_registry.py`), never by a request handler or a background task.
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from ..db.vault_registry import VaultRegistryStore

logger = logging.getLogger("sparkpoint_agent.api.vault_apy_poller")

#: pg advisory-lock id: serialize a tick across overlapping instances/deploys.
#:
#: Mirrors the ONLY other key in the repo — `notification_poller._POLL_LOCK_KEY = 210_240_021` —
#: whose scheme decodes as ``21_<migration>_<feature>``. This is migration 0026, feature 024, hence
#: 21_0260_024. Reusing 210_240_021 would be a SILENT bug, not an error: both loops fail open, so
#: whichever ticked first would take the lock and the other would log a skip and do nothing,
#: presenting as "the poller sometimes doesn't run" with no error anywhere to find.
_POLL_LOCK_KEY: Final = 210_260_024

#: Default cadence. Deliberately slow: an APY figure an hour stale is still honest and useful, while
#: a tight loop risks the cooldown described above. Rate-limit budget is the scarce resource here.
_DEFAULT_INTERVAL_S: Final = 1800.0
_MIN_INTERVAL_S: Final = 300.0


def _env_on(name: str, default: str = "true") -> bool:
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes"}


def poll_interval_s() -> float:
    """Tick interval from ``SPARKPOINT_VAULT_APY_POLL_INTERVAL_S``, floored at 300s.

    Floored rather than trusted: a misconfigured 1s interval would hammer a rate-limited third-party
    API whose abuse penalty is a long cooldown, and that is not a mistake worth allowing.
    """
    raw = os.getenv("SPARKPOINT_VAULT_APY_POLL_INTERVAL_S", "").strip()
    if not raw:
        return _DEFAULT_INTERVAL_S
    try:
        value = float(raw)
    except ValueError:
        return _DEFAULT_INTERVAL_S
    if value != value or value <= 0:  # NaN or nonsense
        return _DEFAULT_INTERVAL_S
    return max(value, _MIN_INTERVAL_S)


async def poll_once() -> None:
    """One tick: for every registry vault on the configured chain, record an APY snapshot.

    Never raises. Every failure path is a warning + return, because a yield figure is never worth
    faulting the service over.
    """
    # Lazy imports inside the body, matching the other loops: keeps import-time side effects out of
    # module import so a poller dependency can never break app startup.
    from ..config import AgentConfig
    from ..db import get_database
    from ..db.vault_registry import VaultRegistryStore

    if not _env_on("SPARKPOINT_VAULT_APY_POLL_ENABLED", "true"):
        return

    try:
        config = AgentConfig.from_env()
    except Exception:  # noqa: BLE001 — no config ⇒ nothing to poll
        return

    chain_id = config.chain_id
    if not chain_id:
        return

    db = get_database()
    store = VaultRegistryStore(db)

    try:
        async with db.acquire() as conn:
            got = await conn.fetchval("SELECT pg_try_advisory_lock($1)", _POLL_LOCK_KEY)
            if not got:
                logger.info("vault_apy_poll_skipped (another tick holds the lock)")
                return
            try:
                await _poll_chain(store, chain_id)
            finally:
                await conn.execute("SELECT pg_advisory_unlock($1)", _POLL_LOCK_KEY)
    except Exception:  # noqa: BLE001 — advisory; a pool/lock/schema failure just skips this tick
        logger.warning("vault_apy_poll_once_skipped (db/lock degraded)")


async def _poll_chain(store: VaultRegistryStore, chain_id: int) -> None:
    """Snapshot every registry vault on ``chain_id``."""
    from ..data.morpho_api import chain_is_supported, fetch_vault_v2_apy, unavailable

    try:
        vaults = await store.list_vaults(chain_id)
    except Exception:  # noqa: BLE001 — an unapplied 0026 lands here; fail open
        logger.warning("vault_apy_poll_no_registry chain=%s (0026 unapplied or unreachable)",
        chain_id)
        return

    if not vaults:
        return

    # One local check instead of one request per vault: on an unsupported chain we already know the
    # answer, and spending rate-limit budget to be told so would be the one avoidable mistake here.
    supported = chain_is_supported(chain_id)
    if not supported:
        logger.info(
            "vault_apy_poll_unavailable chain=%s vaults=%d (morpho api serves no testnet)",
            chain_id,
            len(vaults),
        )

    for row in vaults:
        address = row.get("vault_address") if isinstance(row, dict) else None
        if not address:
            continue
        protocol = row.get("protocol") if isinstance(row, dict) else None

        if not supported:
            result = unavailable(f"morpho api does not serve chain {chain_id}")
        elif protocol not in ("morpho_vault_v2", "morpho_metamorpho_v1"):
            # An Aave first-party vault's rate comes from the chain, not from Morpho. Recording
            # "unavailable" from THIS source is the honest statement; the Aave path is unaffected.
            result = unavailable(f"no morpho feed for protocol {protocol}")
        else:
            result = await fetch_vault_v2_apy(address=str(address), chain_id=chain_id)

        try:
            await store.insert_apy_snapshot(
                chain_id=chain_id,
                vault_address=str(address),
                source=result.source,
                # With source='unavailable' this MUST be None; the migration's CHECK enforces it,
                # and
                # `unavailable()` is the only constructor for that source, so the two cannot
                # diverge.
                net_apy_bps=result.net_apy_bps,
                tvl_usd=result.tvl_usd,
                liquidity_usd=result.liquidity_usd,
            )
        except Exception:  # noqa: BLE001 — one bad row must not abort the remaining vaults
            logger.warning(
                "vault_apy_snapshot_write_failed chain=%s vault=%s source=%s",
                chain_id,
                address,
                result.source,
            )


async def run_loop() -> None:
    """The forever loop. Cancellation-safe; every other failure is swallowed and retried next
    tick."""
    interval = poll_interval_s()
    logger.info("vault_apy_poller_started interval_s=%s lock_key=%s", interval, _POLL_LOCK_KEY)
    while True:
        try:
            await poll_once()
        except asyncio.CancelledError:
            # MUST precede the broad except, or shutdown gets swallowed and the task never dies.
            raise
        except Exception:  # noqa: BLE001 — a tick failure never kills the loop
            logger.warning("vault_apy_poll_tick_failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
