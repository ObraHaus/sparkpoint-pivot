"""Which vault address this service acts on — env var today, registry when enabled (024 / T032).

Before 024 the service knew exactly ONE vault, resolved from ``SPARKPOINT_VAULT_ADDRESS`` in
``AgentConfig.from_env()``. Supporting Aave + Morpho across Base, Base Sepolia and Robinhood Chain
4663 makes "which vault" a per-row data question, so this module puts the registry in front of that
env read — behind a flag, and fail-open.

THE CONTRACT, IN ORDER OF PRECEDENCE
------------------------------------
1. Flag OFF (the default) ⇒ return ``config.vault_address`` verbatim. Byte-identical to pre-024
   behaviour, with no database round-trip and no new failure mode. This is the state the alpha runs
   in until the operator applies migration 0026 and flips the flag deliberately.
2. Flag ON and the registry names a live first-party vault for this chain ⇒ return that address.
3. Flag ON but the registry is unreachable, unmigrated, or has no row for this chain ⇒ fall back to
   ``config.vault_address`` and log once.

Step 3 is the important one. A registry miss means "the registry does not know", never "there is no
vault": 0026 is additive and may not be applied yet, and the DB is not on the custody path. Failing
CLOSED here would be actively harmful — it would take a working, funded vault offline because a
DISPLAY table was empty, and the whole point of N2 is that a SparkPoint-side decision never stands
between a user and their funds. So this resolver degrades to the env var and stays quiet about it
after the first warning.

WHY IT RETURNS A BARE ADDRESS (Constitution IV.5(d))
----------------------------------------------------
The curated-vault record is an admission/display artifact and MUST NOT leak into the deterministic
policy path. Returning ``str | None`` — the exact shape ``AgentConfig.vault_address`` already has —
means a registry row's contents (its label, fees, status, vetting notes) can never reach
PolicyModule, SessionKeyValidator, or an agent strategy-direction path. Only the address moves, and
an address is what the policy layer already joins on via ``resolved_targets['sparkpoint_vault']``.

CONSISTENCY WITHIN A REQUEST
---------------------------
Resolve ONCE per request and thread the result. Resolving twice inside one request could, in
principle, straddle an operator's registry edit and mix two addresses into a single prepared
transaction — a quote priced against one vault and calldata targeting another. The FastAPI
dependency in ``api/vault.py`` is the single seam for this.
"""

from __future__ import annotations

import logging
import os
from typing import Protocol

from ..config import AgentConfig

logger = logging.getLogger(__name__)

#: Opt-in flag. Read directly rather than through ``AgentConfig.ALLOWED_ENV_KEYS``, matching the
#: precedent set by ``api/admin_vaults.py`` for ``SPARKPOINT_VAULT_FACTORY_ADDRESS``: that allowlist
#: is deliberately confined to the read surface's fixed key set, and ``_assert_no_key_material()``
#: audits it. A behaviour flag is not a read-surface address, so it does not belong there.
VAULT_REGISTRY_ENABLED_ENV = "SPARKPOINT_VAULT_REGISTRY_ENABLED"

#: Set once we have warned about a registry miss, so a persistent miss does not flood the log on
#: every request. Keyed by chain so a second chain still gets its own single warning.
_warned_chains: set[int] = set()


def _env_on(name: str, default: str = "false") -> bool:
    """The service's established flag idiom (mirrors ``api/notification_poller.py::_env_on``)."""
    return os.getenv(name, default).strip().lower() in {"1", "true", "yes"}


def registry_enabled() -> bool:
    """True iff registry resolution is switched on. Defaults to OFF — 0026 may not be applied."""
    return _env_on(VAULT_REGISTRY_ENABLED_ENV)


class FirstPartyVaultResolver(Protocol):
    """The narrow ``VaultRegistryStore`` slice this needs (keeps it DB-agnostic + fakeable)."""

    async def resolve_first_party_vault(self, chain_id: int) -> str | None: ...

    async def count_live_first_party(self, chain_id: int) -> int: ...


async def resolve_vault_address(
    config: AgentConfig,
    store: FirstPartyVaultResolver | None = None,
) -> str | None:
    """The vault address for ``config.chain_id``.

    Returns ``None`` only when BOTH the registry and the env var are empty — i.e. genuinely not
    deployed on this chain, which every caller already handles as fail-closed
    (``VaultUnavailable(NOT_DEPLOYED)``). Never raises: a registry failure degrades to the env var,
    because a display table must not be able to take the vault offline.
    """
    env_address = config.vault_address

    if not registry_enabled() or store is None:
        return env_address

    chain_id = config.chain_id
    try:
        resolved = await store.resolve_first_party_vault(chain_id)
    except Exception:  # noqa: BLE001 - deliberately broad: no DB fault may break vault resolution
        if chain_id not in _warned_chains:
            _warned_chains.add(chain_id)
            logger.warning(
                "vault registry lookup failed for chain %s; falling back to %s. "
                "Is migration 0026 applied?",
                chain_id,
                VAULT_REGISTRY_ENABLED_ENV.replace("_REGISTRY_ENABLED", "_ADDRESS"),
                exc_info=True,
            )
        return env_address

    if resolved is None:
        if chain_id not in _warned_chains:
            _warned_chains.add(chain_id)
            logger.warning(
                "vault registry has no live first-party vault for chain %s; "
                "falling back to the SPARKPOINT_VAULT_ADDRESS value (%s).",
                chain_id,
                "set" if env_address else "unset",
            )
        return env_address

    # An ambiguous registry is a data error, not a reason to refuse. We already picked the oldest
    # row deterministically; say so loudly so it gets fixed, and keep serving.
    try:
        live_count = await store.count_live_first_party(chain_id)
        if live_count > 1:
            logger.error(
                "vault_registry has %d live first-party rows for chain %s — expected 1. "
                "Serving the oldest (%s). Fix the registry.",
                live_count,
                chain_id,
                resolved,
            )
    except Exception:  # noqa: BLE001 - the ambiguity CHECK is diagnostic only, never load-bearing
        logger.debug("vault_registry ambiguity check failed for chain %s", chain_id, exc_info=True)

    if env_address is not None and resolved.lower() != env_address.lower():
        logger.info(
            "vault registry resolved chain %s to %s, overriding SPARKPOINT_VAULT_ADDRESS %s.",
            chain_id,
            resolved,
            env_address,
        )
    return resolved


def reset_warning_state() -> None:
    """Clear the one-warning-per-chain memo. For tests only."""
    _warned_chains.clear()
