# ruff: noqa: S101
"""Tests for the Morpho APY client + poller (024 Phase 4, T050/T051).

The thing under test is HONESTY, not arithmetic. Every one of these guards a path where the tempting
shortcut produces a plausible number instead of an error:

  * a testnet must yield "unavailable", never 0 — Morpho's API serves no testnet, and `0026`'s
    CHECK would reject a 0 anyway, so a careless ``x or 0`` silently writes nothing.
  * a fee FRACTION (0.25) must not be mistaken for bps or WAD.
  * a negative APY is real and must survive; clamping it to 0 would flatter the vault.
  * the poller must never touch the network on a chain it already knows is unsupported, because the
    penalty for abusing this API is a long cooldown.
"""

from __future__ import annotations

import asyncio
import dataclasses
from typing import Any

import pytest

from sparkpoint_agent.data.morpho_api import (
    MorphoApyResult,
    chain_is_supported,
    fetch_vault_v2_apy,
    unavailable,
)

_VAULT = "0x756C41dD33481620EbCB0357F759d31c9eE72170"


# ── the honesty invariant ────────────────────────────────────────────────────────────────────────


def test_unavailable_never_carries_a_rate() -> None:
    r = unavailable("because")
    assert r.source == "unavailable"
    assert r.net_apy_bps is None, "a 0 here would be a fabricated yield AND would fail 0026's CHECK"
    assert r.is_available is False
    assert r.reason == "because"


def test_base_sepolia_is_not_a_supported_chain() -> None:
    # This is the chain we actually run on. If this ever flips to True the poller would start making
    # requests that Morpho rejects outright, burning rate-limit budget for a known answer.
    assert chain_is_supported(84532) is False
    assert chain_is_supported(46630) is False, "Robinhood testnet has no Morpho deployment at all"
    assert chain_is_supported(8453) is True, "Base mainnet IS served"
    assert chain_is_supported(4663) is True, "Robinhood Chain mainnet IS served"


def test_unsupported_chain_short_circuits_without_any_network_call(monkeypatch: Any) -> None:
    """The default Base-Sepolia path must not touch httpx at all."""

    def _boom(*_a: Any, **_k: Any) -> Any:  # pragma: no cover - must never run
        raise AssertionError("no HTTP request may be made for an unsupported chain")

    monkeypatch.setattr("httpx.AsyncClient", _boom)
    result = asyncio.run(fetch_vault_v2_apy(address=_VAULT, chain_id=84532))
    assert result.source == "unavailable"
    assert result.net_apy_bps is None
    assert "84532" in (result.reason or "")


# ── fraction → bps, the units trap ───────────────────────────────────────────────────────────────


def _fake_post(payload: dict[str, Any]) -> Any:
    """A stub httpx.AsyncClient whose post() returns `payload` as JSON."""

    class _Resp:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return payload

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def post(self, *_a: Any, **_k: Any) -> _Resp:
            return _Resp()

    return lambda *_a, **_k: _Client()


@pytest.mark.parametrize(
    ("avg_net_apy", "expected_bps"),
    [
        (0.0425, 425),  # 4.25% — an ordinary vault rate
        (0.25, 2500),  # a fee-sized fraction; must NOT be read as 25 bps or as WAD
        (1.0, 10_000),  # 100%
        (0.0, 0),  # a genuine 0% is legal WITH source='morpho_api'; only 'unavailable' forbids it
        (-0.012, -120),  # a LOSING vault. Preserved, never clamped — clamping would flatter it.
    ],
)
def test_fraction_to_bps(monkeypatch: Any, avg_net_apy: float, expected_bps: int) -> None:
    monkeypatch.setattr(
        "httpx.AsyncClient",
        _fake_post({"data": {"vaultV2ByAddress": {"address": _VAULT, "avgNetApy": avg_net_apy}}}),
    )
    result = asyncio.run(fetch_vault_v2_apy(address=_VAULT, chain_id=8453))
    assert result.source == "morpho_api"
    assert result.net_apy_bps == expected_bps


def test_a_real_zero_rate_is_distinguishable_from_unavailable(monkeypatch: Any) -> None:
    """0% measured is NOT the same statement as "we don't know", and the two must not collapse."""
    monkeypatch.setattr(
        "httpx.AsyncClient",
        _fake_post({"data": {"vaultV2ByAddress": {"address": _VAULT, "avgNetApy": 0.0}}}),
    )
    measured = asyncio.run(fetch_vault_v2_apy(address=_VAULT, chain_id=8453))
    unknown = unavailable("no feed")
    assert measured.net_apy_bps == 0 and measured.source == "morpho_api"
    assert unknown.net_apy_bps is None and unknown.source == "unavailable"
    assert measured.source != unknown.source


def test_falls_back_to_netApy_when_avgNetApy_is_missing(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "httpx.AsyncClient",
        _fake_post({"data": {"vaultV2ByAddress": {"address": _VAULT, "netApy": 0.031}}}),
    )
    result = asyncio.run(fetch_vault_v2_apy(address=_VAULT, chain_id=8453))
    assert result.net_apy_bps == 310


def test_native_fees_and_usd_are_carried_for_the_stacked_disclosure(monkeypatch: Any) -> None:
    monkeypatch.setattr(
        "httpx.AsyncClient",
        _fake_post(
            {
                "data": {
                    "vaultV2ByAddress": {
                        "address": _VAULT,
                        "avgNetApy": 0.05,
                        "performanceFee": 0.1,
                        "managementFee": 0.005,
                        "totalAssetsUsd": 1234.5,
                        "liquidityUsd": 99.999,
                    }
                }
            }
        ),
    )
    r = asyncio.run(fetch_vault_v2_apy(address=_VAULT, chain_id=8453))
    assert r.native_performance_fee_bps == 1000
    assert r.native_management_fee_bps == 50
    # numeric(20,2) takes STRINGS, never floats.
    assert r.tvl_usd == "1234.50" and isinstance(r.tvl_usd, str)
    assert r.liquidity_usd == "100.00"


# ── every failure is "unavailable", never an exception and never a number ─────────────────────────


@pytest.mark.parametrize(
    "payload",
    [
        {"errors": [{"message": "rate limited"}]},  # the cooldown case
        {"data": {"vaultV2ByAddress": None}},  # not indexed
        {"data": {}},  # shape drift
        {},  # empty
        {"data": {"vaultV2ByAddress": {"avgNetApy": None, "netApy": None}}},  # nulls
        {"data": {"vaultV2ByAddress": {"avgNetApy": "not-a-number"}}},
        {"data": {"vaultV2ByAddress": {"avgNetApy": 5000.0}}},  # absurd magnitude ⇒ refuse
    ],
)
def test_every_bad_response_is_unavailable_with_a_null_rate(monkeypatch: Any, payload: Any) -> None:
    monkeypatch.setattr("httpx.AsyncClient", _fake_post(payload))
    result = asyncio.run(fetch_vault_v2_apy(address=_VAULT, chain_id=8453))
    assert result.source == "unavailable"
    assert result.net_apy_bps is None


def test_a_transport_error_is_unavailable_not_a_raise(monkeypatch: Any) -> None:
    import httpx

    class _Client:
        async def __aenter__(self) -> _Client:
            return self

        async def __aexit__(self, *_a: Any) -> None:
            return None

        async def post(self, *_a: Any, **_k: Any) -> Any:
            raise httpx.ConnectError("down")

    monkeypatch.setattr("httpx.AsyncClient", lambda *_a, **_k: _Client())
    result = asyncio.run(fetch_vault_v2_apy(address=_VAULT, chain_id=8453))
    assert result.source == "unavailable"
    assert result.net_apy_bps is None


def test_result_is_frozen_so_a_rate_cannot_be_attached_after_the_fact() -> None:
    r = unavailable("nope")
    # frozen dataclass ⇒ FrozenInstanceError (a subclass of AttributeError). Asserted precisely
    # rather than as a blind Exception, so a DIFFERENT failure here cannot masquerade as a pass.
    with pytest.raises(dataclasses.FrozenInstanceError):
        r.net_apy_bps = 500  # type: ignore[misc]
    assert isinstance(r, MorphoApyResult)


# ── the poller ───────────────────────────────────────────────────────────────────────────────────


def test_poll_interval_is_floored_so_a_misconfig_cannot_hammer_the_api(monkeypatch: Any) -> None:
    from sparkpoint_agent.api.vault_apy_poller import poll_interval_s

    monkeypatch.setenv("SPARKPOINT_VAULT_APY_POLL_INTERVAL_S", "1")
    assert poll_interval_s() == 300.0, "a 1s interval must be floored, not honoured"
    monkeypatch.setenv("SPARKPOINT_VAULT_APY_POLL_INTERVAL_S", "3600")
    assert poll_interval_s() == 3600.0
    for bad in ("", "abc", "-5", "0", "nan"):
        monkeypatch.setenv("SPARKPOINT_VAULT_APY_POLL_INTERVAL_S", bad)
        assert poll_interval_s() == 1800.0, f"{bad!r} must fall back to the default"


def test_the_advisory_lock_key_does_not_collide_with_the_notification_poller() -> None:
    from sparkpoint_agent.api.notification_poller import _POLL_LOCK_KEY as notif_key
    from sparkpoint_agent.api.vault_apy_poller import _POLL_LOCK_KEY as apy_key

    # Reuse would be a SILENT bug: both loops fail open, so one would take the lock and the other
    # would quietly do nothing, presenting as "the poller sometimes doesn't run".
    assert apy_key != notif_key
    assert apy_key == 210_260_024


def test_poller_writes_unavailable_for_every_vault_on_a_testnet(monkeypatch: Any) -> None:
    """The whole Base-Sepolia path, end to end: unavailable + NULL, and no HTTP at all."""
    from sparkpoint_agent.api import vault_apy_poller

    writes: list[dict[str, Any]] = []

    class _Store:
        async def list_vaults(self, chain_id: int) -> list[dict[str, Any]]:
            return [
                {"vault_address": _VAULT.lower(), "protocol": "morpho_vault_v2"},
                {
                    "vault_address": "0x15d269b1d4fb3581e5a47482a70215e63ed547f2",
                    "protocol": "aave_v3",
                },
            ]

        async def insert_apy_snapshot(self, **kw: Any) -> None:
            writes.append(kw)

    def _boom(*_a: Any, **_k: Any) -> Any:  # pragma: no cover
        raise AssertionError("the poller must not call Morpho on an unsupported chain")

    monkeypatch.setattr("httpx.AsyncClient", _boom)
    asyncio.run(vault_apy_poller._poll_chain(_Store(), 84532))  # type: ignore[arg-type]

    assert len(writes) == 2
    for w in writes:
        assert w["source"] == "unavailable"
        assert w["net_apy_bps"] is None, "0026's CHECK would reject anything else"
        assert w["chain_id"] == 84532


def test_poller_survives_a_write_failure_on_one_vault(monkeypatch: Any) -> None:
    """One bad row must not abort the remaining vaults — a yield figure is never worth that."""
    from sparkpoint_agent.api import vault_apy_poller

    seen: list[str] = []

    class _Store:
        async def list_vaults(self, chain_id: int) -> list[dict[str, Any]]:
            return [
                {"vault_address": f"0x{i:040x}", "protocol": "morpho_vault_v2"} for i in range(3)
            ]

        async def insert_apy_snapshot(self, **kw: Any) -> None:
            seen.append(kw["vault_address"])
            if len(seen) == 1:
                raise RuntimeError("transient")

    monkeypatch.setattr("httpx.AsyncClient", lambda *_a, **_k: None)
    asyncio.run(vault_apy_poller._poll_chain(_Store(), 84532))  # type: ignore[arg-type]
    assert len(seen) == 3, "all three vaults must be attempted despite the first write failing"


def test_poller_fails_open_when_the_registry_is_unreachable() -> None:
    """An unapplied 0026 must degrade to a warning, never raise into the loop."""
    from sparkpoint_agent.api import vault_apy_poller

    class _Store:
        async def list_vaults(self, chain_id: int) -> list[dict[str, Any]]:
            raise RuntimeError('relation "vault_registry" does not exist')

        async def insert_apy_snapshot(self, **kw: Any) -> None:  # pragma: no cover
            raise AssertionError("must not write when the registry could not be listed")

    asyncio.run(vault_apy_poller._poll_chain(_Store(), 84532))  # type: ignore[arg-type]
