# ruff: noqa: S101, S105  (pytest asserts; the token is a test fixture, not a secret)
"""§3.3 portfolio endpoints (api/portfolio.py).

Everything runs against a MOCKED vault reader (no live vault / RPC / DB). The crux of §3.3
is the stale-markable posture: a chain outage DEGRADES to ``200 + stale:true`` (custody
balances reconcile via the frontend's direct RPC, SC-011) instead of the hard 503 the §3.7
quote surface returns — see ``test_portfolio_degrades_to_stale_not_error``. Derived figures
that need the (unbuilt) cost-basis/event index are ``null``/``[]``, never fabricated.
"""

from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import Any

import pytest
from fastapi.testclient import TestClient

from sparkpoint_agent.api.main import app
from sparkpoint_agent.api.portfolio import get_rec_store, get_vault_flow_reader
from sparkpoint_agent.api.recommendations import get_agent_config
from sparkpoint_agent.api.vault import get_vault_reader
from sparkpoint_agent.chain import VaultReader
from sparkpoint_agent.config import AgentConfig
from sparkpoint_agent.db.vault_flows import CostBasis, FlowRow

VAULT = "0x15D269B1D4fb3581E5a47482A70215e63Ed547f2"


class _FakeRecStore:
    """In-memory RecommendationStore stand-in (US5): seeded acted recs / snapshots, no DB.

    Defaults to empty — the pre-US5 outcomes tests then see ``recommendations == []`` (no acted
    advice), unchanged. The attribution tests seed ``acted`` (drives /outcomes rec rows) and
    ``recs``/``deposit_tx`` (drive the /outcomes/{recId} detail read).
    """

    def __init__(
        self,
        acted: list[Any] | None = None,
        recs: dict[Any, Any] | None = None,
        deposit_tx: dict[Any, str] | None = None,
    ) -> None:
        self._acted = acted or []
        self._recs = recs or {}
        self._deposit_tx = deposit_tx or {}

    async def list_acted(self, wallet: str, *, limit: int = 100) -> list[Any]:
        return self._acted

    async def get(self, rec_id: Any) -> Any | None:
        return self._recs.get(rec_id)

    async def deposit_tx_for(self, rec_id: Any) -> str | None:
        return self._deposit_tx.get(rec_id)


class _FakeFlowReader:
    """In-memory cost-basis + flow-list reader (no DB)."""

    def __init__(self, basis: CostBasis | None = None, flows: list[FlowRow] | None = None) -> None:
        self._basis = basis or CostBasis(0, 0, 0)
        self._flows = flows or []

    async def cost_basis(self, network_id: str, vault: str, owner: str) -> CostBasis:
        return self._basis

    async def list_flows(
        self, network_id: str, vault: str, owner: str, limit: int = 50
    ) -> list[FlowRow]:
        return self._flows[:limit]


_WAD = 10**18


def _dep(assets: int, shares: int, block: int, log: int = 0) -> FlowRow:
    return FlowRow(
        kind="deposit",
        assets=assets,
        shares=shares,
        block_number=block,
        log_index=log,
        tx_hash="0xd",
    )


def _wd(assets: int, shares: int, block: int, log: int = 0) -> FlowRow:
    return FlowRow(
        kind="withdraw",
        assets=assets,
        shares=shares,
        block_number=block,
        log_index=log,
        tx_hash="0xw",
    )


TOKEN = "test-web-tier-token"
USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
GOOD_HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "X-Account": "0x1111111111111111111111111111111111111111",
    "X-Owner": "0x2222222222222222222222222222222222222222",
    "X-Chain-Id": "8453",
}


class FakePortfolioReader:
    """A structural stand-in for :class:`VaultReader` returning preset on-chain values.

    ``convertToAssets`` mirrors the chain read exactly (never re-derived in Python); with the
    default ``pps == 1e18`` the underlying equals the share balance, so a test can preset a
    distinct ``balance`` and assert the endpoint echoes it verbatim.
    """

    def __init__(
        self,
        *,
        balance: int = 0,
        pps: int = _WAD,
        asset_address: str = USDC,
        block: int = 1_234_567,
        idle: int = 0,
        native: int = 0,
    ) -> None:
        self._balance = balance
        self._pps = pps
        self._asset = asset_address
        self._block = block
        self._idle = idle
        self._native = native

    async def balance_of(self, owner: str) -> int:
        return self._balance

    async def convert_to_assets(self, shares: int) -> int:
        return shares * self._pps // _WAD

    async def asset(self) -> str:
        return self._asset

    async def token_balance_of(self, token: str, owner: str) -> int:
        return self._idle

    async def native_balance(self, owner: str) -> int:
        return self._native

    async def block_number(self) -> int:
        return self._block


class ExplodingTransport:
    """Fails the test if any RPC is issued — proves an undeployed vault degrades WITHOUT
    touching the network (the reader raises NOT_DEPLOYED before any eth_call)."""

    async def call(self, method: str, params: Sequence[Any]) -> str:
        raise AssertionError(f"no RPC should be issued for an undeployed vault; got {method!r}")


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setenv("AGENT_S2S_TOKEN", TOKEN)
    yield TestClient(app)
    app.dependency_overrides.clear()


def _use(
    reader: object,
    *,
    basis: CostBasis | None = None,
    flows: list[FlowRow] | None = None,
    rec_store: _FakeRecStore | None = None,
) -> None:
    app.dependency_overrides[get_vault_reader] = lambda: reader
    # B2: the portfolio endpoint now derives PnL from indexed flows + reads the vault address from
    # config — provide in-memory fakes (no DB) so the cost-basis path is exercised without Postgres.
    app.dependency_overrides[get_vault_flow_reader] = lambda: _FakeFlowReader(basis, flows)
    # US5: /outcomes + /outcomes/{recId} resolve acted-on recs via the store — a DB-free fake.
    app.dependency_overrides[get_rec_store] = lambda: rec_store or _FakeRecStore()
    app.dependency_overrides[get_agent_config] = lambda: AgentConfig(
        chain_id=84532, rpc_url=None, vault_address=VAULT, database_url=None
    )


# ── GET /portfolio ────────────────────────────────────────────────────────────────


def test_portfolio_returns_enriched_position(client: TestClient) -> None:
    # 100.25 USDC held (6dp) → valueUsd "100.25"; convertToAssets echoed verbatim.
    _use(FakePortfolioReader(balance=100_250_000, block=42))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is False
    assert body["asOfBlock"] == 42
    assert body["netWorthUsd"] == "100.25"
    assert len(body["positions"]) == 1
    pos = body["positions"][0]
    assert pos["venue"] == "vault"
    assert pos["asset"] == USDC
    assert pos["shares"] == "100250000"
    assert pos["underlying"] == "100250000"
    assert pos["valueUsd"] == "100.25"
    assert pos["priceSource"] == "onchain"
    assert pos["riskTier"] == "conservative"
    # Cost basis / PnL need the derived index (fee indexer) → null, never fabricated.
    assert pos["costBasisUsd"] is None
    assert pos["unrealizedPnlUsd"] is None
    # Single holding ⇒ 100% concentration; allocation is one full slice per bucket.
    assert body["risk"]["concentrationBps"] == 10_000
    assert body["risk"]["score"] is None
    assert body["allocation"]["byAsset"][0]["bps"] == 10_000
    assert body["allocation"]["byStrategy"][0]["key"] == "vault"
    assert body["pnl"]["series"] == []
    sources = body["dataSources"]
    assert sources[0]["status"] == "ok"
    assert sources[0]["lastBlock"] == 42


_PPS_1_2 = 1_200_000_000_000_000_000  # pps 1.2 (18-dp) — 250M shares → 300M underlying


def test_portfolio_pnl_from_indexed_cost_basis(client: TestClient) -> None:
    # Deposit 250 USDC for 250M shares (pps 1); pps rises to 1.2 → value 300, avg cost 250,
    # unrealized +50, realized 0 (no withdrawals yet). Reconstructed shares == balance → reconciles.
    _use(
        FakePortfolioReader(balance=250_000_000, pps=_PPS_1_2, block=42),
        flows=[_dep(250_000_000, 250_000_000, 10)],
    )
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    pos = body["positions"][0]
    assert pos["costBasisUsd"] == "250.00"
    assert pos["unrealizedPnlUsd"] == "50.00"
    assert pos["realizedPnlUsd"] == "0.00"
    assert body["pnl"]["unrealizedUsd"] == "50.00"
    assert body["pnl"]["realizedUsd"] == "0.00"


def test_portfolio_realized_pnl_from_withdrawal(client: TestClient) -> None:
    # Deposit 100 (100M shares @pps1), pps→1.2, withdraw 60 (redeem 50M shares). Held 50M shares
    # worth 60 (avg cost 50 → unrealized +10); realized on the withdrawal +10. Sum == lifetime PnL.
    _use(
        FakePortfolioReader(balance=50_000_000, pps=_PPS_1_2, block=42),
        flows=[_dep(100_000_000, 100_000_000, 10), _wd(60_000_000, 50_000_000, 20)],
    )
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    assert body["pnl"]["realizedUsd"] == "10.00"
    assert body["pnl"]["unrealizedUsd"] == "10.00"
    assert body["positions"][0]["costBasisUsd"] == "50.00"


def test_portfolio_pnl_null_when_history_incomplete(client: TestClient) -> None:
    # Indexed flows reconstruct 100M shares but the on-chain balance is 150M (a newer, un-indexed
    # deposit) → history does not reconcile → all PnL null (honest, never a partial-history guess).
    _use(
        FakePortfolioReader(balance=150_000_000, pps=_WAD),
        flows=[_dep(100_000_000, 100_000_000, 10)],
    )
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    assert body["positions"][0]["costBasisUsd"] is None
    assert body["positions"][0]["realizedPnlUsd"] is None
    assert body["pnl"]["unrealizedUsd"] is None
    assert body["pnl"]["realizedUsd"] is None


def test_portfolio_pnl_null_when_no_flows_indexed(client: TestClient) -> None:
    # No indexed flows → cost basis + PnL are null (honest), never fabricated.
    _use(FakePortfolioReader(balance=300_000_000), flows=[])
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    assert body["positions"][0]["costBasisUsd"] is None
    assert body["positions"][0]["unrealizedPnlUsd"] is None
    assert body["pnl"]["unrealizedUsd"] is None


def test_portfolio_surfaces_idle_cash_and_includes_it_in_net_worth(client: TestClient) -> None:
    # 100.25 USDC in the vault + 50.00 idle in the wallet → idleUsdc "50.00", netWorth "150.25".
    _use(FakePortfolioReader(balance=100_250_000, idle=50_000_000, block=42))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["idleUsdc"] == "50.00"
    assert body["netWorthUsd"] == "150.25"  # vault value + idle cash
    assert body["positions"][0]["valueUsd"] == "100.25"  # the position itself is vault-only


def test_portfolio_surfaces_native_balance_not_in_usd(client: TestClient) -> None:
    # §B3: native coin balance (wei) surfaces as a raw string, and is NOT folded into netWorthUsd
    # (no oracle) — vault value + idle USDC only.
    _use(FakePortfolioReader(balance=100_250_000, native=15_046_150_000_000_000, block=42))
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    assert body["nativeBalanceWei"] == "15046150000000000"
    assert body["nativeSymbol"] == "ETH"
    assert body["netWorthUsd"] == "100.25"  # native ETH is NOT valued into net worth


def test_portfolio_empty_when_no_shares_still_reports_idle(client: TestClient) -> None:
    # No vault shares but idle cash present → no position, but idle surfaces (available to deposit).
    _use(FakePortfolioReader(balance=0, idle=25_000_000))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["positions"] == []
    assert body["idleUsdc"] == "25.00"
    assert body["netWorthUsd"] == "25.00"


def test_portfolio_empty_when_no_shares(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=0))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is False
    assert body["positions"] == []
    assert body["idleUsdc"] == "0.00"
    assert body["netWorthUsd"] == "0.00"
    assert body["allocation"]["byAsset"] == []
    assert body["risk"]["concentrationBps"] == 0


def test_portfolio_degrades_to_stale_not_error(client: TestClient) -> None:
    """THE §3.3 crux: an undeployed/unreachable vault DEGRADES to 200 + stale:true (never a
    hard 503) so the frontend reconciles custody balances via direct RPC (SC-011)."""
    _use(VaultReader(vault_address=None, transport=ExplodingTransport()))
    resp = client.get("/portfolio", headers=GOOD_HEADERS)
    assert resp.status_code == 200  # NOT 503 — unlike the §3.7 quote surface
    body = resp.json()
    assert body["stale"] is True
    assert body["positions"] == []
    assert body["dataSources"][0]["status"] == "stale"
    assert body["dataSources"][0]["lastBlock"] is None


def test_portfolio_include_filter_omits_unrequested_sections(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=100_250_000))
    resp = client.get("/portfolio?include=positions", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["positions"]) == 1
    # Unrequested derived sections are omitted (null), positions still present.
    assert body["allocation"] is None
    assert body["pnl"] is None
    assert body["risk"] is None


def test_portfolio_requires_auth(client: TestClient) -> None:
    _use(FakePortfolioReader())
    resp = client.get("/portfolio")
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "UNAUTHENTICATED"


# ── GET /portfolio/positions/{positionId} ───────────────────────────────────────────


def test_position_detail_found(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=100_250_000, block=99))
    resp = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["position"]["positionId"] == "vault"
    assert body["position"]["valueUsd"] == "100.25"
    assert body["asOfBlock"] == 99
    # History + per-position series need the (unbuilt) event index → empty, never fabricated.
    assert body["onchainEvents"] == []
    assert body["pnlSeries"] == []


def test_position_detail_lists_indexed_transactions(client: TestClient) -> None:
    # §tx: the indexed Deposit/Withdraw flows surface as onchainEvents (newest first), USD-valued,
    # with the exact block + tx hash and an APPROXIMATE age from block height.
    flows = [
        FlowRow(
            kind="deposit",
            assets=250_000_000,
            shares=125_000_000,
            block_number=44_248_630,
            log_index=0,
            tx_hash="0x" + "ab" * 32,
        ),
        FlowRow(
            kind="withdraw",
            assets=100_000_001,
            shares=100_000_000,
            block_number=44_136_012,
            log_index=0,
            tx_hash="0x" + "cd" * 32,
        ),
    ]
    _use(FakePortfolioReader(balance=125_000_000, block=44_251_000), flows=flows)
    body = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS).json()
    evs = body["onchainEvents"]
    assert len(evs) == 2
    assert evs[0]["kind"] == "deposit"
    assert evs[0]["amountUsd"] == "250.00"
    assert evs[0]["blockNumber"] == 44_248_630
    assert evs[0]["txHash"] == "0x" + "ab" * 32
    assert evs[0]["tsApprox"]  # a non-empty ISO estimate
    assert evs[1]["kind"] == "withdraw"
    assert evs[1]["amountUsd"] == "100.00"


def test_position_detail_no_transactions_when_unindexed(client: TestClient) -> None:
    # No indexed flows → empty transaction list (honest, never fabricated).
    _use(FakePortfolioReader(balance=125_000_000), flows=[])
    body = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS).json()
    assert body["onchainEvents"] == []


def test_portfolio_value_history_series_from_flows(client: TestClient) -> None:
    # §history: the net-worth (position value) series is derived from the indexed flows' implied pps
    # (assets/shares) + the current value. deposit 100 (pps 1) → withdraw all → deposit 250 (pps 2)
    # → now (250 held). Values: 100 → 0 → 250 → 250.
    flows = [
        FlowRow(
            kind="deposit",
            assets=100_000_000,
            shares=100_000_000,
            block_number=44_135_823,
            log_index=0,
            tx_hash="0x" + "11" * 32,
        ),
        FlowRow(
            kind="withdraw",
            assets=100_000_001,
            shares=100_000_000,
            block_number=44_136_012,
            log_index=0,
            tx_hash="0x" + "22" * 32,
        ),
        FlowRow(
            kind="deposit",
            assets=250_000_000,
            shares=125_000_000,
            block_number=44_248_630,
            log_index=0,
            tx_hash="0x" + "33" * 32,
        ),
    ]
    # pps == 2e18 so convertToAssets(125M shares) == 250M (matches the last deposit's implied pps).
    _use(FakePortfolioReader(balance=125_000_000, pps=2 * _WAD, block=44_251_000), flows=flows)
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    series = body["pnl"]["series"]
    # Densified with a real PRE-event re-mark before each flow (skipped on the first, nothing held):
    # deposit→100, [pre-withdraw re-mark 100], withdraw→0, deposit→250, now→250.
    assert [p["valueUsd"] for p in series] == ["100.00", "100.00", "0.00", "250.00", "250.00"]
    assert all(p["ts"] for p in series)  # every point carries a (approx) timestamp


def test_portfolio_value_history_respects_intra_block_order(client: TestClient) -> None:
    # Same-block deposit (log_index 2) THEN withdraw (log_index 5), returned in the WRONG order.
    # The series must still replay in (block, log_index) order: deposit→100, withdraw→0.
    flows = [
        FlowRow(
            kind="withdraw",
            assets=100_000_000,
            shares=100_000_000,
            block_number=500,
            log_index=5,
            tx_hash="0x" + "bb" * 32,
        ),
        FlowRow(
            kind="deposit",
            assets=100_000_000,
            shares=100_000_000,
            block_number=500,
            log_index=2,
            tx_hash="0x" + "aa" * 32,
        ),
    ]
    # balance=1 so the position is still "held" (the series needs position.held).
    _use(FakePortfolioReader(balance=1, pps=_WAD, block=600), flows=flows)
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    vals = [p["valueUsd"] for p in body["pnl"]["series"]]
    # (block, log_index) order: deposit→100 (no pre-mark on the first flow), then the withdraw's
    # pre-event re-mark (100), then post-withdraw→0 — deposit effect strictly before the withdraw's.
    assert vals[0] == "100.00"
    assert vals[1] == "100.00"
    assert vals[2] == "0.00"


def test_portfolio_value_history_empty_when_no_flows(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=125_000_000, pps=2 * _WAD), flows=[])
    body = client.get("/portfolio", headers=GOOD_HEADERS).json()
    assert body["pnl"]["series"] == []


def test_position_detail_surfaces_indexed_pnl(client: TestClient) -> None:
    # Detail view must match the list view: deposit 250 (pps 1), pps→1.2 → value 300, avg cost 250,
    # unrealized "50.00", realized "0.00" (no withdrawals).
    _use(
        FakePortfolioReader(balance=250_000_000, pps=_PPS_1_2, block=99),
        flows=[_dep(250_000_000, 250_000_000, 10)],
    )
    body = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS).json()
    assert body["position"]["costBasisUsd"] == "250.00"
    assert body["position"]["unrealizedPnlUsd"] == "50.00"
    assert body["position"]["realizedPnlUsd"] == "0.00"


def test_position_detail_unknown_id_is_not_found(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=100_250_000))
    resp = client.get("/portfolio/positions/does-not-exist", headers=GOOD_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_position_detail_zero_shares_is_not_found(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=0))
    resp = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS)
    assert resp.status_code == 404
    assert resp.json()["error"]["code"] == "NOT_FOUND"


def test_position_detail_degrades_to_stale_shell(client: TestClient) -> None:
    # A degraded read cannot confirm the position; return a stale shell (200), not an error.
    _use(VaultReader(vault_address=None, transport=ExplodingTransport()))
    resp = client.get("/portfolio/positions/vault", headers=GOOD_HEADERS)
    assert resp.status_code == 200
    body = resp.json()
    assert body["stale"] is True
    assert body["position"]["positionId"] == "vault"
    assert body["position"]["valueUsd"] == "0.00"


# ── GET /outcomes (§018/US5 — realized-outcomes ledger) ──────────────────────────


def test_outcomes_reconciled_gain_row(client: TestClient) -> None:
    # deposit 100M shares/100M @ pps1 → withdraw 50M shares for 60M assets => realized +10M.
    _use(
        FakePortfolioReader(balance=50_000_000, block=100),
        flows=[_dep(100_000_000, 100_000_000, 10), _wd(60_000_000, 50_000_000, 20)],
    )
    body = client.get("/outcomes", headers=GOOD_HEADERS).json()
    assert body["reconciles"] is True
    assert body["netRealizedUsd"] == "10.00"
    assert body["wins"] == 1 and body["losses"] == 0
    assert len(body["outcomes"]) == 1
    row = body["outcomes"][0]
    assert row["realizedUsd"] == "10.00"
    assert row["kind"] == "gain"
    assert row["amountUsd"] == "60.00"
    assert row["txHash"] == "0xw"  # the withdrawal's own tx = its on-chain proof


def test_outcomes_reconciled_loss_row(client: TestClient) -> None:
    # withdraw 50M shares (cost 50M) for only 40M assets => realized −10M (a loss, shown plainly).
    _use(
        FakePortfolioReader(balance=50_000_000, block=100),
        flows=[_dep(100_000_000, 100_000_000, 10), _wd(40_000_000, 50_000_000, 20)],
    )
    body = client.get("/outcomes", headers=GOOD_HEADERS).json()
    assert body["reconciles"] is True
    assert body["netRealizedUsd"] == "-10.00"
    assert body["wins"] == 0 and body["losses"] == 1
    assert body["outcomes"][0]["kind"] == "loss"
    assert body["outcomes"][0]["realizedUsd"] == "-10.00"


def test_outcomes_multi_withdrawal_newest_first(client: TestClient) -> None:
    # wd1 @block20: +10M gain; wd2 @block30 burns the rest for 20M (cost 50M) => −30M loss.
    _use(
        FakePortfolioReader(balance=0, block=100),
        flows=[
            _dep(100_000_000, 100_000_000, 10),
            _wd(60_000_000, 50_000_000, 20),
            _wd(20_000_000, 50_000_000, 30),
        ],
    )
    body = client.get("/outcomes", headers=GOOD_HEADERS).json()
    assert body["reconciles"] is True  # fully exited (held 0 == balance 0)
    assert body["wins"] == 1 and body["losses"] == 1
    assert body["netRealizedUsd"] == "-20.00"
    # Newest-first: the block-30 loss precedes the block-20 gain.
    assert [o["kind"] for o in body["outcomes"]] == ["loss", "gain"]


def test_outcomes_unreconciled_is_empty_and_honest(client: TestClient) -> None:
    # The on-chain balance (999) doesn't match the reconstructed shares (50M) → no partial guess.
    _use(
        FakePortfolioReader(balance=999, block=100),
        flows=[_dep(100_000_000, 100_000_000, 10), _wd(60_000_000, 50_000_000, 20)],
    )
    body = client.get("/outcomes", headers=GOOD_HEADERS).json()
    assert body["reconciles"] is False
    assert body["outcomes"] == []
    assert body["netRealizedUsd"] is None
    assert body["wins"] == 0 and body["losses"] == 0


def test_outcomes_deposits_only_reconciles_but_empty(client: TestClient) -> None:
    _use(
        FakePortfolioReader(balance=100_000_000, block=100),
        flows=[_dep(100_000_000, 100_000_000, 10)],
    )
    body = client.get("/outcomes", headers=GOOD_HEADERS).json()
    assert body["reconciles"] is True  # complete history, just no withdrawals yet
    assert body["outcomes"] == []
    assert body["netRealizedUsd"] == "0.00"


def test_outcomes_stale_vault_degrades_to_empty(client: TestClient) -> None:
    _use(VaultReader(vault_address=None, transport=ExplodingTransport()))
    body = client.get("/outcomes", headers=GOOD_HEADERS).json()
    assert body["stale"] is True
    assert body["reconciles"] is False
    assert body["outcomes"] == []


def test_outcomes_requires_auth(client: TestClient) -> None:
    _use(FakePortfolioReader(balance=50_000_000))
    assert client.get("/outcomes").status_code in (401, 403)
