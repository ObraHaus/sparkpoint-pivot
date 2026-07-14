# ruff: noqa: S101, S105, S106  (pytest asserts; the "private key" literals are test sentinels)
"""T030 config loader — typed, fail-closed, PROVABLY keyless (config.py).

Covers: chain-id defaulting/validation, optional-vault fail-closed semantics, RPC-url
precedence, the ``require_*`` fail-closed getters, and the non-custody guarantee that the
loader never reads private-key env vars.
"""

from __future__ import annotations

import pytest

from sparkpoint_agent.config import (
    ALLOWED_ENV_KEYS,
    DEFAULT_CHAIN_ID,
    AgentConfig,
    ConfigError,
)

_SIM = "http://fork.local:8545"
_SEPOLIA = "http://sepolia.local:8545"
_OVERRIDE = "http://override.local:8545"
_VAULT = "0xABCDef0000000000000000000000000000001234"


def test_defaults_chain_id_when_unset() -> None:
    cfg = AgentConfig.from_env({"SIM_FORK_RPC_URL": _SIM})
    assert cfg.chain_id == DEFAULT_CHAIN_ID == 8453
    assert cfg.rpc_url == _SIM
    assert cfg.vault_address is None
    assert cfg.vault_deployed is False


def test_unsupported_chain_id_fails_closed() -> None:
    with pytest.raises(ConfigError):
        AgentConfig.from_env({"CHAIN_ID": "1", "SIM_FORK_RPC_URL": _SIM})


def test_malformed_chain_id_fails_closed() -> None:
    with pytest.raises(ConfigError):
        AgentConfig.from_env({"CHAIN_ID": "base", "SIM_FORK_RPC_URL": _SIM})


def test_vault_address_normalized_lowercase() -> None:
    cfg = AgentConfig.from_env({"SPARKPOINT_VAULT_ADDRESS": _VAULT, "SIM_FORK_RPC_URL": _SIM})
    assert cfg.vault_address == _VAULT.lower()
    assert cfg.vault_deployed is True
    assert cfg.require_vault_address() == _VAULT.lower()


def test_malformed_vault_address_fails_closed_no_fabrication() -> None:
    # A bad address must fail loudly, never silently resolve to a fabricated target.
    with pytest.raises(ConfigError):
        AgentConfig.from_env({"SPARKPOINT_VAULT_ADDRESS": "0xdeadbeef", "SIM_FORK_RPC_URL": _SIM})


def test_undeployed_vault_getter_fails_closed() -> None:
    cfg = AgentConfig.from_env({"SIM_FORK_RPC_URL": _SIM})
    with pytest.raises(ConfigError):
        cfg.require_vault_address()


def test_rpc_precedence_override_wins() -> None:
    cfg = AgentConfig.from_env(
        {
            "SPARKPOINT_RPC_URL": _OVERRIDE,
            "SIM_FORK_RPC_URL": _SIM,
            "BASE_SEPOLIA_RPC_URL": _SEPOLIA,
        }
    )
    assert cfg.require_rpc_url() == _OVERRIDE


def test_rpc_precedence_sepolia_prefers_sepolia_url() -> None:
    cfg = AgentConfig.from_env(
        {"CHAIN_ID": "84532", "SIM_FORK_RPC_URL": _SIM, "BASE_SEPOLIA_RPC_URL": _SEPOLIA}
    )
    assert cfg.chain_id == 84532
    assert cfg.require_rpc_url() == _SEPOLIA


def test_rpc_precedence_fork_prefers_sim_fork_url() -> None:
    cfg = AgentConfig.from_env(
        {"CHAIN_ID": "31337", "SIM_FORK_RPC_URL": _SIM, "BASE_SEPOLIA_RPC_URL": _SEPOLIA}
    )
    assert cfg.chain_id == 31337
    assert cfg.require_rpc_url() == _SIM


def test_missing_rpc_getter_fails_closed() -> None:
    cfg = AgentConfig.from_env({})  # nothing configured
    with pytest.raises(ConfigError):
        cfg.require_rpc_url()


def test_missing_database_url_getter_fails_closed() -> None:
    cfg = AgentConfig.from_env({"SIM_FORK_RPC_URL": _SIM})
    assert cfg.database_url is None
    with pytest.raises(ConfigError):
        cfg.require_database_url()
    ok = AgentConfig.from_env({"DATABASE_URL": "postgresql://x/y", "SIM_FORK_RPC_URL": _SIM})
    assert ok.require_database_url() == "postgresql://x/y"


def test_allowlist_contains_no_key_bearing_name() -> None:
    # The non-custody guard: no env key the loader may read is key-bearing.
    for key in ALLOWED_ENV_KEYS:
        upper = key.upper()
        assert "PRIVATE" not in upper
        assert "SECRET" not in upper
        assert "MNEMONIC" not in upper


def test_private_key_env_is_never_consumed() -> None:
    # Even when private-key vars are present in the environment, the loader ignores them:
    # no field carries the sentinel, and the real vars still resolve normally.
    sentinel = "0xPRIVATEKEYVALUE_must_never_be_read"
    env = {
        "DEPLOYER_PRIVATE_KEY": sentinel,
        "TEST_USER_PRIVATE_KEY": sentinel,
        "SIM_FORK_RPC_URL": _SIM,
        "SPARKPOINT_VAULT_ADDRESS": _VAULT,
    }
    cfg = AgentConfig.from_env(env)
    assert cfg.rpc_url == _SIM
    assert cfg.vault_address == _VAULT.lower()
    assert sentinel not in (cfg.rpc_url, cfg.vault_address, cfg.database_url)
    assert "DEPLOYER_PRIVATE_KEY" not in ALLOWED_ENV_KEYS
    assert "TEST_USER_PRIVATE_KEY" not in ALLOWED_ENV_KEYS
