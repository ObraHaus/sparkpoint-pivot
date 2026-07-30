# ruff: noqa: S101  (pytest asserts)
"""023 T007 — the chain-identity probe (chain/chain_identity.py), FR-023-002/003.

Asserts the three-state behavior the mainnet failure mode depends on: a proven chain serves, a
DIFFERENT chain latches closed (a configuration error will not fix itself), an unreadable chain
fails closed but re-probes (a blip must not take a healthy deployment down), and no RPC url ever
reaches a log record (it can carry a provider key).
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

import pytest

from sparkpoint_agent.chain import ChainIdentity, ChainIdentityProbe
from sparkpoint_agent.chain.vault_reader import VaultUnavailable, VaultUnavailableReason

_URL = "https://mainnet.example/v2/SUPER_SECRET_PROVIDER_KEY"


class _FakeTransport:
    """Canned ``eth_chainId`` transport. Counts calls so the TTL/latch behavior is observable."""

    def __init__(self, *, reply: str | None = None, raises: Exception | None = None) -> None:
        self._reply = reply
        self._raises = raises
        self.calls = 0

    async def call(self, method: str, params: Sequence[Any]) -> str:
        assert method == "eth_chainId"
        self.calls += 1
        if self._raises is not None:
            raise self._raises
        assert self._reply is not None
        return self._reply

    def set_reply(self, reply: str) -> None:
        self._raises = None
        self._reply = reply


async def test_matching_chain_is_verified_and_serves() -> None:
    transport = _FakeTransport(reply=hex(8453))
    probe = ChainIdentityProbe(chain_id=8453, transport=transport)

    assert await probe.verdict() is ChainIdentity.VERIFIED
    assert probe.observed_chain_id == 8453
    await probe.require_verified()  # does not raise


async def test_verified_verdict_is_cached_within_the_ttl() -> None:
    transport = _FakeTransport(reply=hex(84532))
    probe = ChainIdentityProbe(chain_id=84532, transport=transport)

    for _ in range(5):
        assert await probe.verdict() is ChainIdentity.VERIFIED
    assert transport.calls == 1, "a fresh verdict must not re-probe (one round-trip per TTL window)"


async def test_expired_ttl_re_probes() -> None:
    transport = _FakeTransport(reply=hex(84532))
    probe = ChainIdentityProbe(chain_id=84532, transport=transport, ttl_s=0.0)

    await probe.verdict()
    await probe.verdict()
    assert transport.calls == 2


async def test_mismatched_chain_fails_closed_and_latches() -> None:
    """A wrong chain is a configuration error: it must not be re-probed, and correcting the RPC
    without a restart must not silently start serving (the latch is deliberate)."""
    transport = _FakeTransport(reply=hex(84532))
    probe = ChainIdentityProbe(chain_id=8453, transport=transport, ttl_s=0.0)

    assert await probe.verdict() is ChainIdentity.MISMATCH
    with pytest.raises(VaultUnavailable) as excinfo:
        await probe.require_verified()
    assert excinfo.value.reason is VaultUnavailableReason.CHAIN_MISMATCH
    assert "84532" in str(excinfo.value) and "8453" in str(excinfo.value)

    transport.set_reply(hex(8453))  # the RPC is "fixed" — but the verdict is latched
    assert await probe.verdict() is ChainIdentity.MISMATCH
    assert transport.calls == 1, "a mismatch must never be re-probed"


async def test_unreachable_rpc_is_unknown_fails_closed_and_re_probes() -> None:
    """The opposite asymmetry: a transient failure must fail closed WITHOUT latching, so a recovered
    RPC is picked up rather than leaving a healthy deployment down until someone notices."""
    boom = VaultUnavailable(VaultUnavailableReason.RPC_UNREACHABLE, "connection refused")
    transport = _FakeTransport(raises=boom)
    probe = ChainIdentityProbe(chain_id=8453, transport=transport, ttl_s=0.0)

    assert await probe.verdict() is ChainIdentity.UNKNOWN
    with pytest.raises(VaultUnavailable) as excinfo:
        await probe.require_verified()
    assert excinfo.value.reason is VaultUnavailableReason.RPC_UNREACHABLE

    transport.set_reply(hex(8453))  # the RPC recovers
    assert await probe.verdict() is ChainIdentity.VERIFIED
    await probe.require_verified()


async def test_unparseable_reply_is_unknown_not_a_crash() -> None:
    transport = _FakeTransport(reply="not-a-hex-quantity")
    probe = ChainIdentityProbe(chain_id=8453, transport=transport)

    assert await probe.verdict() is ChainIdentity.UNKNOWN


async def test_unknown_can_serve_is_false() -> None:
    """UNKNOWN must fail closed: an unverified chain is not a safe basis for a policy decision even
    though it may recover."""
    assert ChainIdentity.VERIFIED.can_serve is True
    assert ChainIdentity.MISMATCH.can_serve is False
    assert ChainIdentity.UNKNOWN.can_serve is False


async def test_no_rpc_url_reaches_a_log_record_or_a_message(
    caplog: pytest.LogCaptureFixture,
) -> None:
    """FR-023-003 — the url can carry a provider key: only chain ids may be logged or surfaced."""
    caplog.set_level(logging.DEBUG, logger="sparkpoint_agent.chain.chain_identity")

    mismatch = ChainIdentityProbe(chain_id=8453, transport=_FakeTransport(reply=hex(84532)))
    await mismatch.verdict()
    unknown = ChainIdentityProbe(
        chain_id=8453,
        transport=_FakeTransport(
            raises=VaultUnavailable(VaultUnavailableReason.RPC_UNREACHABLE, f"cannot reach {_URL}")
        ),
    )
    await unknown.verdict()

    emitted = " ".join(record.getMessage() for record in caplog.records)
    assert emitted, "the probe must say something on a non-verified verdict"
    assert "SUPER_SECRET_PROVIDER_KEY" not in emitted
    assert _URL not in emitted

    with pytest.raises(VaultUnavailable) as excinfo:
        await mismatch.require_verified()
    assert "SUPER_SECRET_PROVIDER_KEY" not in str(excinfo.value)
