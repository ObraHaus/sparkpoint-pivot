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
    BASE_MAINNET_PUBLIC_RPC,
    BASE_MAINNET_RPC_URL_ENV,
    DEFAULT_CHAIN_ID,
    FEE_WALLET_ADDRESS_ENV,
    AgentConfig,
    ConfigError,
    _assert_no_key_material,
)

_SIM = "http://fork.local:8545"
_SEPOLIA = "http://sepolia.local:8545"
_MAINNET = "http://mainnet.local:8545"  # 023 — BASE_MAINNET_RPC_URL; 8453's only non-override src
_OVERRIDE = "http://override.local:8545"
_VAULT = "0xABCDef0000000000000000000000000000001234"
_SAFE = "0xCB135893C84876aab9E10792b56e5bEa91dc578f"


def test_fee_wallet_address_normalized_onto_config() -> None:
    cfg = AgentConfig.from_env({"FEE_WALLET_ADDRESS": _SAFE, "SIM_FORK_RPC_URL": _SIM})
    assert cfg.fee_wallet_address == _SAFE.lower()


def test_fee_wallet_address_absent_is_none() -> None:
    cfg = AgentConfig.from_env({"SIM_FORK_RPC_URL": _SIM})
    assert cfg.fee_wallet_address is None


def test_malformed_fee_wallet_address_fails_closed() -> None:
    # Like SPARKPOINT_VAULT_ADDRESS: a bad value fails loudly, never silently resolves.
    with pytest.raises(ConfigError):
        AgentConfig.from_env({"FEE_WALLET_ADDRESS": "0xnothex", "SIM_FORK_RPC_URL": _SIM})


def test_fee_wallet_env_is_allowlisted_and_keyless() -> None:
    assert FEE_WALLET_ADDRESS_ENV in ALLOWED_ENV_KEYS
    _assert_no_key_material()  # the read allowlist still carries no key-bearing name (N1/N3)


def test_defaults_chain_id_when_unset() -> None:
    # 023: the default chain is 8453, whose ONLY non-override RPC source is BASE_MAINNET_RPC_URL —
    # a fork url no longer resolves here (see test_mainnet_never_falls_back_to_fork_or_sepolia).
    cfg = AgentConfig.from_env({"BASE_MAINNET_RPC_URL": _MAINNET})
    assert cfg.chain_id == DEFAULT_CHAIN_ID == 8453
    assert cfg.rpc_url == _MAINNET
    assert cfg.vault_address is None
    assert cfg.vault_deployed is False


def test_mainnet_never_falls_back_to_fork_or_sepolia() -> None:
    """023 / FR-023-001 — the regression guard for the defect this feature closes.

    Chain 8453 previously resolved ``SPARKPOINT_RPC_URL → SIM_FORK_RPC_URL → BASE_SEPOLIA_RPC_URL``,
    so a mainnet deployment missing one env var read the fork (or Sepolia) and presented it as
    mainnet — a bundle approved against one chain's state and signed on another. A missing
    BASE_MAINNET_RPC_URL now uses Base's own keyless public mainnet RPC — never the fork/Sepolia.
    """
    for env in ({"SIM_FORK_RPC_URL": _SIM}, {"BASE_SEPOLIA_RPC_URL": _SEPOLIA}):
        cfg = AgentConfig.from_env({"CHAIN_ID": "8453", **env})
        assert cfg.rpc_url == BASE_MAINNET_PUBLIC_RPC
        assert cfg.require_rpc_url() == BASE_MAINNET_PUBLIC_RPC
        assert _SIM not in cfg.require_rpc_url() and _SEPOLIA not in cfg.require_rpc_url()


def test_sepolia_never_falls_back_to_the_mainnet_fork() -> None:
    """023 / FR-023-001 — the mirror-image bug: a Base-mainnet fork served as Base Sepolia."""
    cfg = AgentConfig.from_env({"CHAIN_ID": "84532", "SIM_FORK_RPC_URL": _SIM})
    assert cfg.rpc_url is None


def test_local_fork_and_robinhood_still_resolve() -> None:
    """023 — the two non-regressions: local dev (31337) and the read-only Robinhood testnet."""
    fork = AgentConfig.from_env({"CHAIN_ID": "31337", "SIM_FORK_RPC_URL": _SIM})
    assert fork.rpc_url == _SIM
    # 46630 keeps its keyless public default when no override is configured.
    rh = AgentConfig.from_env({"CHAIN_ID": "46630"})
    assert rh.rpc_url is not None and rh.rpc_url.startswith("https://")
    # And the explicit override still wins on every chain.
    override = AgentConfig.from_env(
        {"CHAIN_ID": "8453", "SPARKPOINT_RPC_URL": _OVERRIDE, "BASE_MAINNET_RPC_URL": _MAINNET}
    )
    assert override.rpc_url == _OVERRIDE


def test_mainnet_rpc_env_is_allowlisted_and_keyless() -> None:
    """023 — the new var is in the closed read allowlist and trips no key-bearing substring."""
    assert BASE_MAINNET_RPC_URL_ENV in ALLOWED_ENV_KEYS
    _assert_no_key_material()


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
    # 4663 has no public default (its public node prunes state), so an unset ARCHIVE endpoint must
    # still fail closed. 8453 uses Base's own public mainnet RPC now (see test_below).
    cfg = AgentConfig.from_env({"CHAIN_ID": "4663"})
    with pytest.raises(ConfigError):
        cfg.require_rpc_url()


def test_base_mainnet_defaults_to_its_own_public_rpc() -> None:
    cfg = AgentConfig.from_env({})  # nothing configured
    assert cfg.chain_id == 8453
    assert cfg.require_rpc_url() == BASE_MAINNET_PUBLIC_RPC
    assert cfg.require_rpc_url() == "https://mainnet.base.org"


# ── §B3 Robinhood testnet (46630) multi-network ────────────────────────────────


def test_robinhood_chain_supported_with_keyless_public_rpc_default() -> None:
    # 46630 is a supported chain; with no RPC env it falls back to the keyless public RH RPC.
    cfg = AgentConfig.from_env({"CHAIN_ID": "46630"})
    assert cfg.chain_id == 46630
    assert cfg.rpc_url == "https://rpc.testnet.chain.robinhood.com"


def test_robinhood_rpc_env_override_wins() -> None:
    cfg = AgentConfig.from_env({"CHAIN_ID": "46630", "ROBINHOOD_RPC_URL": _OVERRIDE})
    assert cfg.require_rpc_url() == _OVERRIDE


def test_for_chain_drops_vault_off_home_chain_but_resolves_rpc() -> None:
    # Agent configured for Base Sepolia (vault + RPC). A 46630-scoped read keeps NO vault
    # (Base-only ⇒ fail-closed there) but DOES resolve the 46630 RPC.
    cfg = AgentConfig.from_env(
        {"CHAIN_ID": "84532", "BASE_SEPOLIA_RPC_URL": _SEPOLIA, "SPARKPOINT_VAULT_ADDRESS": _VAULT}
    )
    assert cfg.vault_address is not None
    rh = cfg.for_chain(46630)
    assert rh.chain_id == 46630
    assert rh.vault_address is None  # vault is Base-only ⇒ not deployed on 46630
    assert rh.rpc_url == "https://rpc.testnet.chain.robinhood.com"
    # Scoping to the SAME chain returns the config unchanged (vault retained).
    assert cfg.for_chain(84532) is cfg


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
        # 023: the default chain is 8453, so use ITS var — the point of this test is that the real
        # vars resolve while key-bearing ones are ignored, not which chain is being configured.
        "BASE_MAINNET_RPC_URL": _MAINNET,
        "SPARKPOINT_VAULT_ADDRESS": _VAULT,
    }
    cfg = AgentConfig.from_env(env)
    assert cfg.rpc_url == _MAINNET
    assert cfg.vault_address == _VAULT.lower()
    assert sentinel not in (cfg.rpc_url, cfg.vault_address, cfg.database_url)
    assert "DEPLOYER_PRIVATE_KEY" not in ALLOWED_ENV_KEYS
    assert "TEST_USER_PRIVATE_KEY" not in ALLOWED_ENV_KEYS
