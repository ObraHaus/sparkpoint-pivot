# ruff: noqa: S101
"""028 · the keyless SRK-faucet claim probe (chain/faucet_probe.py).

httpx transport is faked at the ASGI-free layer via a mock client — covers the arithmetic
(nextClaimAt − cooldown), the never-claimed zero, every failure mode, and the HARD time budget
(the 026 srk-gate review finding this probe deliberately fixes).
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

from sparkpoint_agent.chain.faucet_probe import FaucetProbe

_OWNER = "0x32Ed4400C5BBB394712c482F1207886d8C22e8b5"
_FAUCET = "0x93766a1C6c2076F658710770549af34Ac46dB2a9"

_NEXT_AT = 1_785_766_400  # 2026-08-03T14:13:20Z
_COOLDOWN = 86_400


class _Resp:
    def __init__(self, result: Any, status: int = 200):
        self.status_code = status
        self._result = result

    def json(self) -> dict[str, Any]:
        return {"jsonrpc": "2.0", "id": 1, "result": self._result}


class _FakeClient:
    """Answers eth_call by selector; injectable failures + delay."""

    def __init__(self, answers: dict[str, Any], *, delay: float = 0.0, status: int = 200):
        self.answers = answers
        self.delay = delay
        self.status = status

    async def __aenter__(self) -> _FakeClient:
        return self

    async def __aexit__(self, *args: Any) -> None:
        return None

    async def post(self, url: str, json: dict[str, Any], headers: Any = None) -> _Resp:
        if self.delay:
            await asyncio.sleep(self.delay)
        data = json["params"][0]["data"]
        selector = data[:10]
        return _Resp(self.answers.get(selector), status=self.status)



async def test_last_claim_is_next_claim_at_minus_cooldown() -> None:
    client = _FakeClient({"0x11a163e9": hex(_NEXT_AT), "0x787a08a6": hex(_COOLDOWN)})
    with patch("sparkpoint_agent.chain.faucet_probe.httpx.AsyncClient", lambda **_: client):
        got = await FaucetProbe("http://x", _FAUCET).last_claim_at(_OWNER)
    assert got == datetime.fromtimestamp(_NEXT_AT - _COOLDOWN, tz=UTC)


async def test_never_claimed_zero_reads_as_none() -> None:
    client = _FakeClient({"0x11a163e9": "0x" + "0" * 64, "0x787a08a6": hex(_COOLDOWN)})
    with patch("sparkpoint_agent.chain.faucet_probe.httpx.AsyncClient", lambda **_: client):
        assert await FaucetProbe("http://x", _FAUCET).last_claim_at(_OWNER) is None


async def test_http_error_reads_as_none() -> None:
    client = _FakeClient({}, status=500)
    with patch("sparkpoint_agent.chain.faucet_probe.httpx.AsyncClient", lambda **_: client):
        assert await FaucetProbe("http://x", _FAUCET).last_claim_at(_OWNER) is None


async def test_garbage_result_reads_as_none() -> None:
    client = _FakeClient({"0x11a163e9": "not-hex", "0x787a08a6": hex(_COOLDOWN)})
    with patch("sparkpoint_agent.chain.faucet_probe.httpx.AsyncClient", lambda **_: client):
        assert await FaucetProbe("http://x", _FAUCET).last_claim_at(_OWNER) is None


async def test_the_hard_budget_is_enforced_a_hung_rpc_costs_at_most_the_budget() -> None:
    client = _FakeClient(
        {"0x11a163e9": hex(_NEXT_AT), "0x787a08a6": hex(_COOLDOWN)}, delay=5.0
    )
    with patch("sparkpoint_agent.chain.faucet_probe.httpx.AsyncClient", lambda **_: client):
        started = asyncio.get_event_loop().time()
        got = await FaucetProbe("http://x", _FAUCET, budget_seconds=0.05).last_claim_at(_OWNER)
        elapsed = asyncio.get_event_loop().time() - started
    assert got is None
    assert elapsed < 1.0, "the probe must bail at its budget, not at the transport timeout"
