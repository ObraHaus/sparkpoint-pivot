"""Deterministic 072 portfolio fixtures shared by the evals and the shared-JSON parity test.

The three modes are the ones the golden suite and the web contract need:

* ``ready`` — one priced row per source, plus two swap-history rows;
* ``degraded`` — Morpho and Rhea unavailable, Kamino not linked, swaps empty;
* ``empty`` — every section readable but with no rows.

The objects are built with the REAL production models, so ``to_wire()`` is the same code the API
and chat block use.
"""

from __future__ import annotations

from dataclasses import replace

from sparkpoint_agent.portfolio.models import (
    PortfolioOverview,
    PortfolioRow,
    PortfolioSection,
)

AS_OF = "2026-11-01T04:30:00+00:00"
WALLET = "0x2222222222222222222222222222222222222222"
NOT_LINKED = "Kamino positions show once you deposit to a Solana address from SparkPoint (Phase C)"


def _section(
    key: str,
    label: str,
    *,
    status: str = "ok",
    rows: tuple[PortfolioRow, ...] = (),
    reason: str | None = None,
    source: str | None = None,
    meta: dict[str, object] | None = None,
) -> PortfolioSection:
    return PortfolioSection(
        key=key,  # type: ignore[arg-type]
        label=label,
        status=status,  # type: ignore[arg-type]
        rows=rows,
        reason=reason,
        source=source,
        as_of=AS_OF,
        meta=meta or {},
    )


def _balances(status: str = "ok", rows: tuple[PortfolioRow, ...] = ()) -> PortfolioSection:
    return _section(
        "balances",
        "Wallet balances",
        status=status,
        rows=rows,
        source="rpc",
        meta={
            "chains": [
                {"chain": "base", "label": "Base", "status": "ok", "reason": None},
                {
                    "chain": "eth",
                    "label": "Ethereum",
                    "status": "unavailable",
                    "reason": "not configured",
                },
            ]
        },
    )


def _morpho(status: str = "ok", rows: tuple[PortfolioRow, ...] = ()) -> PortfolioSection:
    return _section(
        "morpho",
        "Morpho",
        status=status,
        rows=rows,
        reason=None if status == "ok" else "Morpho API is unreachable.",
        source="morpho_api",
    )


def _kamino(status: str = "ok", rows: tuple[PortfolioRow, ...] = ()) -> PortfolioSection:
    return _section(
        "kamino",
        "Kamino",
        status=status,
        rows=rows,
        reason=NOT_LINKED if status == "not_linked" else None,
        source="solana_rpc",
    )


def _rhea(status: str = "ok", rows: tuple[PortfolioRow, ...] = ()) -> PortfolioSection:
    return _section(
        "rhea",
        "Rhea",
        status=status,
        rows=rows,
        reason=None if status == "ok" else "The NEAR RPC read is unavailable right now.",
        source="rhea_rpc",
        meta={"mca": "eval.multica.near", "appUrl": "https://app.rhea.finance/lending"}
        if status == "ok"
        else {},
    )


def _swaps(rows: tuple[PortfolioRow, ...] = ()) -> PortfolioSection:
    return _section("swaps", "Cross-chain swaps", rows=rows, source="db")


def _swap_row(index: int, destination: str, amount_out: str) -> PortfolioRow:
    destination_label = "Solana USDC" if destination.startswith("sol:") else "NEAR USDC"
    destination_key = destination
    return PortfolioRow(
        chain="base",
        chain_label="Base",
        protocol="swap",
        kind="cross_chain_swap",
        symbol="USDC",
        amount="100",
        extra={
            "originKey": "base:USDC",
            "originLabel": "Base USDC",
            "destinationKey": destination_key,
            "destinationLabel": destination_label,
            "route": f"Base USDC -> {destination_label}",
            "depositAddress": f"0x{'ab' * 20}",
            "createdAt": f"2026-10-3{index}T00:00:00+00:00",
            "lastStatus": "SUCCESS",
            "amountOut": amount_out,
        },
    )


_READY_BALANCES = (
    PortfolioRow(
        chain="base",
        chain_label="Base",
        protocol="wallet",
        kind="native",
        symbol="ETH",
        amount="0.5",
        value_usd="2000.00",
        price_source="eth_test",
        extra={"decimals": 18, "priceUsd": "4000"},
    ),
    PortfolioRow(
        chain="base",
        chain_label="Base",
        protocol="wallet",
        kind="token",
        symbol="USDC",
        amount="100",
        value_usd="100.00",
        price_source="stablecoin_par",
        extra={"address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", "decimals": 6},
    ),
)

_READY_MORPHO = (
    PortfolioRow(
        chain="base",
        chain_label="Base",
        protocol="morpho",
        kind="vault_position",
        symbol="GTUSDC",
        amount="100",
        value_usd="100.00",
        price_source="stablecoin_par",
        extra={
            "vaultAddress": "0xeE8F4eC5672F09119b96Ab6fB59C27E1b7e44b61",
            "vaultName": "Gauntlet USDC Prime",
            "assetSymbol": "USDC",
            "decimals": 6,
            "netApy": "4.41",
            "shares": "100",
            "rail": "direct",
        },
    ),
)

_READY_KAMINO = (
    PortfolioRow(
        chain="sol",
        chain_label="Solana",
        protocol="kamino",
        kind="vault_position",
        symbol="kV-SOL",
        amount="1",
        value_usd=None,
        price_source="kamino_share_price_unavailable",
        extra={
            "vaultAddress": "DcCRSdUMgAt6ZMeuL4BJAsZmJgND2LQd74Zq4z6ckhpg",
            "vaultName": "SOL Balanced",
            "sharesMint": "5EBsGgVTubrd7ShJgE89k6nC2bnLzqGCjXb2ejrhtdBK",
            "assetSymbol": "SOL",
            "netApy": "4.45",
            "wallet": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        },
    ),
)

_READY_RHEA = (
    PortfolioRow(
        chain="near",
        chain_label="NEAR",
        protocol="rhea",
        kind="lending_position",
        symbol="USDC",
        amount="100",
        value_usd="100.00",
        price_source="stablecoin_par",
        extra={"apy": "14.05", "mca": "eval.multica.near"},
    ),
)


def portfolio_overview(mode: str) -> PortfolioOverview:
    """The deterministic overview for an eval mode (``ready`` / ``degraded`` / ``empty``)."""
    if mode == "ready":
        sections = (
            _balances(rows=_READY_BALANCES),
            _morpho(rows=_READY_MORPHO),
            _kamino(rows=_READY_KAMINO),
            _rhea(rows=_READY_RHEA),
            _swaps(rows=(_swap_row(1, "sol:USDC", "0.98"), _swap_row(2, "near:USDC", "99.9"))),
        )
    elif mode == "degraded":
        sections = (
            _balances(
                rows=(
                    PortfolioRow(
                        chain="base",
                        chain_label="Base",
                        protocol="wallet",
                        kind="token",
                        symbol="USDC",
                        amount="250",
                        value_usd="250.00",
                        price_source="stablecoin_par",
                        extra={"decimals": 6},
                    ),
                )
            ),
            _morpho(status="unavailable"),
            _kamino(status="not_linked"),
            _rhea(status="unavailable"),
            _swaps(),
        )
    else:
        sections = (
            _balances(),
            _morpho(),
            _kamino(),
            _rhea(),
            _swaps(),
        )
    return PortfolioOverview(wallet=WALLET, focus="all", as_of=AS_OF, sections=sections)


class EvalPortfolioService:
    """The duck-typed service the eval DAG reads (no network, no DB)."""

    def __init__(self, mode: str) -> None:
        self.mode = mode
        self.overview = portfolio_overview(mode)
        self.calls: list[tuple[str, str]] = []

    async def read(self, wallet: str, *, focus: str = "all") -> PortfolioOverview:
        self.calls.append((wallet, focus))
        return replace(self.overview, wallet=wallet, focus=focus)  # type: ignore[arg-type]


__all__ = [
    "AS_OF",
    "EvalPortfolioService",
    "NOT_LINKED",
    "WALLET",
    "portfolio_overview",
]
