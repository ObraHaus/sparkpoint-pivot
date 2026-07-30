# ruff: noqa: S101  (asserts are the idiomatic assertion mechanism in pytest)
"""024/T032 — registry-backed vault resolution, behind a flag, byte-identical when off.

The contract under test, in precedence order:
  1. flag OFF  ⇒ the ``SPARKPOINT_VAULT_ADDRESS`` value, with NO database round-trip;
  2. flag ON + a live first-party row ⇒ the registry's address;
  3. flag ON + registry miss / unreachable / unmigrated ⇒ fall back to the env value.

(3) is the one that matters most. A registry miss means "the registry does not know", never "there
is no vault" — migration 0026 is additive and may not be applied. Failing closed would take a
funded, working vault offline because a DISPLAY table was empty, which is precisely the
SparkPoint-decision-blocks-a-user failure N2 forbids.
"""

from __future__ import annotations

import pytest

from sparkpoint_agent.chain.vault_resolution import (
    VAULT_REGISTRY_ENABLED_ENV,
    registry_enabled,
    reset_warning_state,
    resolve_vault_address,
)
from sparkpoint_agent.config import AgentConfig

ENV_VAULT = "0x15d269b1d4fb3581e5a47482a70215e63ed547f2"
REGISTRY_VAULT = "0xaaaa0000000000000000000000000000000000aa"


def _config(vault: str | None = ENV_VAULT, chain_id: int = 84532) -> AgentConfig:
    return AgentConfig.from_env(
        {
            "CHAIN_ID": str(chain_id),
            "BASE_SEPOLIA_RPC_URL": "https://example.invalid",
            **({"SPARKPOINT_VAULT_ADDRESS": vault} if vault else {}),
        }
    )


class _FakeStore:
    """The narrow ``FirstPartyVaultResolver`` slice, with failure modes."""

    def __init__(
        self, address: str | None = REGISTRY_VAULT, *, raises: bool = False, live_count: int = 1
    ) -> None:
        self._address = address
        self._raises = raises
        self._live_count = live_count
        self.resolve_calls = 0

    async def resolve_first_party_vault(self, chain_id: int) -> str | None:
        self.resolve_calls += 1
        if self._raises:
            raise RuntimeError('relation "vault_registry" does not exist')
        return self._address

    async def count_live_first_party(self, chain_id: int) -> int:
        return self._live_count


@pytest.fixture(autouse=True)
def _clean(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv(VAULT_REGISTRY_ENABLED_ENV, raising=False)
    reset_warning_state()


# ── (1) flag OFF — the day-one guarantee ──────────────────────────────────────


async def test_flag_off_returns_the_env_address_and_never_touches_the_store() -> None:
    store = _FakeStore()
    assert await resolve_vault_address(_config(), store) == ENV_VAULT
    # Not merely the same answer — the DB must not even be consulted, so enabling the registry
    # cannot add a failure mode or a latency cost to the untouched path.
    assert store.resolve_calls == 0


async def test_flag_off_is_the_default() -> None:
    assert registry_enabled() is False


async def test_flag_off_with_no_env_address_stays_none() -> None:
    """None ⇒ not deployed on this chain; every caller already fails closed on it."""
    assert await resolve_vault_address(_config(vault=None), _FakeStore()) is None


async def test_no_store_returns_the_env_address_even_when_enabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A service with no DATABASE_URL keeps working exactly as before."""
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    assert await resolve_vault_address(_config(), None) == ENV_VAULT


# ── (2) flag ON with a row ────────────────────────────────────────────────────


@pytest.mark.parametrize("flag", ["1", "true", "TRUE", "yes"])
async def test_flag_on_prefers_the_registry(monkeypatch: pytest.MonkeyPatch, flag: str) -> None:
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, flag)
    assert await resolve_vault_address(_config(), _FakeStore()) == REGISTRY_VAULT


async def test_flag_on_resolves_even_when_the_env_var_is_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The registry genuinely REPLACES the env var — it is not merely an override of it."""
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    assert await resolve_vault_address(_config(vault=None), _FakeStore()) == REGISTRY_VAULT


# ── (3) flag ON, registry cannot answer — MUST fall back, never refuse ────────


async def test_registry_miss_falls_back_to_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    assert await resolve_vault_address(_config(), _FakeStore(address=None)) == ENV_VAULT


async def test_unmigrated_or_unreachable_database_falls_back_to_env(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """0026 unapplied must NOT take the vault offline (N2: never a SparkPoint-side block)."""
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    assert await resolve_vault_address(_config(), _FakeStore(raises=True)) == ENV_VAULT


async def test_resolution_never_raises_on_a_store_fault(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    # Both halves broken (resolve raises AND the ambiguity probe would too) — still no exception.
    assert await resolve_vault_address(_config(vault=None), _FakeStore(raises=True)) is None


async def test_a_store_fault_warns_only_once_per_chain(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    store = _FakeStore(raises=True)
    with caplog.at_level("WARNING"):
        for _ in range(4):
            assert await resolve_vault_address(_config(), store) == ENV_VAULT
    warnings = [r for r in caplog.records if r.levelname == "WARNING"]
    assert len(warnings) == 1, "a persistent registry fault must not flood the log every request"


# ── ambiguity is a data error, not a refusal ──────────────────────────────────


async def test_two_live_first_party_rows_still_resolves_and_logs_an_error(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    with caplog.at_level("ERROR"):
        got = await resolve_vault_address(_config(), _FakeStore(live_count=2))
    assert got == REGISTRY_VAULT, "an ambiguous registry must not withhold a working vault"
    assert any("live first-party rows" in r.message for r in caplog.records)


# ── IV.5(d) policy isolation ──────────────────────────────────────────────────


async def test_resolution_yields_only_an_address(monkeypatch: pytest.MonkeyPatch) -> None:
    """Constitution IV.5(d): the registry is admission/display only and MUST NOT reach the
    deterministic policy path. Returning a bare ``str`` — the same shape the env var already had —
    is the structural guarantee: no row content (label, fees, status, notes) can travel with it."""
    monkeypatch.setenv(VAULT_REGISTRY_ENABLED_ENV, "true")
    got = await resolve_vault_address(_config(), _FakeStore())
    assert isinstance(got, str)
    assert got == REGISTRY_VAULT
