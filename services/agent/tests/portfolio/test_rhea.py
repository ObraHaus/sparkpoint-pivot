# ruff: noqa: S101
"""072 — Rhea positions reuse the 071 read path (mocked; no RPC)."""

from __future__ import annotations

from typing import Any

import pytest

from sparkpoint_agent.coordinator.chat_blocks import EarnPositionsBlock
from sparkpoint_agent.earn.service import EarnOutcome
from sparkpoint_agent.portfolio.rhea import RheaPositionsSource

WALLET = "0x2222222222222222222222222222222222222222"
MCA = "abc.multica.near"


class _Service:
    def __init__(self, block: EarnPositionsBlock) -> None:
        self.block = block
        self.wallets: list[str] = []

    async def rhea_positions(self, *, wallet: str) -> EarnOutcome:
        self.wallets.append(wallet)
        return EarnOutcome(text="", block=self.block)


def _block(**overrides: Any) -> EarnPositionsBlock:
    values: dict[str, Any] = {
        "state": "ready",
        "mca": MCA,
        "supplied": ({"symbol": "USDC", "amount": "100", "apy": "14.05"},),
        "app_url": "https://app.rhea.finance/lending",
    }
    values.update(overrides)
    return EarnPositionsBlock(**values)


@pytest.mark.asyncio
async def test_ready_positions_are_stablecoin_par_valued() -> None:
    service = _Service(_block())
    section = await RheaPositionsSource(service).collect(WALLET)  # type: ignore[arg-type]
    assert section.status == "ok"
    assert section.rows[0].symbol == "USDC"
    assert section.rows[0].amount == "100"
    assert section.rows[0].value_usd == "100.00"
    assert section.rows[0].extra["apy"] == "14.05"
    assert section.meta["mca"] == MCA
    assert service.wallets == [WALLET]


@pytest.mark.asyncio
async def test_empty_positions_stay_ok_with_an_explainer() -> None:
    section = await RheaPositionsSource(  # type: ignore[arg-type]
        _Service(_block(state="empty", mca=None, supplied=(), explainer="No Rhea account yet."))
    ).collect(WALLET)
    assert section.status == "ok"
    assert section.rows == ()
    assert section.meta["explainer"] == "No Rhea account yet."


@pytest.mark.asyncio
async def test_rpc_failure_is_unavailable() -> None:
    block = _block(state="unavailable", unavailable_reason="The NEAR RPC read is unavailable.")
    section = await RheaPositionsSource(_Service(block)).collect(WALLET)  # type: ignore[arg-type]
    assert section.status == "unavailable"
    assert section.reason == "The NEAR RPC read is unavailable."


@pytest.mark.asyncio
async def test_disabled_service_is_unavailable() -> None:
    section = await RheaPositionsSource(None).collect(WALLET)
    assert section.status == "unavailable"
    assert "not configured" in (section.reason or "")
