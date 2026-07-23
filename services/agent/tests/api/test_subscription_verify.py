# ruff: noqa: S101, S105, S106
"""Feature 012 - POST /subscription/verify handler contract (deps are FAKES, no app/middleware).

Pins: a verified payment grants premium + returns expiresAt; the buyer is ALWAYS account.owner
(there is no buyer field in the body to override); pending -> 200 pending (not a 4xx); a refusal ->
400 VALIDATION_ERROR; an RPC outage -> 503 UPSTREAM_UNAVAILABLE; a replayed hash -> already_granted
(no second grant); a malformed txHash is rejected; the verifier fails closed when unconfigured.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import pytest
from pydantic import ValidationError

from sparkpoint_agent.api.errors import ApiError, ErrorCode
from sparkpoint_agent.api.security import AccountContext
from sparkpoint_agent.api.subscription import (
    PurchaseSubmit,
    get_payment_verifier,
    verify_purchase,
)
from sparkpoint_agent.chain.payment_verifier import PaymentInvalid, Pending, VerifiedPayment
from sparkpoint_agent.db.subscriptions import PaymentAlreadyRecorded

_BUYER = "0x3333333333333333333333333333333333333333"
_TX = "0x" + "ab" * 32  # 64 hex
_EXP = datetime(2026, 8, 21, tzinfo=UTC)


def _account(owner: str = _BUYER, chain_id: int = 84532) -> AccountContext:
    return AccountContext(account=owner, owner=owner, chain_id=chain_id)


def _verified(buyer: str = _BUYER) -> VerifiedPayment:
    return VerifiedPayment(
        tx_hash=_TX, buyer=buyer, token="0xsrk", amount_raw=500 * 10**18, block_number=90
    )


class _FakeVerifier:
    def __init__(self, *, result: Any = None, exc: Exception | None = None) -> None:
        self._result, self._exc, self.calls = result, exc, []

    async def verify(self, *, tx_hash: str, buyer: str) -> Any:
        self.calls.append((tx_hash, buyer))
        if self._exc:
            raise self._exc
        return self._result


class _FakeSubs:
    def __init__(self, *, expiry: datetime = _EXP, exc: Exception | None = None) -> None:
        self._expiry, self._exc, self.calls = expiry, exc, []

    async def record_and_grant(self, **kw: Any) -> datetime:
        self.calls.append(kw)
        if self._exc:
            raise self._exc
        return self._expiry


async def _call(verifier: Any, subs: Any, *, owner: str = _BUYER) -> dict[str, Any]:
    return await verify_purchase(PurchaseSubmit(txHash=_TX), _account(owner), verifier, subs)


async def test_valid_payment_grants_premium_and_binds_buyer() -> None:
    v, s = _FakeVerifier(result=_verified()), _FakeSubs()
    out = await _call(v, s)
    assert out == {"status": "granted", "tier": "premium", "expiresAt": _EXP.isoformat()}
    # buyer bound to account.owner (not the body); recorded under the seeded 'base' network
    assert v.calls == [(_TX, _BUYER)]
    assert s.calls[0]["buyer"] == _BUYER and s.calls[0]["network_id"] == "base"


async def test_pending_returns_pending_not_error() -> None:
    v = _FakeVerifier(result=Pending("awaiting confirmations (1/3)", _TX))
    out = await _call(v, _FakeSubs())
    assert out["status"] == "pending" and "confirmations" in out["reason"]


async def test_invalid_payment_is_400() -> None:
    v = _FakeVerifier(exc=PaymentInvalid("payment sender is not the buyer"))
    with pytest.raises(ApiError) as ei:
        await _call(v, _FakeSubs())
    assert ei.value.code == ErrorCode.VALIDATION_ERROR


async def test_rpc_outage_is_503() -> None:
    v = _FakeVerifier(exc=RuntimeError("rpc down"))
    with pytest.raises(ApiError) as ei:
        await _call(v, _FakeSubs())
    assert ei.value.code == ErrorCode.UPSTREAM_UNAVAILABLE


async def test_replayed_hash_is_already_granted_no_second_grant() -> None:
    v, s = _FakeVerifier(result=_verified()), _FakeSubs(exc=PaymentAlreadyRecorded("base", _TX))
    out = await _call(v, s)
    assert out == {"status": "already_granted"}


def test_malformed_txhash_rejected() -> None:
    with pytest.raises(ValidationError):
        PurchaseSubmit(txHash="0xnothex")


def test_body_has_only_txhash_so_buyer_cannot_be_supplied() -> None:
    # structural buyer-binding: no buyer/amount field exists for a client to override
    assert set(PurchaseSubmit.model_fields) == {"txHash"}


def test_verifier_fails_closed_when_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    for k in ("SRK_ADDRESS_84532", "PREMIUM_TREASURY_ADDRESS", "PREMIUM_PRICE_SRK"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ApiError) as ei:
        get_payment_verifier(_account())
    assert ei.value.code == ErrorCode.VALIDATION_ERROR
