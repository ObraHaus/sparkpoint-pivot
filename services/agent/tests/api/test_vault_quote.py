# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§3.7 vault deposit/withdraw quote endpoints (api/vault.py).

Everything runs against a MOCKED vault reader (no live vault / RPC / DB): the fake
returns preset on-chain values, the endpoints do the caps/fee arithmetic + shape the
§3.7 wire body. The crux is N2: the WITHDRAW quote is NEVER cap-, pause-, or fee-gated
(``test_withdraw_quote_is_ungated_while_paused_and_at_cap``) — the same paused, at-cap
vault yields a 200 withdraw quote but a 409 KILL_SWITCH_PAUSED on deposit.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.vault import get_vault_reader
from sparkpoint_agent.chain import VaultReader

_WAD = 10**18

TOKEN = "test-web-tier-token"
GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": "0x1111111111111111111111111111111111111111",
    "X-Owner": "0x2222222222222222222222222222222222222222",
    "X-Chain-Id": "8453",
}


class FakeVaultReader:
    """A structural stand-in for :class:`VaultReader` returning preset on-chain values.

    Preview/convert values are read straight from this fake exactly as the endpoint would
    read them from chain (never re-derived), so a test can prove the endpoint echoes the
    vault's round-DOWN preview verbatim by presetting a distinctly-floored value.
    """

    def __init__(
        self,
        *,
        paused: bool = False,
        block: int = 1_234_567,
        rate_bps: int = 1000,
        hwm: int = _WAD,
        total_assets: int = 0,
        balance: int = 0,
        pps: int = _WAD,
        preview_deposit: int | None = None,
        preview_mint: int | None = None,
        preview_redeem: int | None = None,
        preview_withdraw: int | None = None,
        max_deposit: int = 10**30,
        max_withdraw: int = 0,
        max_redeem: int = 0,
    ) -> None:
        self._paused = paused
        self._block = block
        self._rate_bps = rate_bps
        self._hwm = hwm
        self._total_assets = total_assets
        self._balance = balance
        self._pps = pps
        self._preview_deposit = preview_deposit
        self._preview_mint = preview_mint
        self._preview_redeem = preview_redeem
        self._preview_withdraw = preview_withdraw
        self._max_deposit = max_deposit
        self._max_withdraw = max_withdraw
        self._max_redeem = max_redeem

    async def paused(self) -> bool:
        return self._paused

    async def block_number(self) -> int:
        return self._block

    async def performance_fee_bps(self) -> int:
        return self._rate_bps

    async def high_water_mark(self) -> int:
        return self._hwm

    async def total_assets(self) -> int:
        return self._total_assets

    async def balance_of(self, owner: str) -> int:
        return self._balance

    async def convert_to_assets(self, shares: int) -> int:
        return shares * self._pps // _WAD

    async def preview_deposit(self, assets: int) -> int:
        if self._preview_deposit is not None:
            return self._preview_deposit
        return assets * _WAD // self._pps

    async def preview_mint(self, shares: int) -> int:
        if self._preview_mint is not None:
            return self._preview_mint
        return shares * self._pps // _WAD

    async def preview_redeem(self, shares: int) -> int:
        if self._preview_redeem is not None:
            return self._preview_redeem
        return shares * self._pps // _WAD

    async def preview_withdraw(self, assets: int) -> int:
        if self._preview_withdraw is not None:
            return self._preview_withdraw
        return assets * _WAD // self._pps

    async def max_deposit(self, receiver: str) -> int:
        return self._max_deposit

    async def max_withdraw(self, owner: str) -> int:
        return self._max_withdraw

    async def max_redeem(self, owner: str) -> int:
        return self._max_redeem


class ExplodingTransport:
    """A JSON-RPC transport that fails the test if the endpoint ever issues an RPC call —
    proves an undeployed vault fails closed WITHOUT touching the network."""

    async def call(self, method: str, params: Sequence[Any]) -> str:
        raise AssertionError(f"no RPC should be issued for an undeployed vault; got {method!r}")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _use(reader: object) -> None:
    app.dependency_overrides[get_vault_reader] = lambda: reader


# ── Deposit quote ────────────────────────────────────────────────────────────────


def test_deposit_quote_by_assets_shape_and_fee(client: TestClient) -> None:
    # hwm = 1.0423e18 → rendered "1.0423"; previewDeposit preset to the floored share count.
    _use(FakeVaultReader(hwm=1_042_300_000_000_000_000, preview_deposit=98_765_432, block=42))
    resp = client.post(
        "/vault/quote/deposit", json={"by": "assets", "amount": "100000000"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["by"] == "assets"
    assert body["assets"] == "100000000"
    assert body["shares"] == "98765432"  # echoes previewDeposit verbatim (round-DOWN)
    # APY leg is best-effort (no live Aave feed) → null + stale, never fabricated.
    assert body["grossApyBps"] is None
    assert body["netApyBps"] is None
    assert body["stale"] is True
    assert body["asOfBlock"] == 42
    fee = body["performanceFee"]
    assert fee["rateBps"] == 1000
    assert fee["maxRateBps"] == 2000  # hard cap from GOVERNANCE.performance_fee.ceiling_bps
    assert fee["base"] == "realized_yield_above_hwm"
    assert fee["managementBps"] == 0
    assert fee["entryBps"] == 0
    assert fee["exitBps"] == 0
    assert fee["principalBps"] == 0
    assert fee["highWaterMark"] == "1.0423"
    assert fee["active"] is True
    assert fee["provableOnchain"] is True
    assert "profit-only" in fee["disclosure"]


def test_deposit_quote_shares_echoes_previewdeposit_not_rederived(client: TestClient) -> None:
    # pps = 1.01e18 would give a DIFFERENT naive share count; the endpoint must return the
    # vault's previewDeposit value verbatim (round-DOWN in the vault's favor), not re-derive.
    _use(FakeVaultReader(pps=1_010_000_000_000_000_000, preview_deposit=98_765_432))
    resp = client.post(
        "/vault/quote/deposit", json={"by": "assets", "amount": "100000000"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 200
    assert resp.json()["shares"] == "98765432"  # not 99009900 (the naive re-derivation)


def test_deposit_quote_over_cap_prefers_200_would_breach(client: TestClient) -> None:
    # On-chain maxDeposit is the tightest limit at 50 USDC; a 100 USDC deposit breaches it.
    _use(FakeVaultReader(max_deposit=50_000_000, preview_deposit=49_000_000))
    resp = client.post(
        "/vault/quote/deposit", json={"by": "assets", "amount": "100000000"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 200  # FR-025 — no CAP_EXCEEDED error; UI blocks pre-sign
    caps = resp.json()["caps"]
    assert caps["wouldBreach"] is True
    assert caps["maxDeposit"] == "50000000"


def test_deposit_quote_within_cap_would_not_breach(client: TestClient) -> None:
    _use(FakeVaultReader(max_deposit=50_000_000, preview_deposit=9_000_000))
    resp = client.post(
        "/vault/quote/deposit", json={"by": "assets", "amount": "10000000"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 200
    assert resp.json()["caps"]["wouldBreach"] is False


def test_deposit_quote_paused_returns_kill_switch(client: TestClient) -> None:
    _use(FakeVaultReader(paused=True))
    resp = client.post(
        "/vault/quote/deposit", json={"by": "assets", "amount": "100000000"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 409
    assert resp.json()["error"]["code"] == "KILL_SWITCH_PAUSED"


# ── Withdraw quote ───────────────────────────────────────────────────────────────


def test_withdraw_quote_by_shares_shape(client: TestClient) -> None:
    _use(
        FakeVaultReader(
            preview_redeem=100_250_000, max_withdraw=100_250_000, max_redeem=98_765_432
        )
    )
    resp = client.post(
        "/vault/quote/withdraw", json={"by": "shares", "amount": "98765432"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["by"] == "shares"
    assert body["shares"] == "98765432"
    assert body["assets"] == "100250000"  # previewRedeem — already net of fee-share dilution
    assert body["maxWithdraw"] == "100250000"
    assert body["maxRedeem"] == "98765432"
    assert body["exitHatchUrl"] == "/exit"
    assert body["stale"] is False
    # Cost-basis breakdown needs the derived index (fee indexer) → null, never fabricated.
    assert body["principalUsd"] is None
    assert body["accruedYieldUsd"] is None
    fee = body["performanceFee"]
    assert fee["doesNotGateWithdraw"] is True
    assert fee["base"] == "realized_yield_above_hwm"
    assert fee["netYieldUsd"] is None
    # At/below the HWM the profit-only fee is provably 0 from chain reads alone.
    assert fee["estFeeOnYieldUsd"] == "0.00"


def test_withdraw_quote_est_fee_null_above_hwm(client: TestClient) -> None:
    # Share price above the HWM → the per-exit fee needs cost basis (not yet indexed) → null.
    _use(FakeVaultReader(pps=1_050_000_000_000_000_000, hwm=_WAD, preview_redeem=100_250_000))
    resp = client.post(
        "/vault/quote/withdraw", json={"by": "shares", "amount": "98765432"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 200
    assert resp.json()["performanceFee"]["estFeeOnYieldUsd"] is None


def test_withdraw_quote_by_assets_uses_preview_withdraw(client: TestClient) -> None:
    _use(FakeVaultReader(preview_withdraw=98_765_433))
    resp = client.post(
        "/vault/quote/withdraw", json={"by": "assets", "amount": "100250000"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["assets"] == "100250000"
    assert body["shares"] == "98765433"  # previewWithdraw (shares to burn; rounds UP)


def test_withdraw_quote_is_ungated_while_paused_and_at_cap(client: TestClient) -> None:
    """THE crux N2 test: a paused, at-cap vault still returns a clean 200 withdraw quote
    (doesNotGateWithdraw:true), while the SAME reader returns 409 KILL_SWITCH_PAUSED on
    deposit. Proves the withdraw quote has no pause/cap gate (agent-service-api.md §3.7, N2)."""
    reader = FakeVaultReader(
        paused=True,            # kill-switch engaged
        max_deposit=0,          # deposit caps fully exhausted
        max_withdraw=100_250_000,
        max_redeem=98_765_432,
        preview_redeem=100_250_000,
    )
    _use(reader)

    withdraw = client.post(
        "/vault/quote/withdraw", json={"by": "shares", "amount": "98765432"}, headers=GOOD_HEADERS
    )
    assert withdraw.status_code == 200
    wbody = withdraw.json()
    assert "error" not in wbody  # NEVER KILL_SWITCH_PAUSED / CAP_EXCEEDED on withdraw
    assert wbody["assets"] == "100250000"
    assert wbody["performanceFee"]["doesNotGateWithdraw"] is True

    # Contrast: the exact same paused, at-cap vault gates the DEPOSIT quote.
    deposit = client.post(
        "/vault/quote/deposit", json={"by": "shares", "amount": "98765432"}, headers=GOOD_HEADERS
    )
    assert deposit.status_code == 409
    assert deposit.json()["error"]["code"] == "KILL_SWITCH_PAUSED"


# ── Fail-closed: undeployed vault → clean §1.5 envelope (never a fabricated quote) ──


def test_deposit_undeployed_vault_is_simulation_unavailable(client: TestClient) -> None:
    # Real reader, no vault address: the first view-read fails closed WITHOUT any RPC call.
    _use(VaultReader(vault_address=None, transport=ExplodingTransport()))
    resp = client.post(
        "/vault/quote/deposit", json={"by": "assets", "amount": "100000000"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "SIMULATION_UNAVAILABLE"


def test_withdraw_undeployed_vault_is_simulation_unavailable(client: TestClient) -> None:
    _use(VaultReader(vault_address=None, transport=ExplodingTransport()))
    resp = client.post(
        "/vault/quote/withdraw", json={"by": "shares", "amount": "98765432"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 503
    assert resp.json()["error"]["code"] == "SIMULATION_UNAVAILABLE"


# ── Auth + validation still apply on the quote routes ──────────────────────────────


def test_quote_requires_auth(client: TestClient) -> None:
    _use(FakeVaultReader())
    resp = client.post("/vault/quote/deposit", json={"by": "assets", "amount": "1"})
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


def test_quote_bad_amount_is_validation_error(client: TestClient) -> None:
    _use(FakeVaultReader())
    resp = client.post(
        "/vault/quote/deposit", json={"by": "assets", "amount": "-5"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"


def test_quote_bad_by_is_validation_error(client: TestClient) -> None:
    _use(FakeVaultReader())
    resp = client.post(
        "/vault/quote/deposit", json={"by": "usd", "amount": "1"}, headers=GOOD_HEADERS
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "VALIDATION_ERROR"
