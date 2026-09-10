"""Typed, fail-closed configuration for the SparkPoint vault read surface (T030, backend half).

This is the single loader the vault chain-read client + the /vault/quote endpoints +
the fee indexer read their environment through. It validates ONLY the vars the vault
surface needs and exposes fail-closed getters:

  - ``DATABASE_URL``            — the derived-index Postgres DSN (db/config.py owns the pool).
  - the RPC url                 — ``SPARKPOINT_RPC_URL`` override, else the var belonging to THAT
                                  chain and only that chain (023): ``BASE_MAINNET_RPC_URL`` (8453),
                                  ``BASE_SEPOLIA_RPC_URL`` (84532), ``SIM_FORK_RPC_URL`` (31337),
                                  ``ROBINHOOD_RPC_URL`` (46630, public default). There is NO
                                  cross-chain fallback: an unconfigured chain fails closed rather
                                  than serving another chain's state (see ``_CHAIN_RPC_ENVS``).
  - ``SPARKPOINT_VAULT_ADDRESS`` — OPTIONAL. Undefined ⇒ the vault is not deployed on this
                                  chain; every getter that needs it fails closed and the
                                  endpoints return a clean "vault not deployed" envelope —
                                  NEVER a fabricated quote (mirrors packages/shared/src/
                                  addresses/*.ts, where ``vault`` is ``undefined`` pre-deploy).
  - ``CHAIN_ID``                — one of policy.SUPPORTED_CHAIN_IDS
                                  (8453 · 84532 · 31337 · 46630).

NON-CUSTODY (N1/N3): this loader is PROVABLY keyless. It reads only the fixed
``ALLOWED_ENV_KEYS`` allowlist; the module-load guard ``_assert_no_key_material``
rejects any key-bearing name in that allowlist. The service holds no private key and
never reads ``*_PRIVATE_KEY`` / ``*_SECRET`` / ``*_MNEMONIC`` — a compromised env still
cannot make this surface sign or move funds. The guard is a real runtime check (not an
``assert``, which ``python -O`` could strip) so it can never be silently disabled.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass, replace

from .policy import SUPPORTED_CHAIN_IDS

# ── Env var names (the ONLY keys this loader is ever permitted to read) ──────────
DATABASE_URL_ENV = "DATABASE_URL"
CHAIN_ID_ENV = "CHAIN_ID"
VAULT_ADDRESS_ENV = "SPARKPOINT_VAULT_ADDRESS"
FEE_WALLET_ADDRESS_ENV = "FEE_WALLET_ADDRESS"  # 014 — fee-treasury Safe address of record (PUBLIC)
RPC_URL_ENV = "SPARKPOINT_RPC_URL"  # explicit override; wins over the chain-specific vars
SIM_FORK_RPC_URL_ENV = "SIM_FORK_RPC_URL"
BASE_SEPOLIA_RPC_URL_ENV = "BASE_SEPOLIA_RPC_URL"
# 023 — Base MAINNET (8453) gets its own var. Mainnet MUST be configured explicitly: there is no
# fallback to the fork or to Sepolia (see _CHAIN_RPC_ENVS), so a missing value fails closed rather
# than silently serving another chain's state as mainnet.
BASE_MAINNET_RPC_URL_ENV = "BASE_MAINNET_RPC_URL"
ROBINHOOD_RPC_URL_ENV = "ROBINHOOD_RPC_URL"  # §B3 Robinhood testnet (46630); keyless public default
# §B Robinhood MAINNET (4663); ARCHIVE only, NO public default.
ROBINHOOD_MAINNET_RPC_URL_ENV = "ROBINHOOD_MAINNET_RPC_URL"
AAVE_POOL_ADDRESS_ENV = (
    "AAVE_POOL_ADDRESS"  # 017 — Aave v3 Pool for the live USDC supply-APY read (PUBLIC)
)
AAVE_RESERVE_USDC_ADDRESS_ENV = (
    "AAVE_RESERVE_USDC_ADDRESS"  # 017 — the reserve asset for getReserveData (PUBLIC)
)

# §B3 — the keyless public Robinhood testnet RPC, used when ROBINHOOD_RPC_URL is unset. The chain
# has no official Aave/USDC (vault stays Base-only); powers read-only chat + wallet balance only.
ROBINHOOD_TESTNET_CHAIN_ID = 46630
_ROBINHOOD_PUBLIC_RPC = "https://rpc.testnet.chain.robinhood.com"

# §B — Robinhood MAINNET (4663). Unlike the testnet there is NO keyless public default: the public
# mainnet RPC prunes state after ~3h and breaks history/fork reads, so 4663 MUST be given an
# explicit ARCHIVE endpoint (ROBINHOOD_MAINNET_RPC_URL) — it fails closed if unset.
ROBINHOOD_MAINNET_CHAIN_ID = 4663

# Default to Base mainnet (8453) — the chainId the live SIM_FORK_RPC_URL reports.
DEFAULT_CHAIN_ID = 8453

# The closed allowlist of env vars this loader may EVER touch (non-custody surface).
ALLOWED_ENV_KEYS: frozenset[str] = frozenset(
    {
        DATABASE_URL_ENV,
        CHAIN_ID_ENV,
        VAULT_ADDRESS_ENV,
        FEE_WALLET_ADDRESS_ENV,
        RPC_URL_ENV,
        SIM_FORK_RPC_URL_ENV,
        BASE_SEPOLIA_RPC_URL_ENV,
        BASE_MAINNET_RPC_URL_ENV,
        ROBINHOOD_RPC_URL_ENV,
        ROBINHOOD_MAINNET_RPC_URL_ENV,
        AAVE_POOL_ADDRESS_ENV,
        AAVE_RESERVE_USDC_ADDRESS_ENV,
    }
)

# Substrings that mark a name as key-bearing; none may appear in ALLOWED_ENV_KEYS.
_FORBIDDEN_ENV_SUBSTRINGS: tuple[str, ...] = (
    "PRIVATE",
    "PRIVKEY",
    "SECRET",
    "MNEMONIC",
    "SEED_PHRASE",
    "SIGNING_KEY",
)

_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


class ConfigError(RuntimeError):
    """Fail-closed configuration error: a required value is missing or malformed.

    Distinct from ``chain.VaultUnavailable`` (an operational/expected outage). A
    ``ConfigError`` means the deploy is misconfigured and should fail loudly.
    """


def _assert_no_key_material() -> None:
    """Prove (at import) that the read allowlist contains no key-bearing name.

    A real runtime check — NOT an ``assert`` — so ``python -O`` can never strip this
    non-custody guarantee. Raises ``RuntimeError`` if the allowlist ever regresses.
    """
    for key in ALLOWED_ENV_KEYS:
        upper = key.upper()
        for bad in _FORBIDDEN_ENV_SUBSTRINGS:
            if bad in upper:
                raise RuntimeError(
                    f"config env allowlist leak: {key!r} looks key-bearing "
                    f"(matched {bad!r}); the vault read surface must be keyless (N1/N3)."
                )


_assert_no_key_material()


def _normalize_address(value: str, field: str) -> str:
    """Validate a 20-byte hex address and return it lowercased (checksum-agnostic).

    Lowercasing is deliberate: it keeps the value comparable to eth_abi's decoded
    output and avoids any keccak checksum dependency. A malformed address raises
    ``ConfigError`` (fail-closed) rather than becoming a silently fabricated target.
    """
    if not _ADDRESS_RE.match(value):
        raise ConfigError(f"{field} is not a 20-byte 0x address: {value!r}")
    return value.lower()


# 023 — per-chain RPC candidates. Each chain lists ONLY env vars that can legitimately serve THAT
# chain, so there is no cross-chain fallback in either direction. ``RPC_URL_ENV`` is the explicit
# per-deployment override and stays first everywhere.
#
# WHY (the defect this closes): the previous order resolved 8453 as
# ``SPARKPOINT_RPC_URL → SIM_FORK_RPC_URL → BASE_SEPOLIA_RPC_URL``, so a mainnet deployment missing
# one env var read the Anvil fork — or Base Sepolia — and presented it as mainnet. Cap headroom,
# ``paused()``, ``totalAssets()`` and the ERC-4626 previews all feed ``policy.evaluate()`` while the
# built calldata still targets the MAINNET vault from env, so the failure mode was a bundle approved
# against one chain's state and signed on another. The 84532 order had the mirror-image bug (a
# Base-mainnet fork could be served as Sepolia). A missing value now fails CLOSED instead.
# ⚠️ ADDING A CHAIN: give it an entry here. Constitution v3.0.0 (2026-07-30) ratified **Robinhood
# Chain mainnet 4663** as in-scope. It is still absent from ``policy.SUPPORTED_CHAIN_IDS`` and the
# api ``API_SUPPORTED_CHAIN_IDS`` (the agent still rejects X-Chain-Id 4663 — feature D flips that),
# but §B gives it its RPC row below: data plane before capability plane, so when 4663 is later
# accepted the 023 chain-identity probe binds to the RIGHT archive endpoint instead of latching a
# MISMATCH on the global fallback.
_CHAIN_RPC_ENVS: dict[int, tuple[str, ...]] = {
    8453: (RPC_URL_ENV, BASE_MAINNET_RPC_URL_ENV),  # Base mainnet — explicit only
    84532: (RPC_URL_ENV, BASE_SEPOLIA_RPC_URL_ENV),  # Base Sepolia
    31337: (RPC_URL_ENV, SIM_FORK_RPC_URL_ENV),  # local Anvil fork of Base mainnet
    # §B Robinhood MAINNET — ARCHIVE only, NO public fallback (the public node prunes state); a
    # missing value fails closed rather than serving pruned / other-chain state as mainnet.
    ROBINHOOD_MAINNET_CHAIN_ID: (RPC_URL_ENV, ROBINHOOD_MAINNET_RPC_URL_ENV),
}


def rpc_env_candidates(chain_id: int) -> tuple[str, ...]:
    """The env var NAMES that may supply ``chain_id``'s RPC url, in precedence order.

    Names only — never values — so this is safe to interpolate into an error message or a log line.
    """
    if chain_id == ROBINHOOD_TESTNET_CHAIN_ID:
        return (RPC_URL_ENV, ROBINHOOD_RPC_URL_ENV)
    return _CHAIN_RPC_ENVS.get(chain_id, (RPC_URL_ENV,))


def _resolve_rpc_url(source: Mapping[str, str], chain_id: int) -> str | None:
    """Pick the RPC url for ``chain_id`` from that chain's OWN candidates (023).

    Returns ``None`` when nothing is configured for this chain (the getter fails closed on use). A
    url configured for a DIFFERENT chain is never substituted — see ``_CHAIN_RPC_ENVS``.
    """
    if chain_id == ROBINHOOD_TESTNET_CHAIN_ID:  # §B3 Robinhood testnet (46630)
        # Explicit override wins; else the keyless public RPC (this chain needs no key).
        return source.get(RPC_URL_ENV) or source.get(ROBINHOOD_RPC_URL_ENV) or _ROBINHOOD_PUBLIC_RPC
    for name in rpc_env_candidates(chain_id):
        value = source.get(name)
        if value:
            return value
    return None


@dataclass(frozen=True, slots=True)
class AgentConfig:
    """Immutable, validated config for the vault read surface. Holds NO key material."""

    chain_id: int
    rpc_url: str | None
    vault_address: str | None  # None ⇒ vault not deployed on this chain (fail-closed)
    database_url: str | None
    # 014 — the fee-treasury Safe (address of record). PUBLIC, non-key; where protocol fees land.
    # Informational only: the agent never moves funds, so this is display/audit, never a fund path.
    fee_wallet_address: str | None = None
    # 017 — Aave v3 Pool + the reserve asset (USDC) for the live supply-APY read. PUBLIC, non-key,
    # view-only. Unset ⇒ the recommender's APY stays None (honest legacy behavior, no fabrication).
    aave_pool_address: str | None = None
    aave_reserve_usdc_address: str | None = None

    @property
    def vault_deployed(self) -> bool:
        """True iff ``SPARKPOINT_VAULT_ADDRESS`` was set (a concrete on-chain target exists)."""
        return self.vault_address is not None

    def require_rpc_url(self) -> str:
        """The RPC url, or fail closed — naming THIS chain's real candidates (023).

        The message lists only the env var NAMES valid for ``chain_id`` (never a value), so an
        operator standing up a new chain is told exactly what to set instead of being pointed at a
        variable that would silently serve a different chain.
        """
        if not self.rpc_url:
            names = " / ".join(rpc_env_candidates(self.chain_id))
            raise ConfigError(
                f"no RPC url configured for chain {self.chain_id} — set one of: {names}. "
                "There is no fallback to another chain's RPC (023)."
            )
        return self.rpc_url

    def require_vault_address(self) -> str:
        """The vault address, or fail closed (vault-not-deployed)."""
        if self.vault_address is None:
            raise ConfigError(
                f"SPARKPOINT_VAULT_ADDRESS is unset — the vault is not deployed on chain "
                f"{self.chain_id}; the quote surface fails closed (no fabricated quote)."
            )
        return self.vault_address

    def require_database_url(self) -> str:
        """The Postgres DSN, or fail closed."""
        if not self.database_url:
            raise ConfigError(f"{DATABASE_URL_ENV} is not set; the derived-index DSN is required.")
        return self.database_url

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> AgentConfig:
        """Build config from the process environment (or an injected mapping, for tests).

        Reads ONLY ``ALLOWED_ENV_KEYS`` (keyless by construction). ``CHAIN_ID`` defaults
        to :data:`DEFAULT_CHAIN_ID` and must be a supported chain; a present-but-malformed
        ``SPARKPOINT_VAULT_ADDRESS`` fails closed. Absent optional values stay ``None`` and
        the corresponding ``require_*`` getter fails closed on use.
        """
        source = env if env is not None else os.environ

        raw_chain = source.get(CHAIN_ID_ENV)
        if raw_chain is None or raw_chain == "":
            chain_id = DEFAULT_CHAIN_ID
        else:
            try:
                chain_id = int(raw_chain)
            except ValueError as exc:
                raise ConfigError(f"{CHAIN_ID_ENV} must be an integer, got {raw_chain!r}") from exc
        if chain_id not in SUPPORTED_CHAIN_IDS:
            raise ConfigError(
                f"{CHAIN_ID_ENV}={chain_id} is not supported "
                f"(expected one of {', '.join(map(str, SUPPORTED_CHAIN_IDS))})."
            )

        raw_vault = source.get(VAULT_ADDRESS_ENV)
        vault_address = _normalize_address(raw_vault, VAULT_ADDRESS_ENV) if raw_vault else None

        raw_fee = source.get(FEE_WALLET_ADDRESS_ENV)
        fee_wallet_address = (
            _normalize_address(raw_fee, FEE_WALLET_ADDRESS_ENV) if raw_fee else None
        )

        raw_aave_pool = source.get(AAVE_POOL_ADDRESS_ENV)
        aave_pool_address = (
            _normalize_address(raw_aave_pool, AAVE_POOL_ADDRESS_ENV) if raw_aave_pool else None
        )
        raw_aave_reserve = source.get(AAVE_RESERVE_USDC_ADDRESS_ENV)
        aave_reserve_usdc_address = (
            _normalize_address(raw_aave_reserve, AAVE_RESERVE_USDC_ADDRESS_ENV)
            if raw_aave_reserve
            else None
        )

        return cls(
            chain_id=chain_id,
            rpc_url=_resolve_rpc_url(source, chain_id),
            vault_address=vault_address,
            database_url=source.get(DATABASE_URL_ENV) or None,
            fee_wallet_address=fee_wallet_address,
            aave_pool_address=aave_pool_address,
            aave_reserve_usdc_address=aave_reserve_usdc_address,
        )

    def for_chain(self, chain_id: int) -> AgentConfig:
        """A read-config scoped to ``chain_id`` (§B3 multi-network reads).

        The RPC is resolved for the TARGET chain; the vault address is carried ONLY when the
        target is this agent's configured vault chain. On every OTHER supported chain (e.g.
        Robinhood 46630) the vault is not deployed here, so ``vault_address`` is ``None`` and vault
        reads fail closed (NOT_DEPLOYED) — the portfolio degrades honestly rather than reading a
        Base vault for a non-Base request. The DB DSN is unchanged (shared across chains).
        """
        if chain_id == self.chain_id:
            return self
        return replace(
            self,
            chain_id=chain_id,
            rpc_url=_resolve_rpc_url(os.environ, chain_id),
            vault_address=None,
        )
