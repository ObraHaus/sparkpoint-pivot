"""Session EVM wallet balances on Base (and Ethereum when its RPC is configured).

Reads native ETH plus the four tokens already known to the earn/crosschain config (USDC, USDT,
WETH, cbBTC) with rate-correct human amounts. Only non-zero rows are emitted. Each chain is read
independently: one unavailable chain does not hide the other, and a chain with no RPC is honestly
``not configured`` rather than silently reading a different network.
"""

from __future__ import annotations

import asyncio
from collections.abc import Mapping
from decimal import Decimal
from typing import Any

import httpx

from .config import EvmChainConfig, PortfolioConfig, TokenConfig
from .models import PortfolioRow, PortfolioSection, human_amount
from .pricing import PriceSource, fetch_snapshot, price_row
from .rpc import EvmRpc, PortfolioRpcError


def _token_row(
    chain: EvmChainConfig,
    token: TokenConfig,
    raw: int,
    snapshot: Any,
) -> PortfolioRow | None:
    if raw <= 0:
        return None
    amount = Decimal(raw).scaleb(-token.decimals)
    value, price_source, price_usd = price_row(
        amount=amount,
        price_symbol=token.price_symbol,
        stable=token.stable,
        snapshot=snapshot,
    )
    extra: dict[str, Any] = {
        "address": token.address,
        "decimals": token.decimals,
    }
    if price_usd is not None:
        extra["priceUsd"] = price_usd
    return PortfolioRow(
        chain=chain.key,
        chain_label=chain.label,
        protocol="wallet",
        kind="token",
        symbol=token.symbol,
        amount=human_amount(amount),
        value_usd=value,
        price_source=price_source,
        extra=extra,
    )


def _native_row(
    chain: EvmChainConfig,
    raw: int,
    snapshot: Any,
) -> PortfolioRow | None:
    if raw <= 0:
        return None
    amount = Decimal(raw).scaleb(-18)
    value, price_source, price_usd = price_row(
        amount=amount,
        price_symbol="ETH",
        stable=False,
        snapshot=snapshot,
    )
    extra: dict[str, Any] = {"decimals": 18}
    if price_usd is not None:
        extra["priceUsd"] = price_usd
    return PortfolioRow(
        chain=chain.key,
        chain_label=chain.label,
        protocol="wallet",
        kind="native",
        symbol="ETH",
        amount=human_amount(amount),
        value_usd=value,
        price_source=price_source,
        extra=extra,
    )


class BalanceSource:
    """Collect the wallet's EVM balances, section by section."""

    def __init__(
        self,
        config: PortfolioConfig,
        pricer: PriceSource | None,
        *,
        transports: Mapping[str, httpx.AsyncBaseTransport] | None = None,
    ) -> None:
        self._config = config
        self._pricer = pricer
        self._transports = dict(transports or {})

    def _rpc(self, chain: EvmChainConfig) -> EvmRpc:
        assert chain.rpc_url is not None  # noqa: S101 - guarded by `configured`
        return EvmRpc(
            chain.rpc_url,
            transport=self._transports.get(chain.key),
            timeout_s=self._config.timeout_s,
        )

    async def _read_chain(
        self, chain: EvmChainConfig, wallet: str, snapshot: Any
    ) -> tuple[list[PortfolioRow], dict[str, Any]]:
        rpc = self._rpc(chain)
        calls: list[Any] = [rpc.native_balance(wallet)]
        calls.extend(rpc.token_balance(token.address, wallet) for token in chain.tokens)
        results = await asyncio.gather(*calls, return_exceptions=True)
        if any(isinstance(result, BaseException) for result in results):
            reasons = {str(result) for result in results if isinstance(result, PortfolioRpcError)}
            reason = next(iter(reasons), "RPC read failed")
            return [], {
                "chain": chain.key,
                "label": chain.label,
                "status": "unavailable",
                "reason": reason,
            }

        rows: list[PortfolioRow] = []
        native = _native_row(chain, int(results[0]), snapshot)  # type: ignore[arg-type]
        if native is not None:
            rows.append(native)
        for token, result in zip(chain.tokens, results[1:], strict=True):
            row = _token_row(chain, token, int(result), snapshot)  # type: ignore[arg-type]
            if row is not None:
                rows.append(row)
        return rows, {
            "chain": chain.key,
            "label": chain.label,
            "status": "ok",
            "reason": None,
        }

    async def collect(self, wallet: str, *, auth_chain: str = "evm") -> PortfolioSection:  # noqa: ARG002 - EVM/Solana/DB sources are only called for EVM sessions
        snapshot = await fetch_snapshot(self._pricer, ("ETH", "BTC"))
        rows: list[PortfolioRow] = []
        chains: list[dict[str, Any]] = []
        for chain in self._config.chains:
            if not chain.configured:
                chains.append(
                    {
                        "chain": chain.key,
                        "label": chain.label,
                        "status": "unavailable",
                        "reason": "not configured",
                    }
                )
                continue
            chain_rows, meta = await self._read_chain(chain, wallet, snapshot)
            rows.extend(chain_rows)
            chains.append(meta)

        readable = [meta for meta in chains if meta["status"] == "ok"]
        if not readable:
            reason = (
                "not configured"
                if not self._config.has_evm_rpc
                else next(
                    (meta["reason"] for meta in chains if meta.get("reason")),
                    "RPC read failed",
                )
            )
            return PortfolioSection(
                key="balances",
                label="Wallet balances",
                status="unavailable",
                reason=reason,
                source="rpc",
                meta={"chains": chains},
            )
        return PortfolioSection(
            key="balances",
            label="Wallet balances",
            status="ok",
            rows=tuple(rows),
            source="rpc",
            meta={"chains": chains},
        )


__all__ = ["BalanceSource"]
