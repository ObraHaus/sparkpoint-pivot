"""Typed, fail-closed configuration for the SparkPoint vault read surface (T030, backend half).

This is the single loader the vault chain-read client + the /vault/quote endpoints +
the fee indexer read their environment through. It validates ONLY the vars the vault
surface needs and exposes fail-closed getters:

  - ``DATABASE_URL``            — the derived-index Postgres DSN (db/config.py owns the pool).
  - the RPC url                 — ``SPARKPOINT_RPC_URL`` override, else the chain-appropriate
                                  ``SIM_FORK_RPC_URL`` (Base-mainnet fork / 8453 · 31337) or
                                  ``BASE_SEPOLIA_RPC_URL`` (84532).
  - ``SPARKPOINT_VAULT_ADDRESS`` — OPTIONAL. Undefined ⇒ the vault is not deployed on this
                                  chain; every getter that needs it fails closed and the
                                  endpoints return a clean "vault not deployed" envelope —
                                  NEVER a fabricated quote (mirrors packages/shared/src/
                                  addresses/*.ts, where ``vault`` is ``undefined`` pre-deploy).
  - ``CHAIN_ID``                — one of policy.SUPPORTED_CHAIN_IDS (8453 · 84532 · 31337).

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
from dataclasses import dataclass

from .policy import SUPPORTED_CHAIN_IDS

# ── Env var names (the ONLY keys this loader is ever permitted to read) ──────────
DATABASE_URL_ENV = "DATABASE_URL"
CHAIN_ID_ENV = "CHAIN_ID"
VAULT_ADDRESS_ENV = "SPARKPOINT_VAULT_ADDRESS"
RPC_URL_ENV = "SPARKPOINT_RPC_URL"  # explicit override; wins over the chain-specific vars
SIM_FORK_RPC_URL_ENV = "SIM_FORK_RPC_URL"
BASE_SEPOLIA_RPC_URL_ENV = "BASE_SEPOLIA_RPC_URL"

# Default to Base mainnet (8453) — the chainId the live SIM_FORK_RPC_URL reports.
DEFAULT_CHAIN_ID = 8453

# The closed allowlist of env vars this loader may EVER touch (non-custody surface).
ALLOWED_ENV_KEYS: frozenset[str] = frozenset(
    {
        DATABASE_URL_ENV,
        CHAIN_ID_ENV,
        VAULT_ADDRESS_ENV,
        RPC_URL_ENV,
        SIM_FORK_RPC_URL_ENV,
        BASE_SEPOLIA_RPC_URL_ENV,
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


def _resolve_rpc_url(source: Mapping[str, str], chain_id: int) -> str | None:
    """Pick the RPC url for ``chain_id``. Explicit override wins; else chain-appropriate.

    Returns ``None`` when nothing is configured (the getter fails closed on use).
    """
    if chain_id == 84532:  # Base Sepolia
        order = (RPC_URL_ENV, BASE_SEPOLIA_RPC_URL_ENV, SIM_FORK_RPC_URL_ENV)
    else:  # 8453 (Base mainnet) · 31337 (Anvil fork of Base mainnet) → the sim fork
        order = (RPC_URL_ENV, SIM_FORK_RPC_URL_ENV, BASE_SEPOLIA_RPC_URL_ENV)
    for name in order:
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

    @property
    def vault_deployed(self) -> bool:
        """True iff ``SPARKPOINT_VAULT_ADDRESS`` was set (a concrete on-chain target exists)."""
        return self.vault_address is not None

    def require_rpc_url(self) -> str:
        """The RPC url, or fail closed."""
        if not self.rpc_url:
            raise ConfigError(
                "no RPC url configured (set SPARKPOINT_RPC_URL, or SIM_FORK_RPC_URL / "
                f"BASE_SEPOLIA_RPC_URL for chain {self.chain_id})."
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
        vault_address = (
            _normalize_address(raw_vault, VAULT_ADDRESS_ENV) if raw_vault else None
        )

        return cls(
            chain_id=chain_id,
            rpc_url=_resolve_rpc_url(source, chain_id),
            vault_address=vault_address,
            database_url=source.get(DATABASE_URL_ENV) or None,
        )
