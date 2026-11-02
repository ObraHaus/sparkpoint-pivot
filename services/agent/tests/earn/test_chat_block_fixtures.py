# ruff: noqa: S101
"""069 — the Python→TypeScript earn chat-block contract cannot drift.

The SAME JSON fixtures are parsed by `packages/shared/tests/earn-chat-block.test.ts` with
`ChatBlockSchema`. Each test here regenerates the real `EarnVaultsBlock.to_wire()` /
`EarnQuoteBlock.to_wire()` output through `EarnService`, with a mocked 1Click transport, and asserts
exact equality — so a field rename/nullability change on either side fails one of the two suites.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import pytest

from sparkpoint_agent.crosschain.oneclick import OneClickClient
from sparkpoint_agent.earn.config import default_config
from sparkpoint_agent.earn.parse import EarnRequest
from sparkpoint_agent.earn.rails import LIVE, NO_LIQUIDITY, ReceiptLivenessCache
from sparkpoint_agent.earn.registry import EarnRegistry, EarnSnapshot
from sparkpoint_agent.earn.service import EarnService

from .helpers import make_kamino_vault, make_vault

_FIXTURE_DIR = (
    Path(__file__).resolve().parents[4]
    / "packages"
    / "shared"
    / "tests"
    / "fixtures"
    / "earn"
)
_QUOTED_AT = "2026-11-01T02:31:00+00:00"

_GAUNTLET = make_vault()
_MOONWELL = make_vault(
    address="0xc1256Ae5FF1cf2719D4937adb3bbCCab2E00A2Ca",
    name="Moonwell Flagship USDC",
    symbol="mwUSDC",
    tvl=Decimal("115000000"),
    apy=Decimal("0.0512"),
)
_SPARK = make_vault(
    address="0x7BfA7C4f149E7415b73bdeDfe609237e29CBF34A",
    name="Spark USDC",
    symbol="spUSDC",
    tvl=Decimal("88000000"),
    apy=Decimal("0.0438"),
)
_MYSTERY = make_vault(
    address="0x" + "3" * 40,
    name="Mystery Vault",
    symbol="MYS",
    tvl=None,
    apy=None,
)


def _fixture(name: str) -> dict[str, Any]:
    return json.loads((_FIXTURE_DIR / name).read_text(encoding="utf-8"))


def _payload() -> dict[str, Any]:
    return {
        "quote": {
            "amountIn": "100000000",
            "amountInFormatted": "100",
            "amountInUsd": "100.0",
            "amountOut": "89146629",
            "amountOutFormatted": "89.146629",
            "amountOutUsd": "99.55",
            "minAmountOut": "88000000",
            "timeEstimate": 52,
        },
        "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


def _kamino_payload() -> dict[str, Any]:
    return {
        "quote": {
            "amountIn": "100000000",
            "amountInFormatted": "100",
            "amountInUsd": "100.0",
            "amountOut": "983500000",
            "amountOutFormatted": "0.9835",
            "amountOutUsd": "99.2",
            "minAmountOut": "970000000",
            "timeEstimate": 47,
        },
        "quoteRequest": {"deadline": "2026-11-01T12:30:00.000Z"},
        "signature": "ed25519:test",
    }


def _registry(*, liveness: ReceiptLivenessCache) -> EarnRegistry:
    config = default_config()
    registry = EarnRegistry(config, writable_path=Path("/nonexistent/earn.json"))
    snapshot = EarnSnapshot(
        fetched_at=datetime(2026, 11, 1, 2, 19, tzinfo=UTC),
        source="morpho_api",
        vaults=(_GAUNTLET, _MOONWELL, _SPARK, _MYSTERY),
    )
    registry.install(snapshot, loaded_from="persisted")
    return registry


def _service(
    registry: EarnRegistry, handler: Any, *, liveness: ReceiptLivenessCache | None = None
) -> EarnService:
    return EarnService(
        default_config(),
        registry,
        oneclick=OneClickClient(transport=httpx.MockTransport(handler), clock=lambda: 1000.0),
        liveness=liveness or ReceiptLivenessCache(clock=lambda: 1000.0),
    )


def test_earn_vaults_list_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-vaults-list.json")
    config = default_config()
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    liveness.set(config.receipt_for_vault(_GAUNTLET.address).asset_id, LIVE)
    liveness.set(config.receipt_for_vault(_MOONWELL.address).asset_id, NO_LIQUIDITY)
    service = _service(
        _registry(liveness=liveness),
        lambda request: httpx.Response(201),
        liveness=liveness,
    )

    request = EarnRequest(
        kind="list",
        chain="base",
        asset=None,
        amount=None,
        amount_raw=None,
        vault_query=None,
        sort="tvl",
        message="show Morpho vaults on Base",
    )
    outcome = service.list_outcome(request)
    block = replace(outcome.block, snapshot_age_minutes=fixture["snapshotAgeMinutes"])
    assert block.to_wire() == fixture


def test_earn_vaults_unavailable_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-vaults-unavailable.json")
    config = default_config()
    registry = EarnRegistry(
        config,
        writable_path=Path("/nonexistent/earn.json"),
        fallback_path=Path("/nonexistent/shipped.json"),
    )

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("an unavailable snapshot must not reach 1Click")

    service = _service(registry, handler)
    request = EarnRequest(
        kind="list",
        chain="base",
        asset=None,
        amount=None,
        amount_raw=None,
        vault_query=None,
        sort="tvl",
        message="show Morpho vaults on Base",
    )
    outcome = service.list_outcome(request)
    assert outcome.block.to_wire() == fixture


@pytest.mark.asyncio
async def test_earn_quote_oneclick_preview_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-quote-preview-oneclick.json")
    registry = _registry(liveness=ReceiptLivenessCache())

    def handler(request: httpx.Request) -> httpx.Response:  # noqa: ARG001
        return httpx.Response(201, json=_payload())

    service = _service(registry, handler)
    outcome = await service.preview_for(
        chain="base",
        address=_GAUNTLET.address,
        origin_key="eth:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
    )
    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture


@pytest.mark.asyncio
async def test_earn_quote_unavailable_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-quote-unavailable.json")
    registry = _registry(liveness=ReceiptLivenessCache())
    service = _service(
        registry,
        lambda request: httpx.Response(400, json={"message": "No liquidity available"}),
    )
    outcome = await service.preview_for(
        chain="base",
        address=_GAUNTLET.address,
        origin_key="eth:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
    )
    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture


@pytest.mark.asyncio
async def test_earn_quote_direct_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-quote-direct.json")
    registry = _registry(liveness=ReceiptLivenessCache())

    def handler(request: httpx.Request) -> httpx.Response:  # pragma: no cover - must not run
        raise AssertionError("a direct preview must not reach 1Click")

    service = _service(registry, handler)
    outcome = await service.preview_for(
        chain="base",
        address=_GAUNTLET.address,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
    )
    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture


# ── 070 — Kamino SOL vault fixtures ────────────────────────────────────────────

_KAMINO = make_kamino_vault()


def _kamino_registry() -> EarnRegistry:
    config = default_config()
    registry = EarnRegistry(config, writable_path=Path("/nonexistent/earn.json"))
    snapshot = EarnSnapshot(
        fetched_at=datetime(2026, 11, 1, 2, 32, tzinfo=UTC),
        source="kamino_api",
        vaults=(_KAMINO,),
    )
    registry.install(snapshot, loaded_from="persisted")
    return registry


def test_earn_vaults_kamino_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-vaults-kamino.json")
    config = default_config()
    liveness = ReceiptLivenessCache(clock=lambda: 1000.0)
    liveness.set(config.receipt_for_symbol("kV-gtSOLb").asset_id, LIVE)
    service = _service(
        _kamino_registry(),
        lambda request: httpx.Response(201),
        liveness=liveness,
    )

    request = EarnRequest(
        kind="list",
        chain="sol",
        asset=None,
        amount=None,
        amount_raw=None,
        vault_query=None,
        sort="tvl",
        message="Show Kamino vaults",
        protocol="kamino",
    )
    outcome = service.list_outcome(request)
    block = replace(outcome.block, snapshot_age_minutes=fixture["snapshotAgeMinutes"])
    assert block.to_wire() == fixture


@pytest.mark.asyncio
async def test_earn_quote_kamino_preview_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-quote-kamino-preview.json")
    service = _service(
        _kamino_registry(), lambda request: httpx.Response(201, json=_kamino_payload())
    )
    outcome = await service.preview_for(
        chain="sol",
        address=_KAMINO.address,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        recipient="9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    )
    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture


@pytest.mark.asyncio
async def test_earn_quote_kamino_sol_origin_preview_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-quote-kamino-preview-sol-origin.json")
    service = _service(
        _kamino_registry(), lambda request: httpx.Response(201, json=_kamino_payload())
    )
    outcome = await service.preview_for(
        chain="sol",
        address=_KAMINO.address,
        origin_key="sol:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
        recipient="9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    )
    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture


@pytest.mark.asyncio
async def test_earn_quote_kamino_unavailable_matches_the_shared_ts_fixture() -> None:
    fixture = _fixture("earn-quote-kamino-unavailable.json")
    service = _service(
        _kamino_registry(),
        lambda request: httpx.Response(400, json={"message": "No liquidity available"}),
    )
    outcome = await service.preview_for(
        chain="sol",
        address=_KAMINO.address,
        origin_key="base:USDC",
        amount=Decimal("100"),
        amount_raw=100_000_000,
    )
    block = replace(outcome.block, quoted_at=fixture["quotedAt"])
    assert block.to_wire() == fixture
