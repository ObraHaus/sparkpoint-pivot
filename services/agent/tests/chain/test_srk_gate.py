# ruff: noqa: S101, S105, S106  (pytest asserts; the "token" here is an ERC-20 address)
"""Feature 026 - the Ethereum-mainnet 1M-SRK auto-gate (chain/srk_gate.py).

The RPC is a FAKE. These pin the contract that matters: the gate is a single keyless
``eth_call`` of ``balanceOf``, it qualifies at or above the threshold and not below, and every
failure mode (unset env, RPC exception, HTTP error shape, garbage result) returns a NON-qualifying
result rather than raising - because this runs inside the login path and must never block a login.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from sparkpoint_agent.chain.srk_gate import (
    BALANCE_OF_SELECTOR,
    DEFAULT_MIN_BALANCE,
    ENV_MIN_BALANCE,
    ENV_RPC_URL,
    ENV_TOKEN,
    SrkMainnetGate,
    build_gate_from_env,
    decode_uint256,
    encode_balance_of,
    gate_configured,
    gate_threshold,
)

TOKEN = "0x0488401c3F535193Fa8Df029d9fFe615A06E74E6"
WALLET = "0x1111111111111111111111111111111111111111"
ONE_MILLION = 1_000_000 * 10**18


class _FakeRpc:
    """Records the calls it received and replays a scripted result (or raises)."""

    def __init__(self, result: Any = None, raises: Exception | None = None) -> None:
        self.result = result
        self.raises = raises
        self.calls: list[tuple[str, list[Any]]] = []

    async def call(self, method: str, params: list[Any]) -> Any:
        self.calls.append((method, params))
        if self.raises is not None:
            raise self.raises
        return self.result


def _hex(value: int) -> str:
    return "0x" + format(value, "064x")


# ── calldata + decoding ───────────────────────────────────────────────────────


def test_encode_balance_of_is_the_selector_plus_a_padded_address() -> None:
    data = encode_balance_of(WALLET)
    assert data.startswith(BALANCE_OF_SELECTOR)
    assert len(data) == 10 + 64
    assert data.endswith(WALLET[2:].lower())
    assert data[10:34] == "0" * 24  # left-padded to 32 bytes
    # Checksummed input must encode identically to lowercase.
    assert encode_balance_of(TOKEN) == encode_balance_of(TOKEN.lower())


def test_decode_uint256_rejects_everything_that_is_not_a_hex_word() -> None:
    assert decode_uint256(_hex(ONE_MILLION)) == ONE_MILLION
    assert decode_uint256("0x0") == 0
    assert decode_uint256(None) is None
    assert decode_uint256(123) is None
    assert decode_uint256("") is None
    assert decode_uint256("0x") is None
    assert decode_uint256("not-hex") is None
    assert decode_uint256("0xzz") is None


# ── the threshold ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_qualifies_at_and_above_the_threshold() -> None:
    for balance in (ONE_MILLION, ONE_MILLION + 1, ONE_MILLION * 5):
        gate = SrkMainnetGate(rpc=_FakeRpc(_hex(balance)), token=TOKEN)
        result = await gate.check(WALLET)
        assert result.qualified is True
        assert result.reason == "ok"
        assert result.balance == balance
        assert result.threshold == DEFAULT_MIN_BALANCE


@pytest.mark.asyncio
async def test_does_not_qualify_below_the_threshold_including_one_wei_short() -> None:
    for balance in (0, 1, ONE_MILLION - 1):
        gate = SrkMainnetGate(rpc=_FakeRpc(_hex(balance)), token=TOKEN)
        result = await gate.check(WALLET)
        assert result.qualified is False
        assert result.reason == "below_threshold"
        assert result.balance == balance


@pytest.mark.asyncio
async def test_it_calls_eth_call_against_the_token_with_balance_of_calldata() -> None:
    rpc = _FakeRpc(_hex(ONE_MILLION))
    await SrkMainnetGate(rpc=rpc, token=TOKEN).check(WALLET)
    assert len(rpc.calls) == 1
    method, params = rpc.calls[0]
    assert method == "eth_call"
    assert params[0]["to"] == TOKEN.lower()
    assert params[0]["data"] == encode_balance_of(WALLET)
    assert params[1] == "latest"


@pytest.mark.asyncio
async def test_a_custom_threshold_is_honoured() -> None:
    gate = SrkMainnetGate(rpc=_FakeRpc(_hex(42)), token=TOKEN, min_balance=42)
    assert (await gate.check(WALLET)).qualified is True


# ── fail-open ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_rpc_exception_never_propagates_and_never_qualifies() -> None:
    gate = SrkMainnetGate(rpc=_FakeRpc(raises=RuntimeError("mainnet RPC down")), token=TOKEN)
    result = await gate.check(WALLET)
    assert result.qualified is False
    assert result.reason == "rpc_error"
    assert result.balance is None


@pytest.mark.asyncio
async def test_a_garbage_rpc_result_is_an_error_not_a_zero_balance() -> None:
    for junk in (None, {"unexpected": "object"}, "0x", "nonsense"):
        gate = SrkMainnetGate(rpc=_FakeRpc(junk), token=TOKEN)
        result = await gate.check(WALLET)
        assert result.qualified is False
        assert result.reason == "rpc_error"
        # NOT reported as a real zero balance - we did not read one.
        assert result.balance is None


@pytest.mark.asyncio
async def test_a_malformed_address_or_token_is_refused_without_an_rpc_call() -> None:
    rpc = _FakeRpc(_hex(ONE_MILLION))
    assert (await SrkMainnetGate(rpc=rpc, token=TOKEN).check("not-an-address")).reason == (
        "bad_address"
    )
    assert (await SrkMainnetGate(rpc=rpc, token="0xdead").check(WALLET)).reason == "bad_address"
    assert rpc.calls == []


# ── env wiring ────────────────────────────────────────────────────────────────


def test_gate_is_skipped_entirely_when_the_env_is_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (ENV_RPC_URL, ENV_TOKEN, ENV_MIN_BALANCE):
        monkeypatch.delenv(key, raising=False)
    assert gate_configured() is False
    assert build_gate_from_env() is None


def test_half_configured_is_treated_as_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ENV_RPC_URL, "https://eth.example")
    monkeypatch.delenv(ENV_TOKEN, raising=False)
    assert gate_configured() is False
    assert build_gate_from_env() is None

    monkeypatch.delenv(ENV_RPC_URL, raising=False)
    monkeypatch.setenv(ENV_TOKEN, TOKEN)
    assert gate_configured() is False
    assert build_gate_from_env() is None


def test_threshold_defaults_to_one_million_and_ignores_junk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(ENV_MIN_BALANCE, raising=False)
    assert gate_threshold() == DEFAULT_MIN_BALANCE == ONE_MILLION

    monkeypatch.setenv(ENV_MIN_BALANCE, "not-a-number")
    assert gate_threshold() == DEFAULT_MIN_BALANCE
    monkeypatch.setenv(ENV_MIN_BALANCE, "0")
    assert gate_threshold() == DEFAULT_MIN_BALANCE
    monkeypatch.setenv(ENV_MIN_BALANCE, "-5")
    assert gate_threshold() == DEFAULT_MIN_BALANCE

    monkeypatch.setenv(ENV_MIN_BALANCE, str(500 * 10**18))
    assert gate_threshold() == 500 * 10**18


def test_build_gate_from_env_wires_url_token_and_threshold(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(ENV_RPC_URL, "https://eth.example/rpc")
    monkeypatch.setenv(ENV_TOKEN, TOKEN)
    monkeypatch.setenv(ENV_MIN_BALANCE, str(7 * 10**18))
    seen: list[str] = []

    def factory(url: str) -> _FakeRpc:
        seen.append(url)
        return _FakeRpc(_hex(0))

    gate = build_gate_from_env(rpc_factory=factory)
    assert gate is not None
    assert seen == ["https://eth.example/rpc"]
    assert gate.token == TOKEN
    assert gate.min_balance == 7 * 10**18


# ── the login-path time budget (045) ─────────────────────────────────────────
#
# The gate sits on the interactive SIWE login. These pin the property that matters to a user:
# when the mainnet lane misbehaves, the gate gives up FAST and fails open — it never becomes the
# thing the login waits on. Measured in production before this change: 20.5s per stalled login.


class _HangingRpc:
    """Never answers. Stands in for the wedged eRPC lane (measured: 20s+ before this fix)."""

    def __init__(self) -> None:
        self.calls = 0

    async def call(self, method: str, params: list[Any]) -> Any:  # noqa: ARG002
        self.calls += 1
        await asyncio.sleep(3600)
        raise AssertionError("unreachable")  # pragma: no cover


class _FlakyRpc:
    """Fails the first `fail_times` calls, then returns `result` — the ~4% flaky lane."""

    def __init__(self, fail_times: int, result: Any, exc: Exception | None = None) -> None:
        self.fail_times = fail_times
        self.result = result
        self.exc = exc
        self.calls = 0

    async def call(self, method: str, params: list[Any]) -> Any:  # noqa: ARG002
        self.calls += 1
        if self.calls <= self.fail_times:
            if self.exc is not None:
                raise self.exc
            await asyncio.sleep(3600)  # a hang, not an error
        return self.result


@pytest.mark.asyncio
async def test_a_hung_rpc_fails_open_inside_the_budget_not_after_20s() -> None:
    """The whole point: a wedged lane costs the user the budget, not the transport's timeout."""
    rpc = _HangingRpc()
    gate = SrkMainnetGate(rpc=rpc, token=TOKEN, budget_seconds=0.3, attempt_seconds=0.1)

    loop = asyncio.get_running_loop()
    started = loop.time()
    result = await gate.check(WALLET)
    elapsed = loop.time() - started

    assert result.qualified is False
    assert result.reason == "timed_out"
    assert elapsed < 1.0, f"gate overran its budget: {elapsed:.2f}s"
    assert rpc.calls == 2, "both attempts should have been spent"


@pytest.mark.asyncio
async def test_a_transient_failure_is_retried_so_a_holder_is_not_wrongly_bounced() -> None:
    """~4% per-call failure would wrongly bounce ~1 in 25 qualifying holders without a retry."""
    rpc = _FlakyRpc(fail_times=1, result=_hex(ONE_MILLION), exc=RuntimeError("boom"))
    gate = SrkMainnetGate(rpc=rpc, token=TOKEN)

    result = await gate.check(WALLET)

    assert result.qualified is True
    assert result.reason == "ok"
    assert result.attempts == 2
    assert rpc.calls == 2


@pytest.mark.asyncio
async def test_a_hang_on_the_first_try_still_leaves_room_for_the_second() -> None:
    """attempt_seconds < budget is what makes the retry reachable rather than decorative."""
    rpc = _FlakyRpc(fail_times=1, result=_hex(ONE_MILLION))
    gate = SrkMainnetGate(rpc=rpc, token=TOKEN, budget_seconds=1.0, attempt_seconds=0.2)

    result = await gate.check(WALLET)

    assert result.qualified is True
    assert rpc.calls == 2


@pytest.mark.asyncio
async def test_a_decoded_answer_is_final_and_never_retried() -> None:
    """`below_threshold` is the chain's verdict — re-asking would only spend the user's budget."""
    rpc = _FakeRpc(_hex(ONE_MILLION - 1))
    gate = SrkMainnetGate(rpc=rpc, token=TOKEN)

    result = await gate.check(WALLET)

    assert result.qualified is False
    assert result.reason == "below_threshold"
    assert result.attempts == 1
    assert len(rpc.calls) == 1


@pytest.mark.asyncio
async def test_timed_out_is_distinguishable_from_rpc_error() -> None:
    """The UI offers 'try again' only when the balance is genuinely still UNKNOWN."""
    hung = SrkMainnetGate(rpc=_HangingRpc(), token=TOKEN, budget_seconds=0.2, attempt_seconds=0.05)
    assert (await hung.check(WALLET)).reason == "timed_out"

    broke = SrkMainnetGate(rpc=_FakeRpc(raises=RuntimeError("nope")), token=TOKEN)
    assert (await broke.check(WALLET)).reason == "rpc_error"


@pytest.mark.asyncio
async def test_cancellation_propagates_rather_than_being_swallowed() -> None:
    """Fail-open must not mean 'keep a dead login alive' — a cancelled request must die."""

    class _CancellingRpc:
        async def call(self, method: str, params: list[Any]) -> Any:  # noqa: ARG002
            raise asyncio.CancelledError

    gate = SrkMainnetGate(rpc=_CancellingRpc(), token=TOKEN)
    with pytest.raises(asyncio.CancelledError):
        await gate.check(WALLET)
